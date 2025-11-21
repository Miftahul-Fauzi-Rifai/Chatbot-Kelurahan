// server_production.js
// Backend API Chatbot Kelurahan (Versi MANDIRI & STABIL)
// Fitur: Tanpa External Handler, Otak Cerdas, Support Vercel & Local

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

// ======== CORS (Agar UI tidak error) =========
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.removeHeader('X-Frame-Options'); 
  if (req.method === 'OPTIONS') return res.status(200).end();
  next();
});

// ======== KONFIGURASI API KEY =========
const API_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(Boolean);

function getApiKey() {
  if (API_KEYS.length === 0) return null;
  // Rotasi key sederhana
  return API_KEYS[Math.floor(Math.random() * API_KEYS.length)];
}

// ======== DATA LOADING (OTAK CERDAS) =========
// Langsung baca file di sini, tanpa modul luar
const TRAIN_FILE = process.env.TRAIN_DATA_FILE || './data/train.json';
const KLARIFIKASI_FILE = './data/kosakata_jawa.json';

function readTrainData() {
  try {
    let data = [];
    
    // 1. Load Data Utama
    if (fs.existsSync(TRAIN_FILE)) {
      const content = fs.readFileSync(TRAIN_FILE, 'utf8');
      data = data.concat(JSON.parse(content));
    } else if (fs.existsSync('./data/train_optimized.json')) {
      // Fallback name
      data = data.concat(JSON.parse(fs.readFileSync('./data/train_optimized.json', 'utf8')));
    }

    // 2. Load Kosakata Jawa (Fitur Code 2)
    if (fs.existsSync(KLARIFIKASI_FILE)) {
      const content = fs.readFileSync(KLARIFIKASI_FILE, 'utf8');
      data = data.concat(JSON.parse(content));
    }
    
    console.log(`✅ Database siap: ${data.length} item`);
    return data;
  } catch (e) {
    console.error(`⚠️ Warning: Gagal baca data (${e.message}). Chatbot jalan tanpa data lokal.`);
    return [];
  }
}

const trainingData = readTrainData();

// ======== LOGIC PENCARIAN (KEYWORD MATCH) =========
function findRelevantData(message, allData) {
  if (!allData || allData.length === 0) return [];

  const lowerMessage = message.toLowerCase();
  const queryWords = lowerMessage.split(/\s+/).filter(w => w.length > 2);
  
  const scores = allData.map(item => {
    let score = 0;
    const text = (item.text || item.question || '').toLowerCase();
    const answer = (item.answer || item.response || '').toLowerCase();
    
    // Logika pencarian
    queryWords.forEach(word => {
      if (text.includes(word)) score += 3;
      if (answer.includes(word)) score += 1;
    });
    
    // Bonus jika pertanyaan mirip sekali
    if (text.includes(lowerMessage)) score += 10;
    
    return { item, score };
  });

  return scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4) // Ambil 4 data teratas
    .map(s => s.item);
}

// ======== UI ENDPOINT (UI LAMA) =========
app.get('/ui', (req, res) => {
  // Kode HTML UI Lama Anda
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

// ======== ENDPOINT UTAMA (CHAT) =========
app.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: 'Message empty' });

    // 1. VALIDASI API KEY
    const apiKey = getApiKey();
    if (!apiKey) {
      console.error("❌ ERROR: GEMINI_API_KEY tidak ditemukan di .env");
      // Kirim pesan error ke user, BUKAN error 500 crash
      return res.json({
        ok: true,
        output: {
          candidates: [{
            content: { parts: [{ text: "⚠️ Maaf, sistem sedang maintenance (API Key Missing). Mohon hubungi admin." }] }
          }]
        }
      });
    }

    // 2. CARI DATA PENDUKUNG (Context)
    const relevantData = findRelevantData(message, trainingData);
    const grounding = relevantData.length > 0
      ? "DATA REFERENSI KELURAHAN (Gunakan sebagai sumber utama):\n" + 
        relevantData.map(d => `Q: ${d.text||d.question}\nA: ${d.answer||d.response}`).join('\n---\n')
      : "";

    // 3. BUAT PROMPT
    const systemInstruction = `Anda adalah Asisten Virtual Kelurahan Marga Sari, Balikpapan.
    
    ATURAN PENTING:
    1. Gunakan DATA REFERENSI di bawah untuk menjawab. Jika data bilang BISA ONLINE, maka jawab BISA.
    2. Jawab WAJIB dalam BAHASA INDONESIA formal dan sopan.
    3. Jawab singkat, padat, jelas (gunakan poin-poin).
    
    ${grounding}`;

    // 4. KIRIM KE GEMINI
    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const contents = [
      { role: "user", parts: [{ text: systemInstruction }] },
      ...(history || []).slice(-4), // Ambil 4 chat terakhir untuk memori
      { role: "user", parts: [{ text: message }] }
    ];

    const apiResponse = await axios.post(url, {
      contents: contents,
      generationConfig: { maxOutputTokens: 500, temperature: 0.3 }
    }, { timeout: 10000 });

    // 5. KIRIM HASIL
    res.json({ ok: true, output: apiResponse.data });

  } catch (error) {
    console.error(`❌ Error Chat: ${error.message}`);
    
    // FALLBACK: JIKA GEMINI ERROR, PAKAI KEYWORD SEARCH LOKAL (Agar tidak error 500)
    const localFallback = findRelevantData(req.body.message, trainingData);
    if (localFallback.length > 0) {
      return res.json({
        ok: true,
        output: {
          candidates: [{
            content: { parts: [{ text: localFallback[0].answer || localFallback[0].response }] }
          }]
        }
      });
    }

    // ERROR TERAKHIR JIKA SEMUA GAGAL
    res.status(500).json({ ok: false, error: "Maaf, terjadi kesalahan internal." });
  }
});

app.get('/', (req, res) => res.json({ status: 'online', service: 'Chatbot Kelurahan' }));

// ======== START SERVER (HYBRID) =========
// Ini penting untuk Vercel & Localhost
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`🚀 Server berjalan di http://localhost:${PORT}`));
}

export default app;