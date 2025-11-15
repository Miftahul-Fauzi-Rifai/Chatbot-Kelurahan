// server_production.js
// Backend API chatbot untuk deployment
// Fokus: REST API only, CORS-friendly, production-ready

import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { localRAG, getRAGStatus } from './rag_handler.js';
import { makeCacheKey, getCache, setCache, getCacheStats } from './utils/cache.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ======== MIDDLEWARE =========
app.use(express.json());

// Serve static files dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// ======== CORS Configuration (Open untuk semua domain) =========
app.use((req, res, next) => {
  // Izinkan semua origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// ======== REQUEST LOGGING =========
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - Origin: ${req.headers.origin || 'direct'}`);
  next();
});

// ======== MULTI API KEY CONFIGURATION =========
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(Boolean); // Remove undefined/null keys

let currentKeyIndex = 0;

function getNextApiKey() {
  if (API_KEYS.length === 0) {
    throw new Error('No API keys configured');
  }
  
  const key = API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return key;
}

function getCurrentKeyInfo() {
  return {
    total: API_KEYS.length,
    current: currentKeyIndex + 1
  };
}

// ======== RATE LIMITER (Protection dari API quota) =========
const rateLimit = {
  requests: [],
  maxPerMinute: 10,
  
  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < 60000);
    
    if (this.requests.length >= this.maxPerMinute) {
      return false;
    }
    
    this.requests.push(now);
    return true;
  },
  
  async waitIfNeeded() {
    if (!this.canMakeRequest()) {
      const oldestRequest = Math.min(...this.requests);
      const waitTime = 60000 - (Date.now() - oldestRequest) + 1000;
      console.log(`⏳ Rate limit: Waiting ${Math.ceil(waitTime/1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requests = [];
    }
  },
  
  getStatus() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < 60000);
    return {
      used: this.requests.length,
      limit: this.maxPerMinute,
      available: this.maxPerMinute - this.requests.length
    };
  }
};

// ======== DATA LOADING =========
const TRAIN_FILE = process.env.TRAIN_DATA_FILE || './data/train_optimized.json';

function readTrainData() {
  try {
    if (!fs.existsSync(TRAIN_FILE)) {
      console.warn(`⚠️ Warning: ${TRAIN_FILE} not found, using empty array`);
      return [];
    }
    const data = JSON.parse(fs.readFileSync(TRAIN_FILE, 'utf8'));
    console.log(`✅ Loaded ${data.length} training data from ${TRAIN_FILE}`);
    return data;
  } catch (e) {
    console.error(`❌ Error loading training data:`, e.message);
    return [];
  }
}

// Load data saat startup
const trainingData = readTrainData();

// ======== FUNGSI PENCARIAN SEMANTIK (RAG) =========
function findRelevantData(message, allData, maxResults = 3) {
  const lowerMessage = message.toLowerCase();
  const queryWords = lowerMessage.split(/\s+/);
  
  // Detect question patterns
  const isDefinitionQuestion = /^(apa|apakah)\s+(itu|kepanjangan|arti)\s+/i.test(message);
  
  const scores = allData.map(item => {
    let score = 0;
    const text = (item.text || item.question || '').toLowerCase();
    const answer = (item.answer || item.response || '').toLowerCase();
    const tags = (item.tags || []).join(' ').toLowerCase();
    const kategori = (item.kategori_utama || '').toLowerCase();
    
    // Special handling for definition questions
    if (isDefinitionQuestion) {
      const termMatch = message.match(/(?:apa|apakah)\s+(?:itu|kepanjangan|arti)\s+(.+?)(?:\?|$)/i);
      if (termMatch) {
        const term = termMatch[1].toLowerCase().trim();
        if (text.includes(term)) score += 10;
        if (kategori.includes('istilah') && (text.includes(term) || tags.includes(term))) {
          score += 15;
        }
      }
    }
    
    // Regular keyword matching
    queryWords.forEach(word => {
      if (word.length < 3) return;
      if (text.includes(word)) score += 2;
      if (tags.includes(word)) score += 2;
      if (answer.includes(word)) score += 1;
    });
    
    return { item, score };
  });

  return scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.item);
}

// ======== RETRY LOGIC =========
async function generateWithRetry(url, payload, modelName, maxRetries = 2) {
  const totalKeys = API_KEYS.length;
  const attemptsPerKey = Math.max(1, Math.floor(maxRetries / Math.max(1, totalKeys)));
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rateLimit.waitIfNeeded();
      
      // Get next API key (automatic rotation)
      const apiKey = getNextApiKey();
      const keyInfo = getCurrentKeyInfo();
      const urlWithKey = url.replace(/key=[^&]*/, `key=${apiKey}`);
      
      console.log(`🔄 Attempt ${attempt}/${maxRetries} - ${modelName} [Key ${keyInfo.current}/${keyInfo.total}]`);
      const startTime = Date.now();
      
      const response = await axios.post(urlWithKey, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 3000
      });
      
      const duration = Date.now() - startTime;
      console.log(`✅ Success with ${modelName} [Key ${keyInfo.current}] in ${duration}ms`);
      return response.data;
      
    } catch (error) {
      const statusCode = error.response?.status;
      const errorMessage = error.response?.data?.error?.message || error.message;
      const keyInfo = getCurrentKeyInfo();
      
      if (statusCode === 429) {
        // If multiple keys available and not last attempt, rotate and retry
        if (totalKeys > 1 && attempt < maxRetries) {
          console.log(`⚠️ Rate limit (429) [Key ${keyInfo.current}] - Rotating to next key...`);
          await new Promise(resolve => setTimeout(resolve, 500)); // Brief wait
          continue;
        }
        console.log(`⚠️ Rate limit (429) - All keys exhausted, skip to next layer`);
        throw new Error('QUOTA_EXCEEDED');
      }
      
      if (errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
        console.log(`📊 Quota exceeded [Key ${keyInfo.current}]`);
        
        // Rotate to next key if available
        if (totalKeys > 1 && attempt < maxRetries) {
          console.log(`🔄 Trying with next API key...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        
        throw new Error('QUOTA_EXCEEDED');
      }
      
      if (errorMessage.includes('timeout') || errorMessage.includes('ECONNABORTED')) {
        console.log(`⏱️ Timeout for ${modelName} - skipping retry`);
        throw error;
      }
      
      console.log(`❌ Error with ${modelName}:`, errorMessage);
      throw error;
    }
  }
  
  throw new Error(`Max retries (${maxRetries}) exceeded`);
}

// ======== ROOT ENDPOINT =========
app.get('/', (req, res) => {
  res.json({
    service: 'Chatbot Kelurahan API',
    version: '2.0.0',
    status: 'online',
    endpoints: {
      chat: 'POST /chat',
      health: 'GET /health',
      status: 'GET /status',
      ui: 'GET /ui (Chat Interface)'
    },
    documentation: 'https://github.com/Miftahul-Fauzi-Rifai/Chatbot-Kelurahan',
    ui_url: '/ui'
  });
});

// UI Chat Interface
app.get('/ui', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chatbot Kelurahan Marga Sari</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
    .chat-container { width: 100%; max-width: 600px; height: 90vh; max-height: 800px; background: white; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column; overflow: hidden; }
    .chat-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
    .chat-header h1 { font-size: 24px; margin-bottom: 5px; }
    .chat-header p { font-size: 14px; opacity: 0.9; }
    .chat-messages { flex: 1; padding: 20px; overflow-y: auto; background: #f8f9fa; }
    .message { margin-bottom: 15px; display: flex; animation: slideIn 0.3s ease; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .message.user { justify-content: flex-end; }
    .message.bot { justify-content: flex-start; }
    .message-content { max-width: 70%; padding: 12px 16px; border-radius: 18px; word-wrap: break-word; line-height: 1.5; }
    .message.user .message-content { background: #667eea; color: white; border-bottom-right-radius: 4px; }
    .message.bot .message-content { background: white; color: #333; border-bottom-left-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
    .message-time { font-size: 11px; opacity: 0.7; margin-top: 5px; text-align: right; }
    .typing-indicator { display: none; padding: 12px 16px; background: white; border-radius: 18px; width: fit-content; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
    .typing-indicator.active { display: block; }
    .typing-indicator span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #667eea; margin: 0 2px; animation: typing 1.4s infinite; }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-10px); } }
    .chat-input-container { padding: 20px; background: white; border-top: 1px solid #e0e0e0; }
    .chat-input-wrapper { display: flex; gap: 10px; }
    #messageInput { flex: 1; padding: 12px 16px; border: 2px solid #e0e0e0; border-radius: 25px; font-size: 14px; outline: none; transition: border-color 0.3s; }
    #messageInput:focus { border-color: #667eea; }
    .voice-btn { padding: 12px 16px; background: #f0f0f0; color: #333; border: none; border-radius: 25px; font-size: 20px; cursor: pointer; transition: all 0.2s; }
    .voice-btn:hover { background: #e0e0e0; }
    .voice-btn.recording { background: #ff4444; color: white; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
    .mode-toggle { display: flex; gap: 10px; margin-bottom: 10px; justify-content: center; }
    .mode-btn { padding: 8px 16px; background: #f0f0f0; border: 2px solid #e0e0e0; border-radius: 20px; font-size: 13px; cursor: pointer; transition: all 0.2s; }
    .mode-btn.active { background: #667eea; color: white; border-color: #667eea; }
    #sendBtn { padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 25px; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.2s; }
    #sendBtn:hover { transform: scale(1.05); }
    #sendBtn:disabled { opacity: 0.6; cursor: not-allowed; }
    .welcome-message { text-align: center; color: #999; margin-top: 100px; }
    .welcome-message h2 { font-size: 20px; margin-bottom: 10px; color: #667eea; }
    .welcome-message p { font-size: 14px; }
    .error-message { background: #fee; color: #c00; padding: 10px; border-radius: 8px; margin-bottom: 10px; font-size: 13px; display: none; }
    .error-message.active { display: block; }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="chat-header">
      <h1>🏛️ Chatbot Kelurahan</h1>
      <p>Asisten Virtual Kelurahan Marga Sari, Balikpapan</p>
    </div>
    <div class="chat-messages" id="chatMessages">
      <div class="welcome-message">
        <h2>Selamat Datang! 👋</h2>
        <p>Tanyakan tentang layanan administrasi kelurahan</p>
        <p style="margin-top: 10px; font-size: 12px; color: #bbb;">Contoh: "Bagaimana cara membuat KTP?"</p>
      </div>
    </div>
    <div class="chat-input-container">
      <div class="error-message" id="errorMessage"></div>
      <div class="mode-toggle">
        <button class="mode-btn active" id="textModeBtn">💬 Mode Teks</button>
        <button class="mode-btn" id="voiceModeBtn">🎤 Mode Suara</button>
      </div>
      <div class="chat-input-wrapper">
        <button id="voiceBtn" class="voice-btn" style="display: none;">🎤</button>
        <input type="text" id="messageInput" placeholder="Ketik pertanyaan Anda..." autocomplete="off">
        <button id="sendBtn">Kirim</button>
      </div>
    </div>
  </div>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      const chatMessages = document.getElementById('chatMessages');
      const messageInput = document.getElementById('messageInput');
      const sendBtn = document.getElementById('sendBtn');
      const voiceBtn = document.getElementById('voiceBtn');
      const textModeBtn = document.getElementById('textModeBtn');
      const voiceModeBtn = document.getElementById('voiceModeBtn');
      const errorMessage = document.getElementById('errorMessage');
      const API_URL = window.location.origin + '/chat';
      
      // Conversation history for context (max 10 messages)
      let conversationHistory = [];
      
      // Voice mode state
      let currentMode = 'text'; // 'text' or 'voice'
      let recognition = null;
      let isRecording = false;
      
      // Initialize Speech Recognition (STT)
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.lang = 'id-ID'; // Bahasa Indonesia
        recognition.continuous = false;
        recognition.interimResults = false;
        
        recognition.onresult = function(event) {
          const transcript = event.results[0][0].transcript;
          messageInput.value = transcript;
          isRecording = false;
          voiceBtn.classList.remove('recording');
          voiceBtn.textContent = '🎤';
          
          // Auto-send after recognition
          setTimeout(() => sendMessage(), 500);
        };
        
        recognition.onerror = function(event) {
          console.error('Speech recognition error:', event.error);
          isRecording = false;
          voiceBtn.classList.remove('recording');
          voiceBtn.textContent = '🎤';
          showError('Gagal mengenali suara. Coba lagi.');
        };
        
        recognition.onend = function() {
          isRecording = false;
          voiceBtn.classList.remove('recording');
          voiceBtn.textContent = '🎤';
        };
      }
      
      // Switch between text and voice mode
      function switchMode(mode) {
        currentMode = mode;
        
        if (mode === 'voice') {
          textModeBtn.classList.remove('active');
          voiceModeBtn.classList.add('active');
          voiceBtn.style.display = 'block';
          messageInput.placeholder = 'Klik mikrofon atau ketik...';
          
          if (!recognition) {
            showError('Browser Anda tidak mendukung pengenalan suara. Gunakan Chrome/Edge.');
          }
        } else {
          voiceModeBtn.classList.remove('active');
          textModeBtn.classList.add('active');
          voiceBtn.style.display = 'none';
          messageInput.placeholder = 'Ketik pertanyaan Anda...';
        }
      }
      
      // Text-to-Speech function (TTS)
      function speakText(text) {
        if ('speechSynthesis' in window) {
          // Cancel any ongoing speech
          window.speechSynthesis.cancel();
          
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'id-ID'; // Bahasa Indonesia
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          utterance.volume = 1.0;
          
          // Wait for voices to load
          if (window.speechSynthesis.getVoices().length === 0) {
            window.speechSynthesis.addEventListener('voiceschanged', function() {
              window.speechSynthesis.speak(utterance);
            }, { once: true });
          } else {
            window.speechSynthesis.speak(utterance);
          }
        }
      }
      
      // Event listeners for mode buttons
      textModeBtn.addEventListener('click', function() {
        switchMode('text');
      });
      
      voiceModeBtn.addEventListener('click', function() {
        switchMode('voice');
      });
      
      // Voice button click handler
      voiceBtn.addEventListener('click', function() {
        if (!recognition) {
          showError('Pengenalan suara tidak tersedia di browser ini.');
          return;
        }
        
        if (isRecording) {
          recognition.stop();
          isRecording = false;
          voiceBtn.classList.remove('recording');
          voiceBtn.textContent = '🎤';
        } else {
          recognition.start();
          isRecording = true;
          voiceBtn.classList.add('recording');
          voiceBtn.textContent = '⏹️';
        }
      });
      
      sendBtn.addEventListener('click', sendMessage);
      messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
      
      async function sendMessage() {
        const message = messageInput.value.trim();
        if (!message) return;
        
        hideError();
        const welcomeMsg = chatMessages.querySelector('.welcome-message');
        if (welcomeMsg) welcomeMsg.remove();
        
        addMessage(message, 'user');
        messageInput.value = '';
        sendBtn.disabled = true;
        messageInput.disabled = true;
        
        const typingIndicator = addTypingIndicator();
        
        try {
          const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              message,
              history: conversationHistory.slice(-10) // Last 10 messages only
            })
          });
          
          if (!response.ok) throw new Error('Gagal menghubungi server. Silakan coba lagi.');
          
          const data = await response.json();
          typingIndicator.remove();
          
          let answer = '';
          if (data.ok && data.output?.candidates?.[0]?.content?.parts?.[0]?.text) {
            answer = data.output.candidates[0].content.parts[0].text;
          } else {
            answer = 'Maaf, saya tidak bisa memproses pertanyaan Anda saat ini.';
          }
          
          // Save to conversation history
          conversationHistory.push({
            role: 'user',
            parts: [{ text: message }]
          });
          conversationHistory.push({
            role: 'model',
            parts: [{ text: answer }]
          });
          
          // Keep only last 10 messages (5 pairs)
          if (conversationHistory.length > 10) {
            conversationHistory = conversationHistory.slice(-10);
          }
          
          addMessage(answer, 'bot');
          
          // Text-to-Speech for voice mode
          if (currentMode === 'voice') {
            speakText(answer);
          }
        } catch (error) {
          console.error('Error:', error);
          typingIndicator.remove();
          showError(error.message || 'Terjadi kesalahan. Silakan coba lagi.');
        } finally {
          sendBtn.disabled = false;
          messageInput.disabled = false;
          messageInput.focus();
        }
      }
      
      function addMessage(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = \`message \${sender}\`;
        const now = new Date();
        const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        messageDiv.innerHTML = \`<div class="message-content">\${text.replace(/\\n/g, '<br>')}<div class="message-time">\${time}</div></div>\`;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return messageDiv;
      }
      
      function addTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot';
        typingDiv.innerHTML = '<div class="typing-indicator active"><span></span><span></span><span></span></div>';
        chatMessages.appendChild(typingDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return typingDiv;
      }
      
      function showError(message) {
        errorMessage.textContent = '❌ ' + message;
        errorMessage.classList.add('active');
      }
      
      function hideError() {
        errorMessage.classList.remove('active');
      }
    });
  </script>
</body>
</html>`);
});// ======== HEALTH CHECK ENDPOINT (untuk Render monitoring) =========
app.get('/health', (req, res) => {
  const apiKeysConfigured = API_KEYS.length;
  const dataLoaded = trainingData.length > 0;
  
  const health = {
    status: (apiKeysConfigured > 0 && dataLoaded) ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      gemini_api_keys: `${apiKeysConfigured} key${apiKeysConfigured !== 1 ? 's' : ''} configured`,
      training_data: dataLoaded ? `OK (${trainingData.length} items)` : 'EMPTY',
      memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      quota_capacity: `${apiKeysConfigured * 15} requests/minute (estimated)`
    }
  };
  
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

// ======== STATUS ENDPOINT =========
app.get('/status', (req, res) => {
  const rateLimitStatus = rateLimit.getStatus();
  
  res.json({
    ok: true,
    server: 'online',
    timestamp: new Date().toISOString(),
    rateLimit: {
      used: rateLimitStatus.used,
      limit: rateLimitStatus.limit,
      available: rateLimitStatus.available,
      percentage: Math.round((rateLimitStatus.used / rateLimitStatus.limit) * 100)
    },
    models: {
      primary: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
      fallback: ['gemini-2.5-flash', 'gemini-2.0-flash'],
      local: 'RAG (training data)'
    },
    data: {
      items: trainingData.length,
      source: TRAIN_FILE
    }
  });
});

// ======== MAIN CHAT ENDPOINT =========
app.post('/chat', async (req, res) => {
  const { message, history } = req.body || {};
  
  if (!message) {
    return res.status(400).json({ 
      ok: false, 
      error: 'message field is required' 
    });
  }

  console.log(`💬 Chat request: "${message.substring(0, 50)}..."`);
  
  // Validate API Keys
  if (API_KEYS.length === 0) {
    return res.status(500).json({ 
      ok: false, 
      error: 'GEMINI_API_KEY not configured. Please add at least one API key.' 
    });
  }
  
  console.log(`🔑 Available API Keys: ${API_KEYS.length}`);
  
  // ============================================
  // LAYER 0: CACHE CHECK (Hemat kuota Gemini!)
  // ============================================
  const cacheKey = makeCacheKey(message);
  const cached = await getCache(cacheKey);
  
  if (cached) {
    console.log('✅ Returning cached response (no API call)');
    return res.json({ ...cached, cached: true });
  }
  
  // Helper untuk save to cache dan return response
  const replyAndCache = async (payload) => {
    try {
      await setCache(cacheKey, payload);
    } catch (err) {
      console.warn('⚠️  Cache set failed:', err?.message);
    }
    return res.json(payload);
  };
  
  // Find relevant data (RAG)
  const relevantData = findRelevantData(message, trainingData, 3);
  
  // Build grounding context
  const grounding = relevantData.length > 0
    ? "Data referensi:\n" + 
      relevantData.map(d => 
        `Q: ${(d.text||d.question||'').substring(0, 100)}\nA: ${(d.answer||d.response||'').substring(0, 200)}`
      ).join('\n---\n')
    : "";

  // System instruction (FINAL VERSION - Bahasa Indonesia WAJIB)
  const systemInstruction = `Anda adalah Asisten Virtual Kelurahan Marga Sari, Balikpapan.

CAKUPAN LAYANAN YANG BISA DIJAWAB:
✅ Kependudukan: KTP, e-KTP, KK, KIA, Akta Kelahiran, Akta Kematian, pindah domisili, SKPWNI
✅ Surat Kelurahan: Surat Domisili, Surat Keterangan Usaha, Surat Belum Menikah, Surat Penghasilan Tidak Tetap, Surat Janda/Duda
✅ Perizinan: SIM, SKCK, Paspor, IMB/PBG (SIMBG), NIB (OSS), Sertifikat Tanah (BPN)
✅ Pajak & Kendaraan: NPWP, PBB, Pajak Kendaraan (STNK/BPKB), Samsat, Balik Nama Kendaraan
✅ Layanan Publik: BPJS Kesehatan, KIS, Kartu Kuning (AK1), PDAM, PLN
✅ Administrasi Nikah: Persyaratan nikah di KUA, Surat Pengantar Nikah (N1, N2, N4)
✅ Pengaduan: LAPOR!, Call Center 112, Layanan Pengaduan Online
✅ Informasi Instansi: Lokasi, alamat, jam kerja, kontak Disdukcapil, Polres, Samsat, BPPDRD, dll

PENANGANAN BAHASA (ATURAN KETAT):
1. Bahasa Respon Utama: Bahasa Indonesia. Semua jawaban Anda WAJIB ditulis dalam Bahasa Indonesia yang formal, sopan, dan profesional.
2. Aturan Input: Anda dapat memahami pertanyaan yang diajukan dalam bahasa lain (termasuk Bahasa Jawa).
3. Aturan Eksekusi Jawaban:
   - JIKA user bertanya dalam bahasa lain (misal: "Pripun damel KTP?"), Anda TETAP HARUS menjawab dalam Bahasa Indonesia (misal: "Untuk membuat KTP, syaratnya adalah...").
   - JANGAN PERNAH membalas menggunakan bahasa yang sama dengan input user jika itu bukan Bahasa Indonesia.

BATASAN KETAT:
❌ TOLAK pertanyaan di luar topik: resep masakan, tips kecantikan, teknologi gadget, hiburan, olahraga, kesehatan medis, investasi, cryptocurrency, dll
❌ Format penolakan: "Maaf, sebagai Asisten Virtual Kelurahan Marga Sari, saya hanya dapat membantu informasi terkait layanan kelurahan dan administrasi kependudukan di Balikpapan. Apakah ada yang bisa saya bantu terkait layanan kelurahan?"

PENANGANAN PERTANYAAN TIDAK LENGKAP:
📋 JIKA user bertanya tidak lengkap (misal: "cara membuat?" tanpa menyebut apa):
   → GUNAKAN CONTEXT dari chat history untuk melanjutkan percakapan
   → JIKA tidak ada context → TANYAKAN BALIK: "Untuk membantu Anda, boleh saya tahu dokumen apa yang ingin Anda buat? Misalnya: KTP, KK, Surat Keterangan, NPWP, atau yang lainnya?"

CARA MENJAWAB (PENTING - IKUTI FORMAT INI):
1. Identifikasi topik dari pertanyaan (misal: NPWP, SKCK, KTP, dll)
2. Cek data referensi di bawah - GUNAKAN data tersebut sebagai sumber utama jawaban
3. Struktur jawaban:
   - Pembukaan singkat (1 kalimat)
   - Lokasi/Instansi yang menangani (jika relevan)
   - Persyaratan (numbered list jika ada syarat)
   - Prosedur/Cara pengajuan (numbered list untuk langkah-langkah)
   - Informasi tambahan (jika perlu)
   - Penutup singkat dengan emoji (opsional)

GAYA BAHASA:
• Formal, sopan, profesional
• Padat, jelas, to the point
• Maksimal 3-4 paragraf pendek
• Gunakan numbered list (1. 2. 3.) untuk syarat/langkah
• Gunakan bullet points (•) untuk pilihan
• Maksimal 1 emoji di akhir (👍 atau 📄)

CONTOH JAWABAN YANG BAIK:
"Sebagai Asisten Virtual Kelurahan Marga Sari, saya akan bantu berikan panduan umum mengenai proses pembuatan SKCK ini, ya.

Proses pembuatan SKCK dilakukan di Polres Balikpapan (bukan di kelurahan).

Syarat-syarat yang umumnya dibutuhkan meliputi:
1. Kartu Tanda Penduduk (KTP)
2. Kartu Keluarga (KK)
3. Pasfoto
4. Sidik Jari

Untuk memastikan semua persyaratan dan prosedur terbaru, terutama jika Anda ingin mendaftar secara online, disarankan untuk menghubungi langsung Polres Balikpapan atau mengunjungi situs resmi mereka. Terima kasih. 👍"

${grounding ? '\n📚 DATA REFERENSI (WAJIB DIGUNAKAN JIKA RELEVAN):\n' + grounding + '\n\nJawab berdasarkan data referensi di atas. Jangan membuat informasi sendiri.' : ''}`;

  // Load API Key
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return res.status(500).json({ 
      ok: false, 
      error: 'GEMINI_API_KEY not configured' 
    });
  }

  try {
    // Multi-model fallback system
    const models = [
      process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp',
      'gemini-2.5-flash',
      'gemini-2.0-flash'
    ];
    
    let lastError = null;
    
    for (const model of models) {
      try {
        console.log(`🤖 Trying model: ${model}`);
        
        const apiVersion = model.includes('2.0') ? 'v1beta' : 'v1';
        // Placeholder URL - actual API key will be injected in generateWithRetry()
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=PLACEHOLDER`;

        // Build conversation
        const contents = [];
        
        contents.push({
          role: "user",
          parts: [{ text: systemInstruction }]
        });
        
        contents.push({
          role: "model",
          parts: [{ text: "Understood. Saya siap membantu sebagai Asisten Virtual Kelurahan Marga Sari." }]
        });
        
        // Add history if exists
        if (history && Array.isArray(history) && history.length > 0) {
          const recentHistory = history.slice(-5);
          contents.push(...recentHistory);
        }
        
        // Add current message
        contents.push({
          role: "user",
          parts: [{ text: message }]
        });

        const payload = {
          contents: contents,
          generationConfig: {
            maxOutputTokens: 500,
            temperature: 0.7,
            topP: 0.95,
            topK: 40
          }
        };

        const out = await generateWithRetry(url, payload, model, 2); // maxRetries=2 for multi-key rotation

        if (!out.candidates || !out.candidates[0].content) {
          throw new Error("Invalid API response");
        }

        console.log(`✅ Success with model: ${model}`);
        return replyAndCache({ 
          ok: true, 
          model, 
          output: out 
        });
        
      } catch (modelError) {
        lastError = modelError;
        const errorMsg = modelError.message || modelError.response?.data?.error?.message;
        console.warn(`⚠️ Model ${model} failed: ${errorMsg}`);
        
        if (errorMsg.includes('QUOTA_EXCEEDED') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
          console.log(`📊 ${model} quota exhausted, trying next model...`);
          continue;
        }
        
        continue;
      }
    }
    
    // All Gemini models failed - use RAG semantic fallback
    console.log('🔄 Layer 4: All Gemini models failed, trying RAG semantic fallback...');
    
    try {
      const ragResult = await localRAG(message);

      if (ragResult?.ok && ragResult?.answer) {
        console.log(`✅ Layer 4 SUCCESS: RAG Fallback (${ragResult.sources.length} sources)`);
        return replyAndCache({
          ok: true,
          model: 'rag-local',
          output: { candidates: [{ content: { parts: [{ text: ragResult.answer }] } }] }
        });
      }
      console.warn('❌ Layer 4 FAILED: RAG gagal -', ragResult?.error || ragResult?.message);
    } catch (ragError) {
      console.error('❌ Layer 4 EXCEPTION:', ragError.message);
    }
    
    // RAG failed - use keyword fallback
    console.log('🔄 Layer 5: RAG failed, using keyword fallback...');
    
    const lowerMessage = message.toLowerCase();
    const queryWords = lowerMessage.split(/\s+/).filter(w => w.length > 2);
    const commonWords = ['cara', 'bagaimana', 'apa', 'dimana', 'berapa', 'apakah', 'bisa', 'saya', 'membuat', 'mengurus', 'untuk'];
    const specificWords = queryWords.filter(w => !commonWords.includes(w));
    
    const matches = trainingData.map(item => {
      const lowerText = (item.text || '').toLowerCase();
      const lowerAnswer = (item.answer || '').toLowerCase();
      const lowerTags = (item.tags || []).join(' ').toLowerCase();
      
      let score = 0;
      
      specificWords.forEach(word => {
        if (lowerText.includes(word)) score += 30;
        if (lowerTags.includes(word)) score += 25;
        if (lowerAnswer.includes(word)) score += 5;
      });
      
      const cleanMessage = lowerMessage.replace(/[^\w\s]/g, '');
      const cleanText = lowerText.replace(/[^\w\s]/g, '');
      
      if (cleanMessage.length > 10 && cleanText.includes(cleanMessage.substring(0, Math.min(15, cleanMessage.length)))) {
        score += 40;
      }
      
      return { item, score };
    }).filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score);
    
    if (matches.length > 0) {
      const bestMatch = matches[0].item;
      console.log(`✅ Layer 5 SUCCESS: Keyword match found (score: ${matches[0].score})`);
      
      return replyAndCache({ 
        ok: true, 
        model: 'keyword-fallback',
        output: {
          candidates: [{
            content: { parts: [{ text: bestMatch.answer }] }
          }]
        }
      });
    }
    
    // No match found - return professional generic response (manusiawi)
    console.log('⚠️ Layer 6: No keyword match, using generic response');
    return replyAndCache({ 
      ok: true, 
      model: 'fallback-generic',
      output: {
        candidates: [{
          content: {
            parts: [{ 
              text: `Maaf, saya belum menemukan jawaban yang tepat untuk pertanyaan Anda. Bisa dijelaskan lebih rinci agar saya bisa bantu lebih baik?\n\nUntuk informasi lebih detail, Anda juga bisa menghubungi kantor Kelurahan Marga Sari langsung (Senin-Jumat, 08:00-16:00 WITA).\n\nTerima kasih.` 
            }]
          }
        }]
      }
    });

  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.error('❌ Fatal error:', errorMsg);
    
    return res.status(500).json({ 
      ok: false, 
      error: 'Maaf, terjadi gangguan sementara. Silakan coba lagi atau hubungi kantor kelurahan langsung.', 
      detail: errorMsg 
    });
  }
});

// ======== RAG STATUS ENDPOINT (Opsional - untuk monitoring) =========
app.get('/api/rag/status', (req, res) => {
  res.json({ ok: true, rag: getRAGStatus() });
});

// ======== CACHE STATUS ENDPOINT (Monitor cache performance) =========
app.get('/api/cache/status', (req, res) => {
  res.json({ ok: true, cache: getCacheStats() });
});

// ======== ERROR HANDLER =========
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    ok: false,
    error: 'Internal server error'
  });
});

// ======== START SERVER =========
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log('\n🚀 Chatbot Kelurahan API Server');
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Training data: ${trainingData.length} items`);
    console.log(`🔑 API Keys: ${API_KEYS.length} configured (${API_KEYS.length * 15} req/min capacity)`);
    console.log('\nEndpoints:');
    console.log(`  - GET  /         - API info`);
    console.log(`  - GET  /health   - Health check`);
    console.log(`  - GET  /status   - Status & rate limit`);
    console.log(`  - POST /chat     - Chat endpoint`);
    console.log(`  - GET  /api/rag/status - RAG status\n`);
  });
}

// ======== EXPORT FOR VERCEL COMPATIBILITY =========
export default app;
