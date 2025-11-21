// server_production.js
// Backend API Chatbot Kelurahan (VERSION: STANDALONE & ROBUST)
// Fitur: Single File (Tanpa Dependency Luar), Otak Cerdas, UI Original, Vercel Ready

import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ======== MIDDLEWARE =========
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ======== CORS (Wajib untuk Web/Widget) =========
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.removeHeader('X-Frame-Options'); 
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ======== API KEY ROTATION =========
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(Boolean);

function getApiKey() {
  if (API_KEYS.length === 0) return null;
  return API_KEYS[Math.floor(Math.random() * API_KEYS.length)];
}

// ======== OTAK CERDAS: LOAD DATA LOKAL =========
// Kita baca file JSON langsung disini. Tanpa modul luar.
const TRAIN_FILE = process.env.TRAIN_DATA_FILE || './data/train.json';
const KLARIFIKASI_FILE = './data/kosakata_jawa.json';

let trainingData = [];

function loadData() {
  try {
    let data = [];
    // 1. Load Main Data
    if (fs.existsSync(TRAIN_FILE)) {
      data = data.concat(JSON.parse(fs.readFileSync(TRAIN_FILE, 'utf8')));
    } else if (fs.existsSync('./data/train_optimized.json')) {
      data = data.concat(JSON.parse(fs.readFileSync('./data/train_optimized.json', 'utf8')));
    }

    // 2. Load Kosakata Jawa (Fitur Cerdas)
    if (fs.existsSync(KLARIFIKASI_FILE)) {
      data = data.concat(JSON.parse(fs.readFileSync(KLARIFIKASI_FILE, 'utf8')));
    }
    
    console.log(`✅ Database Loaded: ${data.length} items`);
    return data;
  } catch (e) {
    console.error(`⚠️ Error loading data: ${e.message}`);
    return [];
  }
}

// Load data saat server nyala
trainingData = loadData();

// ======== LOGIC PENCARIAN (KEYWORD MATCHING) =========
// Ini pengganti RAG/Vector. Sederhana tapi efektif & anti-crash.
function findRelevantData(message) {
  if (!trainingData || trainingData.length === 0) return [];

  const lowerMessage = message.toLowerCase();
  const queryWords = lowerMessage.split(/\s+/).filter(w => w.length > 2);
  
  const scores = trainingData.map(item => {
    let score = 0;
    const text = (item.text || item.question || '').toLowerCase();
    const answer = (item.answer || item.response || '').toLowerCase();
    const tags = (item.tags || []).join(' ').toLowerCase();
    
    // Hitung skor kecocokan kata
    queryWords.forEach(word => {
      if (text.includes(word)) score += 3;
      if (tags.includes(word)) score += 3;
      if (answer.includes(word)) score += 1;
    });
    
    // Bonus jika kalimat mirip
    if (text.includes(lowerMessage)) score += 10;
    
    return { item, score };
  });

  // Ambil 3 data dengan skor tertinggi
  return scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(s => s.item);
}

// ======== ENDPOINT UTAMA: CHAT =========
app.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    
    if (!message) {
      return res.status(400).json({ ok: false, error: 'Pesan tidak boleh kosong' });
    }

    // 1. Cek API Key
    const apiKey = getApiKey();
    if (!apiKey) {
      // Jangan crash (Error 500), tapi beri pesan sopan
      console.error("❌ API KEY MISSING");
      return res.json({
        ok: true,
        output: { candidates: [{ content: { parts: [{ text: "⚠️ Maaf, sistem sedang dalam perbaikan (API Key Missing). Mohon coba lagi nanti." }] } }] }
      });
    }

    // 2. Cari Data Referensi (Context)
    const relevantData = findRelevantData(message);
    const grounding = relevantData.length > 0
      ? "DATA REFERENSI KELURAHAN (WAJIB DIGUNAKAN):\n" + 
        relevantData.map(d => `Q: ${d.text||d.question}\nA: ${d.answer||d.response}`).join('\n---\n')
      : "";

    // 3. Susun Prompt (Instruksi Cerdas)
    const systemInstruction = `Anda adalah Asisten Virtual Kelurahan Marga Sari, Balikpapan.

ATURAN PENTING:
1. Prioritaskan "DATA REFERENSI KELURAHAN" di bawah. Jika data bilang BISA ONLINE, maka jawab BISA.
2. Jawab WAJIB dalam BAHASA INDONESIA yang sopan dan formal.
3. Jika user bertanya bahasa daerah (Jawa/Banjar), tetap jawab Bahasa Indonesia.
4. Jawab singkat, padat, jelas (gunakan poin-poin).

${grounding}`;

    // 4. Panggil Gemini API
    // Kita gunakan axios langsung agar tidak perlu dependency @google/generative-ai yang mungkin bikin error
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const contents = [
      { role: "user", parts: [{ text: systemInstruction }] },
      ...(history || []).slice(-4), // Memori percakapan
      { role: "user", parts: [{ text: message }] }
    ];

    const apiResponse = await axios.post(url, {
      contents: contents,
      generationConfig: { maxOutputTokens: 500, temperature: 0.3 }
    }, { timeout: 10000 }); // Timeout 10 detik

    // 5. Kirim Hasil Sukses
    return res.json({ ok: true, output: apiResponse.data });

  } catch (error) {
    console.error(`❌ ERROR CHAT: ${error.message}`);
    
    // FALLBACK: Jika API Error/Timeout, gunakan data lokal langsung (Anti-Error 500)
    const fallbackData = findRelevantData(req.body.message);
    if (fallbackData.length > 0) {
        return res.json({
            ok: true,
            model: 'offline-fallback',
            output: { candidates: [{ content: { parts: [{ text: fallbackData[0].answer || fallbackData[0].response }] } }] }
        });
    }

    // Pesan error sopan jika semua gagal
    return res.json({
        ok: true,
        output: { candidates: [{ content: { parts: [{ text: "Maaf, saya sedang mengalami gangguan koneksi. Bisa diulangi pertanyaannya?" }] } }] }
    });
  }
});

// ======== ENDPOINT: UI LAMA (ORIGINAL) =========
app.get('/ui', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Chatbot Kelurahan Marga Sari</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; margin: 0; padding: 0; }
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
    @media (max-width: 768px) {
      body { padding: 0; }
      .chat-container { width: 100%; height: 100%; max-width: 100%; max-height: 100%; border-radius: 0; margin: 0; }
      .chat-header h1 { font-size: 20px; }
      .chat-header p { font-size: 12px; }
      #messageInput { font-size: 16px; }
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
          if (!recognition) showError('Browser Anda tidak mendukung pengenalan suara.');
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
            body: JSON.stringify({ message, history: conversationHistory.slice(-10) })
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
      function hideError() { errorMessage.classList.remove('active'); }
    });
  </script>
</body>
</html>`);
});

// ======== STARTUP (MANDIRI + VERCEL) =========
app.get('/', (req, res) => res.json({ status: 'online', service: 'Chatbot Kelurahan' }));
app.get('/health', (req, res) => res.json({ status: 'healthy' }));

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

export default app;