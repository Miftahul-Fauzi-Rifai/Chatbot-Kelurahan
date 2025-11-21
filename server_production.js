// server_production.js
// Backend API Chatbot Kelurahan (Final Clean Version)
// Fitur: Chat Text & Voice Only, UI Original, Smart Context, Caching

import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Import Handler (Pastikan file rag_handler.js dan cache.js ada)
// Jika tidak ada, kode akan otomatis menggunakan fallback keyword
import { localRAG, semanticSearch } from './rag_handler.js';
import { makeCacheKey, getCache, setCache } from './utils/cache.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ======== MIDDLEWARE =========
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ======== CORS Configuration (Aman untuk Production) =========
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Iframe Support (Penting untuk Widget)
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Permissions-Policy', 'microphone=*, camera=*, geolocation=*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ======== REQUEST LOGGING =========
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ======== MULTI API KEY CONFIGURATION =========
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(Boolean);

let currentKeyIndex = 0;

function getNextApiKey() {
  if (API_KEYS.length === 0) throw new Error('No API keys configured');
  const key = API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  return key;
}

// ======== RATE LIMITER =========
const rateLimit = {
  requests: [],
  maxPerMinute: 15,
  canMakeRequest() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < 60000);
    return this.requests.length < this.maxPerMinute;
  },
  async waitIfNeeded() {
    if (!this.canMakeRequest()) {
      const waitTime = 2000; // Tunggu sebentar
      console.log(`⏳ Rate limit active, waiting...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requests.push(Date.now()); // Catat request baru
    } else {
      this.requests.push(Date.now());
    }
  }
};

// ======== DATA LOADING (LOGIKA GABUNGAN) =========
// Memuat data utama DAN kosakata jawa agar akurat
const TRAIN_FILE = process.env.TRAIN_DATA_FILE || './data/train.json';
const FALLBACK_TRAIN_FILE = './data/train_optimized.json';
const KLARIFIKASI_FILE = './data/kosakata_jawa.json';

function readTrainData() {
  try {
    let data = [];
    // 1. Load Data Training Utama
    if (fs.existsSync(TRAIN_FILE)) {
      data = data.concat(JSON.parse(fs.readFileSync(TRAIN_FILE, 'utf8')));
    } else if (fs.existsSync(FALLBACK_TRAIN_FILE)) {
      data = data.concat(JSON.parse(fs.readFileSync(FALLBACK_TRAIN_FILE, 'utf8')));
    }

    // 2. Load Kosakata Jawa (Agar paham istilah lokal)
    if (fs.existsSync(KLARIFIKASI_FILE)) {
      data = data.concat(JSON.parse(fs.readFileSync(KLARIFIKASI_FILE, 'utf8')));
      console.log('✅ Loaded additional local vocabulary (Javanese)');
    }

    console.log(`✅ Database Loaded: ${data.length} items`);
    return data;
  } catch (e) {
    console.error(`❌ Error loading data:`, e.message);
    return [];
  }
}

const trainingData = readTrainData();

// ======== SMART KEYWORD SEARCH (FALLBACK) =========
function findRelevantData(message, allData, maxResults = 4) {
  const lowerMessage = message.toLowerCase();
  const queryWords = lowerMessage.split(/\s+/).filter(w => w.length > 2);
  
  const scores = allData.map(item => {
    let score = 0;
    const text = (item.text || item.question || '').toLowerCase();
    const answer = (item.answer || item.response || '').toLowerCase();
    const tags = (item.tags || []).join(' ').toLowerCase();
    
    // Bobot skor
    queryWords.forEach(word => {
      if (text.includes(word)) score += 3;
      if (tags.includes(word)) score += 3;
      if (answer.includes(word)) score += 1;
    });

    // Bonus jika cocok persis
    if (text.includes(lowerMessage)) score += 10;
    
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
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rateLimit.waitIfNeeded();
      const apiKey = getNextApiKey();
      const urlWithKey = url.replace('KEY_PLACEHOLDER', apiKey);
      
      const response = await axios.post(urlWithKey, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 8000
      });
      return response.data;
    } catch (error) {
      const msg = error.response?.data?.error?.message || error.message;
      if (msg.includes('quota') || msg.includes('429')) continue; // Coba key lain
      throw error;
    }
  }
  throw new Error('All API keys exhausted');
}

// ======== UI ENDPOINT (ORIGINAL LAMA) =========
app.get('/ui', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chatbot Kelurahan Marga Sari</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      height: 100%;
      overflow: hidden;
      margin: 0;
      padding: 0;
    }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
    .chat-container { width: 100%; height: 100%; max-width: 600px; max-height: 100%; background: white; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); display: flex; flex-direction: column; overflow: hidden; margin: auto; }
    .chat-header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; }
    .chat-header h1 { font-size: 24px; margin-bottom: 5px; }
    .chat-header p { font-size: 14px; opacity: 0.9; }
    .chat-messages { flex: 1; padding: 20px; overflow-y: auto; background: #f8f9fa; -webkit-overflow-scrolling: touch; }
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
    .chat-input-wrapper { display: flex; gap: 10px; align-items: center; }
    #messageInput { flex: 1; padding: 12px 16px; border: 2px solid #e0e0e0; border-radius: 25px; font-size: 14px; outline: none; transition: border-color 0.3s; -webkit-appearance: none; touch-action: manipulation; }
    #messageInput:focus { border-color: #667eea; }
    .voice-btn { padding: 12px 16px; background: #f0f0f0; color: #333; border: none; border-radius: 25px; font-size: 20px; cursor: pointer; transition: all 0.2s; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
    .voice-btn:hover { background: #e0e0e0; }
    .voice-btn.recording { background: #ff4444; color: white; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
    .mode-toggle { display: flex; gap: 10px; margin-bottom: 10px; justify-content: center; }
    .mode-btn { padding: 8px 16px; background: #f0f0f0; border: 2px solid #e0e0e0; border-radius: 20px; font-size: 13px; cursor: pointer; transition: all 0.2s; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
    .mode-btn.active { background: #667eea; color: white; border-color: #667eea; }
    #sendBtn { padding: 12px 24px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 25px; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.2s; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
    #sendBtn:hover { transform: scale(1.05); }
    #sendBtn:disabled { opacity: 0.6; cursor: not-allowed; }
    .welcome-message { text-align: center; color: #999; margin-top: 100px; }
    .welcome-message h2 { font-size: 20px; margin-bottom: 10px; color: #667eea; }
    .welcome-message p { font-size: 14px; }
    .error-message { background: #fee; color: #c00; padding: 10px; border-radius: 8px; margin-bottom: 10px; font-size: 13px; display: none; }
    .error-message.active { display: block; }

    /* Mobile optimizations */
    @media (max-width: 768px) {
      body { padding: 0; }
      .chat-container { width: 100%; height: 100%; max-width: 100%; max-height: 100%; border-radius: 0; margin: 0; }
      .chat-header h1 { font-size: 20px; }
      .chat-header p { font-size: 12px; }
      #messageInput { font-size: 16px; } /* Prevent zoom on iOS */
      .mode-btn { padding: 10px 14px; font-size: 14px; }
      #sendBtn { padding: 12px 20px; }
    }
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
      
      let conversationHistory = [];
      let currentMode = 'text';
      let recognition = null;
      let isRecording = false;
      
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.lang = 'id-ID';
        recognition.continuous = false;
        recognition.interimResults = false;
        
        recognition.onresult = function(event) {
          const transcript = event.results[0][0].transcript;
          messageInput.value = transcript;
          isRecording = false;
          voiceBtn.classList.remove('recording');
          voiceBtn.textContent = '🎤';
          setTimeout(() => sendMessage(), 500);
        };
        
        recognition.onerror = function(event) {
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
      
      function switchMode(mode) {
        currentMode = mode;
        if (mode === 'voice') {
          textModeBtn.classList.remove('active');
          voiceModeBtn.classList.add('active');
          voiceBtn.style.display = 'block';
          messageInput.placeholder = 'Klik mikrofon atau ketik...';
          if (!recognition) {
            showError('Browser Anda tidak mendukung pengenalan suara.');
          }
        } else {
          voiceModeBtn.classList.remove('active');
          textModeBtn.classList.add('active');
          voiceBtn.style.display = 'none';
          messageInput.placeholder = 'Ketik pertanyaan Anda...';
        }
      }
      
      function speakText(text) {
        if ('speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = 'id-ID';
          window.speechSynthesis.speak(utterance);
        }
      }
      
      textModeBtn.addEventListener('click', function() { switchMode('text'); });
      voiceModeBtn.addEventListener('click', function() { switchMode('voice'); });
      
      voiceBtn.addEventListener('click', function() {
        if (!recognition) return;
        if (isRecording) {
          recognition.stop();
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
              history: conversationHistory.slice(-10)
            })
          });
          
          if (!response.ok) throw new Error('Gagal menghubungi server.');
          
          const data = await response.json();
          typingIndicator.remove();
          
          let answer = data.ok && data.output?.candidates?.[0]?.content?.parts?.[0]?.text
            ? data.output.candidates[0].content.parts[0].text
            : 'Maaf, saya tidak bisa memproses pertanyaan Anda saat ini.';
          
          conversationHistory.push({ role: 'user', parts: [{ text: message }] });
          conversationHistory.push({ role: 'model', parts: [{ text: answer }] });
          
          if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);
          
          addMessage(answer, 'bot');
          if (currentMode === 'voice') speakText(answer);
        } catch (error) {
          typingIndicator.remove();
          showError('Terjadi kesalahan. Silakan coba lagi.');
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
});

// ======== ROOT & HEALTH =========
app.get('/', (req, res) => {
  res.json({
    service: 'Chatbot Kelurahan API',
    version: '3.0.0-Stable',
    status: 'online',
    endpoints: { chat: 'POST /chat', ui: 'GET /ui' }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', items: trainingData.length });
});

// ======== MAIN CHAT ENDPOINT (FINAL) =========
app.post('/chat', async (req, res) => {
  const { message, history } = req.body || {};
  
  if (!message) return res.status(400).json({ ok: false, error: 'message required' });

  // 1. Check Cache
  const cacheKey = makeCacheKey(message);
  const cached = await getCache(cacheKey);
  if (cached) return res.json({ ...cached, cached: true });

  const replyAndCache = async (payload) => {
    try { await setCache(cacheKey, payload); } catch (e) {}
    return res.json(payload);
  };

  // 2. Context Retrieval (RAG + Keyword)
  let relevantData = [];
  try {
    // Coba Semantic Search dulu
    const ragResults = await semanticSearch(message);
    if (ragResults.length > 0) {
      relevantData = ragResults.map(res => res.doc);
    } else {
      // Fallback Keyword
      relevantData = findRelevantData(message, trainingData, 4);
    }
  } catch (e) {
    relevantData = findRelevantData(message, trainingData, 4);
  }

  const grounding = relevantData.length > 0
    ? "DATA REFERENSI (SUMBER KEBENARAN):\n" + 
      relevantData.map(d => `Tanya: ${d.text||d.question}\nJawab: ${d.answer||d.response}`).join('\n---\n')
    : "";

  // 3. System Prompt (Gabungan Terbaik)
  const systemInstruction = `Anda adalah Asisten Virtual Kelurahan Marga Sari, Balikpapan.

ATURAN UTAMA:
1. Gunakan DATA REFERENSI di bawah untuk menjawab.
2. WAJIB Bahasa Indonesia formal dan sopan.
3. Jika user bertanya bahasa daerah (Jawa/Banjar), tetap jawab Bahasa Indonesia.
4. Jangan jawab pertanyaan di luar layanan kelurahan (resep, game, dll).

${grounding ? '\n' + grounding + '\n\nJawab berdasarkan data di atas.' : ''}`;

  // 4. Generate Response
  try {
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=KEY_PLACEHOLDER`;

    const contents = [
      { role: "user", parts: [{ text: systemInstruction }] },
      { role: "model", parts: [{ text: "Siap, saya mengerti." }] },
      ...(history || []).slice(-4),
      { role: "user", parts: [{ text: message }] }
    ];

    const out = await generateWithRetry(url, {
      contents: contents,
      generationConfig: { maxOutputTokens: 500, temperature: 0.3 }
    }, modelName);

    return replyAndCache({ ok: true, output: out });

  } catch (error) {
    console.warn('⚠️ API Error, trying fallbacks...');
    
    // Fallback 1: Local RAG
    try {
      const ragRes = await localRAG(message);
      if (ragRes?.ok) {
        return replyAndCache({ ok: true, output: { candidates: [{ content: { parts: [{ text: ragRes.answer }] } }] } });
      }
    } catch (e) {}

    // Fallback 2: Keyword Match Hard
    if (relevantData.length > 0) {
      return replyAndCache({ ok: true, output: { candidates: [{ content: { parts: [{ text: relevantData[0].answer || relevantData[0].response }] } }] } });
    }

    return res.status(500).json({ ok: false, error: 'Sistem sedang sibuk.' });
  }
});

export default app;