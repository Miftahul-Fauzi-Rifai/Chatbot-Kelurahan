// server_production.js
// Backend API chatbot untuk deployment
// Fokus: REST API only, CORS-friendly, production-ready

import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ======== IMPORT MODULE LOKAL =========
// Pastikan file rag_handler.js dan utils/cache.js ada di folder yang sesuai
import { localRAG, getRAGStatus, semanticSearch } from './rag_handler.js';
import { makeCacheKey, getCache, setCache, getCacheStats } from './utils/cache.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. MIDDLEWARE & SECURITY CONFIGURATION
// ==========================================
app.use(express.json());

// Serve static files dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// CORS & IFRAME Headers (Agar bisa di-embed di website lain/HP)
app.use((req, res, next) => {
  // Izinkan semua origin (Bisa diakses dari mana saja)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Security Headers untuk Mobile Support
  res.removeHeader('X-Frame-Options'); // Izinkan Iframe
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  
  // Izin fitur HP (Mic untuk voice typing, Lokasi, dll)
  res.setHeader('Permissions-Policy', 'microphone=*, camera=*, geolocation=*, accelerometer=*, gyroscope=*, magnetometer=*');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Logging setiap request yang masuk (untuk debugging)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - Origin: ${req.headers.origin || 'direct'}`);
  next();
});

// ==========================================
// 2. API KEY MANAGEMENT (ROTATION SYSTEM)
// ==========================================
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(Boolean); // Hapus key yang kosong/undefined

let currentKeyIndex = 0;

// Fungsi untuk ganti kunci otomatis jika limit habis
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

// ==========================================
// 3. RATE LIMITER (PENGAMAN KUOTA)
// ==========================================
const rateLimit = {
  requests: [],
  maxPerMinute: 10, // Sesuaikan dengan kuota free tier Gemini
  
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

// ==========================================
// 4. DATA MANAGEMENT & SEARCH LOGIC
// ==========================================
const TRAIN_FILE = path.join(process.cwd(), 'data', 'train.json');

function readTrainData() {
  try {
    if (!fs.existsSync(TRAIN_FILE)) {
      console.warn(`⚠️ Warning: ${TRAIN_FILE} not found. Checking fallback...`);
      const fallbackPath = path.join(process.cwd(), 'train.json');
      if (fs.existsSync(fallbackPath)) {
        console.log(`✅ Loaded data from fallback path: ${fallbackPath}`);
        return JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
      }
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

const trainingData = readTrainData();

// [FITUR BARU] AUTO-SUMMARIZER
// Membuat rangkuman otomatis tentang "Kemampuan Bot" berdasarkan isi train.json
// Ini menyelesaikan masalah user tanya "Kamu bisa apa aja?"
function getTopicSummary(data) {
  if (!data || data.length === 0) return "Data layanan belum tersedia.";
  
  const categories = new Set();
  const topics = new Set();

  data.forEach(item => {
    if (item.kategori_utama) categories.add(item.kategori_utama);
    else if (item.kategori) categories.add(item.kategori);

    if (item.tags && Array.isArray(item.tags)) {
      item.tags.forEach(tag => {
        if (tag.length > 3 && !tag.includes('tanya')) topics.add(tag);
      });
    }
    
    if (!item.kategori && !item.tags) {
        const words = (item.text || item.question || "").split(' ');
        if (words.length > 1) topics.add(words.slice(0, 2).join(' '));
    }
  });

  const catList = Array.from(categories).join(', ');
  const topicList = Array.from(topics).slice(0, 20).join(', '); // Ambil top 20 topik saja

  return `Layanan Administrasi (${catList}), serta topik spesifik seperti: ${topicList}, dan informasi kelurahan lainnya.`;
}

// Simpan "Pengetahuan Dasar" bot ke variabel global
const KNOWLEDGE_SUMMARY = getTopicSummary(trainingData);
console.log("🧠 Knowledge Base Summary Loaded.");

// Tokenizer Sederhana untuk Keyword Matching
const STOP_WORDS = new Set([
  'apa','apakah','bagaimana','gimana','dimana','dimanakah','berapa','tolong','mohon',
  'bisakah','bisa','saya','saya','untuk','yang','dan','atau','dengan','minta','ingin',
  'butuh','halo','hai','hello','mohon','please','tolonglah','ap','ayo','dong','nih',
  'nih','kami','kita','anda','kamu','sih','kah','ya','deh','dong','serta','agar','supaya','dapat','para',
  'cara','secara','di'
]);

function tokenizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 3 && !STOP_WORDS.has(word));
}

function computeDirectMatchScore(message, item) {
  const queryWords = new Set(tokenizeText(message));
  if (queryWords.size === 0) return 0;

  const haystack = [
    item.text || item.question || '',
    item.answer || item.response || '',
    (item.tags || []).join(' '),
    item.kategori_utama || item.kategori || ''
  ].join(' ').toLowerCase();

  let hits = 0;
  queryWords.forEach(word => {
    if (haystack.includes(word)) hits += 1;
  });

  return hits / queryWords.size;
}

function getBestDirectMatch(message, docs = []) {
  let best = null;
  docs.forEach(doc => {
    const score = computeDirectMatchScore(message, doc);
    if (!best || score > best.score) {
      best = { item: doc, score };
    }
  });
  return best;
}

// Fungsi Pencarian Keyword (dengan logika khusus untuk 'online')
function findRelevantData(message, allData, maxResults = 3) {
  const lowerMessage = message.toLowerCase();
  const queryWords = lowerMessage.split(/\s+/);
  const isOnlineQuery = lowerMessage.includes('online') || lowerMessage.includes('web') || lowerMessage.includes('aplikasi');
  const isDefinitionQuestion = /^(apa|apakah)\s+(itu|kepanjangan|arti)\s+/i.test(message);
  
  const scores = allData.map(item => {
    let score = 0;
    const text = (item.text || item.question || '').toLowerCase();
    const answer = (item.answer || item.response || '').toLowerCase();
    const tags = (item.tags || []).map(t => t.toLowerCase());
    const kategori = (item.kategori_utama || '').toLowerCase();
    const tagsString = tags.join(' ');

    if (isDefinitionQuestion) {
      const termMatch = message.match(/(?:apa|apakah)\s+(?:itu|kepanjangan|arti)\s+(.+?)(?:\?|$)/i);
      if (termMatch) {
        const term = termMatch[1].toLowerCase().trim();
        if (text.includes(term)) score += 10;
        if (kategori.includes('istilah') && (text.includes(term) || tagsString.includes(term))) score += 15;
      }
    }
    
    queryWords.forEach(word => {
      if (word.length < 3) return;
      if (text.includes(word)) score += 2;
      if (tagsString.includes(word)) score += 2;
      if (answer.includes(word)) score += 1;
    });

    // Boost skor jika pertanyaan tentang online dan data mengandung 'online'
    if (isOnlineQuery) {
       if (text.includes('online') || tags.includes('online')) score += 50;
    }
    
    return { item, score };
  });

  return scores.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, maxResults).map(s => s.item);
}

function mergeDocLists(primary = [], secondary = []) {
  const seen = new Set();
  const result = [];
  const pushDoc = (doc) => {
    if (!doc) return;
    const key = doc.id || doc.text || doc.question || JSON.stringify(doc).slice(0, 50);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(doc);
  };
  primary.forEach(pushDoc);
  secondary.forEach(pushDoc);
  return result;
}

const DIRECT_ANSWER_THRESHOLD = parseFloat(process.env.DIRECT_ANSWER_THRESHOLD || '0.35');

// Fungsi Retry untuk memanggil Gemini API (Rotasi Kunci Otomatis)
async function generateWithRetry(url, payload, modelName, maxRetries = 2) {
  const totalKeys = API_KEYS.length;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rateLimit.waitIfNeeded();
      const apiKey = getNextApiKey();
      const urlWithKey = url.replace(/key=[^&]*/, `key=${apiKey}`);
      
      const response = await axios.post(urlWithKey, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 3000
      });
      return response.data;
      
    } catch (error) {
      const statusCode = error.response?.status;
      const errorMessage = error.response?.data?.error?.message || error.message;
      
      if (statusCode === 429 || errorMessage.includes('quota')) {
         if (totalKeys > 1 && attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        throw new Error('QUOTA_EXCEEDED');
      }
      throw error;
    }
  }
  throw new Error(`Max retries (${maxRetries}) exceeded`);
}

// ==========================================
// 5. ROUTES & ENDPOINTS
// ==========================================

app.get('/', (req, res) => res.json({ 
    service: 'Chatbot API', 
    status: 'online', 
    endpoints: { chat: 'POST /chat' }, 
    ui_url: '/ui' 
}));

// UI Chat Interface (HTML dikembalikan sebagai String agar tidak perlu file terpisah)
app.get('/ui', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chatbot Kelurahan Marga Sari</title>
  <style>
    /* CSS RESET & BASIC LAYOUT */
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; margin: 0; padding: 0; }
    body { 
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
    }
    
    /* CHAT CONTAINER */
    .chat-container { 
        width: 100%; height: 100%; max-width: 600px; max-height: 100%; 
        background: white; border-radius: 20px; 
        box-shadow: 0 20px 60px rgba(0,0,0,0.3); 
        display: flex; flex-direction: column; 
        overflow: hidden; margin: auto; 
    }
    
    /* HEADER */
    .chat-header { 
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
        color: white; padding: 20px; text-align: center; 
    }
    .chat-header h1 { font-size: 24px; margin-bottom: 5px; }
    .chat-header p { font-size: 14px; opacity: 0.9; }
    
    /* MESSAGES AREA */
    .chat-messages { 
        flex: 1; padding: 20px; overflow-y: auto; 
        background: #f8f9fa; 
        -webkit-overflow-scrolling: touch; 
    }
    
    /* BUBBLE CHAT */
    .message { margin-bottom: 15px; display: flex; animation: slideIn 0.3s ease; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    
    .message.user { justify-content: flex-end; }
    .message.bot { justify-content: flex-start; }
    
    .message-content { 
        max-width: 70%; padding: 12px 16px; 
        border-radius: 18px; word-wrap: break-word; line-height: 1.5; 
    }
    .message.user .message-content { 
        background: #667eea; color: white; 
        border-bottom-right-radius: 4px; 
    }
    .message.bot .message-content { 
        background: white; color: #333; 
        border-bottom-left-radius: 4px; 
        box-shadow: 0 2px 5px rgba(0,0,0,0.1); 
    }
    .message-time { 
        font-size: 11px; opacity: 0.7; 
        margin-top: 5px; text-align: right; 
    }
    
    /* INPUT AREA */
    .chat-input-container { 
        padding: 20px; background: white; 
        border-top: 1px solid #e0e0e0; 
    }
    .chat-input-wrapper { display: flex; gap: 10px; align-items: center; }
    
    #messageInput { 
        flex: 1; padding: 12px 16px; 
        border: 2px solid #e0e0e0; border-radius: 25px; 
        font-size: 14px; outline: none; 
        transition: border-color 0.3s; 
    }
    #messageInput:focus { border-color: #667eea; }
    
    #sendBtn { 
        padding: 12px 24px; 
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
        color: white; border: none; border-radius: 25px; 
        font-size: 14px; font-weight: 600; 
        cursor: pointer; transition: transform 0.2s; 
    }
    #sendBtn:hover { transform: scale(1.05); }
    
    /* UTILS & LOADING */
    .typing-indicator { display: none; padding: 12px 16px; background: white; border-radius: 18px; width: fit-content; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
    .typing-indicator.active { display: block; }
    .typing-indicator span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #667eea; margin: 0 2px; animation: typing 1.4s infinite; }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-10px); } }
    
    .mode-toggle { display: flex; gap: 10px; margin-bottom: 10px; justify-content: center; }
    .mode-btn { padding: 8px 16px; background: #f0f0f0; border: 2px solid #e0e0e0; border-radius: 20px; font-size: 13px; cursor: pointer; }
    .mode-btn.active { background: #667eea; color: white; border-color: #667eea; }
    
    .error-message { background: #fee; color: #c00; padding: 10px; border-radius: 8px; margin-bottom: 10px; font-size: 13px; display: none; }
    .error-message.active { display: block; }

    /* MOBILE RESPONSIVE */
    @media (max-width: 768px) {
      body { padding: 0; }
      .chat-container { border-radius: 0; margin: 0; }
      #messageInput { font-size: 16px; }
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
      <div class="welcome-message" style="text-align: center; margin-top: 100px; color: #999;">
        <h2 style="font-size: 20px; margin-bottom: 10px; color: #667eea;">Selamat Datang! 👋</h2>
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
        <button id="voiceBtn" class="mode-btn" style="display: none; font-size: 20px;">🎤</button>
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
      
      // SETUP SPEECH RECOGNITION
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
          voiceBtn.style.background = '#f0f0f0';
          voiceBtn.textContent = '🎤';
          setTimeout(() => sendMessage(), 500);
        };
        recognition.onerror = function(event) {
          console.error('Speech recognition error:', event.error);
          isRecording = false;
          voiceBtn.style.background = '#f0f0f0';
          voiceBtn.textContent = '🎤';
          showError('Gagal mengenali suara. Coba lagi.');
        };
        recognition.onend = function() {
          isRecording = false;
          voiceBtn.style.background = '#f0f0f0';
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
          if (!recognition) showError('Browser Anda tidak mendukung pengenalan suara. Gunakan Chrome/Edge.');
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
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
          utterance.volume = 1.0;
          if (window.speechSynthesis.getVoices().length === 0) {
            window.speechSynthesis.addEventListener('voiceschanged', function() {
              window.speechSynthesis.speak(utterance);
            }, { once: true });
          } else {
            window.speechSynthesis.speak(utterance);
          }
        }
      }
      
      textModeBtn.addEventListener('click', function() { switchMode('text'); });
      voiceModeBtn.addEventListener('click', function() { switchMode('voice'); });
      
      voiceBtn.addEventListener('click', function() {
        if (!recognition) { showError('Pengenalan suara tidak tersedia di browser ini.'); return; }
        if (isRecording) { recognition.stop(); isRecording = false; voiceBtn.style.background = '#f0f0f0'; voiceBtn.textContent = '🎤'; }
        else { recognition.start(); isRecording = true; voiceBtn.style.background = '#ff4444'; voiceBtn.textContent = '⏹️'; }
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
            body: JSON.stringify({ message, history: conversationHistory.slice(-10) })
          });
          
          if (!response.ok) throw new Error('Gagal menghubungi server. Silakan coba lagi.');
          const data = await response.json();
          typingIndicator.remove();
          
          let answer = (data.ok && data.output?.candidates?.[0]?.content?.parts?.[0]?.text) ? data.output.candidates[0].content.parts[0].text : 'Maaf, saya tidak bisa memproses pertanyaan Anda saat ini.';
          
          conversationHistory.push({ role: 'user', parts: [{ text: message }] });
          conversationHistory.push({ role: 'model', parts: [{ text: answer }] });
          if (conversationHistory.length > 10) conversationHistory = conversationHistory.slice(-10);
          
          addMessage(answer, 'bot');
          if (currentMode === 'voice') speakText(answer);
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
      
      function showError(message) { errorMessage.textContent = '❌ ' + message; errorMessage.classList.add('active'); }
      function hideError() { errorMessage.classList.remove('active'); }
    });
  </script>
</body>
</html>`);
});

app.get('/health', (req, res) => {
  const apiKeysConfigured = API_KEYS.length;
  const dataLoaded = trainingData.length > 0;
  res.status((apiKeysConfigured > 0 && dataLoaded) ? 200 : 503).json({ status: (apiKeysConfigured > 0 && dataLoaded) ? 'healthy' : 'degraded', checks: { training_data: dataLoaded ? `OK (${trainingData.length})` : 'EMPTY' } });
});

app.get('/status', (req, res) => res.json({ ok: true, server: 'online', data: { items: trainingData.length } }));

// ==========================================
// 6. HELPER FUNCTIONS (CONTEXT ENGINE)
// ==========================================

// Deteksi pertanyaan lanjutan (Context Awareness)
function isFollowUpQuestion(message) {
  const lower = message.toLowerCase();
  const followUpTriggers = ['syarat', 'caranya', 'biayanya', 'berapa', 'dimana', 'dokumen', 'berkas', 'bikinnya', 'buatnya', 'gimana', 'itu', 'saja', 'online', 'offline', 'bisa gak', 'apakah'];
  const isShort = message.split(/\s+/).length <= 5;
  return isShort || followUpTriggers.some(t => lower.includes(t));
}

function getLastUserTopic(history) {
  if (!history || !Array.isArray(history) || history.length === 0) return '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') return history[i].parts[0].text;
  }
  return '';
}

// ==========================================
// 7. MAIN CHAT ENDPOINT (THE BRAIN)
// ==========================================
app.post('/chat', async (req, res) => {
  const { message, history } = req.body || {};
  if (!message) return res.status(400).json({ ok: false, error: 'message field is required' });

  console.log(`💬 Chat request: "${message.substring(0, 50)}..."`);
  if (API_KEYS.length === 0) return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY not configured.' });

  // --- STEP 1: Bangun Query Kontekstual ---
  let searchQuery = message;
  let isContextualSearch = false;

  if (history && history.length > 0 && isFollowUpQuestion(message)) {
    const lastTopic = getLastUserTopic(history);
    if (lastTopic) {
      searchQuery = `${lastTopic} ${message}`;
      console.log(`🔗 Contextual Search Active: "${message}" -> "${searchQuery}"`);
      isContextualSearch = true;
    }
  }
  
  // --- STEP 2: Cek Cache (Hemat Kuota) ---
  const cacheKey = makeCacheKey(searchQuery);
  const cached = await getCache(cacheKey);
  
  if (cached && !isContextualSearch) {
    console.log('♻️ Returning cached response');
    return res.json({ ...cached, cached: true });
  }
  
  const replyAndCache = async (payload) => {
    try { await setCache(cacheKey, payload); } catch (err) { console.warn('⚠️ Cache set failed:', err?.message); }
    return res.json(payload);
  };

  // Helper: Kirim jawaban langsung dari database (Direct Match)
  const respondWithDirectDoc = async (doc, score, label = 'direct-data') => {
    if (!doc || !doc.answer) return null;
    return replyAndCache({
      ok: true, model: label, directMatchScore: score, directMatchId: doc.id,
      output: { candidates: [{ content: { parts: [{ text: doc.answer }] } }] }
    });
  };

  // Helper: Coba cari jawaban persis
  const tryDirectAnswer = async (docs, label = 'direct-data') => {
    if (!docs || docs.length === 0) return null;
    const threshold = isContextualSearch ? 0.85 : DIRECT_ANSWER_THRESHOLD;
    const directMatch = getBestDirectMatch(searchQuery, docs);
    if (directMatch && directMatch.item && directMatch.score >= threshold) {
      return respondWithDirectDoc(directMatch.item, directMatch.score, label);
    }
    return null;
  };
  
  // --- STEP 3: Pencarian Data (RAG + Keyword) ---
  let relevantData = [];
  let ragSource = 'none';

  try {
    // Coba Semantic Search (Vector)
    const ragResults = await semanticSearch(searchQuery);
    if (ragResults.length > 0) {
      relevantData = ragResults.map(res => res.doc);
      ragSource = 'semantic';
    } else {
      // Fallback ke Keyword Search
      relevantData = findRelevantData(searchQuery, trainingData, 3);
      ragSource = 'keyword';
    }
  } catch (e) {
    relevantData = findRelevantData(searchQuery, trainingData, 3);
    ragSource = 'fallback-keyword';
  }

  // Gabungkan hasil pencarian
  const keywordBoosted = findRelevantData(searchQuery, trainingData, 5);
  const directDocs = mergeDocLists(relevantData, keywordBoosted);

  // --- STEP 4: Cek Direct Answer (Tanpa LLM) ---
  let directResponse = await tryDirectAnswer(directDocs, 'direct-data-initial');
  if (directResponse) return directResponse;

  if (process.env.DIRECT_SEARCH_EXPANDED !== 'off') {
    const expandedDocs = findRelevantData(searchQuery, trainingData, 50);
    const mergedExpanded = mergeDocLists(directDocs, expandedDocs);
    directResponse = await tryDirectAnswer(mergedExpanded, 'direct-data-expanded');
    if (directResponse) return directResponse;
  }

  // --- STEP 5: Generate Jawaban dengan Gemini (LLM) ---
  // Siapkan Grounding (Data Pendukung)
  const grounding = directDocs.length > 0
    ? "DATA REFERENSI (Gunakan ini sebagai sumber kebenaran MUTLAK untuk detail prosedur):\n" + 
      directDocs.map(d => `[Kategori: ${d.kategori_utama}]\nTanya: ${d.text || d.question}\nJawab: ${d.answer || d.response}`).join('\n---\n')
    : "";

  // SYSTEM INSTRUCTION (OTAK BOT)
  // Di sini kita suntikkan "KNOWLEDGE_SUMMARY" agar bot tahu dia bisa apa saja
  const systemInstruction = `Anda adalah Asisten Virtual Kelurahan Marga Sari, Balikpapan.

RUANG LINGKUP PENGETAHUAN ANDA:
Anda memiliki informasi lengkap mengenai: ${KNOWLEDGE_SUMMARY}.

INSTRUKSI PENTING:
1. Jika user bertanya "Bisa apa?", "Layanan apa saja?", atau "Bantuan apa?", JAWABLAH dengan merangkum "Ruang Lingkup Pengetahuan Anda" di atas. Jangan bilang tidak tahu.
2. Untuk pertanyaan prosedur spesifik, jawab HANYA berdasarkan "DATA REFERENSI" di bawah.
3. Jika Data Referensi menyarankan ONLINE, tawarkan itu sebagai opsi utama.
4. KONTEKS: Jika pertanyaan user ambigu (misal "Syaratnya apa?"), hubungkan dengan topik percakapan sebelumnya.

DATA REFERENSI SPESIFIK (Hasil Pencarian):
==================================
${grounding}
==================================

Pertanyaan User: "${message}"`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY not configured' });

  try {
    const models = [process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    
    for (const model of models) {
      try {
        const apiVersion = model.includes('2.0') ? 'v1beta' : 'v1';
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=PLACEHOLDER`;

        const contents = [];
        contents.push({ role: "user", parts: [{ text: systemInstruction }] });
        if (history && Array.isArray(history) && history.length > 0) contents.push(...history.slice(-5));
        contents.push({ role: "user", parts: [{ text: message }] });

        const payload = { contents, generationConfig: { maxOutputTokens: 800, temperature: 0.3, topP: 0.95, topK: 40 } };
        const out = await generateWithRetry(url, payload, model, 2);

        if (!out.candidates || !out.candidates[0].content) throw new Error("Invalid API response");

        return replyAndCache({ ok: true, model, output: out, ragSource });
        
      } catch (modelError) {
        const errorMsg = modelError.message || modelError.response?.data?.error?.message;
        console.warn(`⚠️ Model ${model} failed: ${errorMsg}`);
        if (errorMsg.includes('QUOTA_EXCEEDED') || errorMsg.includes('RESOURCE_EXHAUSTED')) continue;
        continue;
      }
    }
    
    // --- STEP 6: Fallback Terakhir (Jika Gemini Mati) ---
    try {
      const ragResult = await localRAG(searchQuery);
      if (ragResult?.ok && ragResult?.answer) {
        return replyAndCache({ ok: true, model: 'rag-local', output: { candidates: [{ content: { parts: [{ text: ragResult.answer }] } }] } });
      }
    } catch (ragError) { console.error('❌ Layer 4 EXCEPTION:', ragError.message); }
    
    const matches = trainingData.map(item => {
        let score = 0;
        const text = (item.text || '').toLowerCase();
        if (searchQuery.split(' ').some(w => w.length > 3 && text.includes(w.toLowerCase()))) score += 10;
        return { item, score };
    }).sort((a, b) => b.score - a.score);

    if (matches.length > 0 && matches[0].score > 0) {
       return replyAndCache({ ok: true, model: 'keyword-fallback', output: { candidates: [{ content: { parts: [{ text: matches[0].item.answer }] } }] } });
    }
    
    return replyAndCache({ 
      ok: true, model: 'fallback-generic',
      output: { candidates: [{ content: { parts: [{ text: `Maaf, saya kurang paham detail pertanyaan Anda. Apakah maksud Anda terkait layanan tertentu? (Misal: "Syarat KTP" atau "Cara Domisili").\n\nBisa diperjelas agar saya bisa bantu lebih baik? Terima kasih.` }] } }] }
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Maaf, terjadi gangguan sementara.', detail: err.message });
  }
});

export default app;