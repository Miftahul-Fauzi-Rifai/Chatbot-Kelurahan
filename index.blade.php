<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
  <meta name="csrf-token" content="{{ csrf_token() }}">
  <title>Chatbot Kelurahan Marga Sari</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { 
      height: 100%;
      width: 100%;
      overflow: hidden;
      margin: 0;
      padding: 0;
    }
    body { 
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
      display: flex; 
      justify-content: center; 
      align-items: center; 
      padding: 20px;
    }
    .chat-container { 
      width: 100%; 
      max-width: 600px; 
      height: 100%;
      max-height: 800px; 
      background: white; 
      border-radius: 20px; 
      box-shadow: 0 20px 60px rgba(0,0,0,0.3); 
      display: flex; 
      flex-direction: column; 
      overflow: hidden; 
    }
    .chat-header { 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
      color: white; 
      padding: 20px; 
      text-align: center;
      flex-shrink: 0;
    }
    .chat-header h1 { font-size: 24px; margin-bottom: 5px; }
    .chat-header p { font-size: 14px; opacity: 0.9; }
    .chat-messages { 
      flex: 1; 
      padding: 20px; 
      overflow-y: auto; 
      background: #f8f9fa;
      -webkit-overflow-scrolling: touch;
      min-height: 0;
    }
    .message { margin-bottom: 15px; display: flex; animation: slideIn 0.3s ease; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .message.user { justify-content: flex-end; }
    .message.bot { justify-content: flex-start; }
    .message-content { 
      max-width: 70%; 
      padding: 12px 16px; 
      border-radius: 18px; 
      word-wrap: break-word; 
      line-height: 1.5; 
    }
    .message.user .message-content { 
      background: #667eea; 
      color: white; 
      border-bottom-right-radius: 4px; 
    }
    .message.bot .message-content { 
      background: white; 
      color: #333; 
      border-bottom-left-radius: 4px; 
      box-shadow: 0 2px 5px rgba(0,0,0,0.1); 
    }
    .message-time { font-size: 11px; opacity: 0.7; margin-top: 5px; text-align: right; }
    .typing-indicator { 
      display: none; 
      padding: 12px 16px; 
      background: white; 
      border-radius: 18px; 
      width: fit-content; 
      box-shadow: 0 2px 5px rgba(0,0,0,0.1); 
    }
    .typing-indicator.active { display: block; }
    .typing-indicator span { 
      display: inline-block; 
      width: 8px; 
      height: 8px; 
      border-radius: 50%; 
      background: #667eea; 
      margin: 0 2px; 
      animation: typing 1.4s infinite; 
    }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-10px); } }
    .chat-input-container { 
      padding: 20px; 
      background: white; 
      border-top: 1px solid #e0e0e0;
      flex-shrink: 0;
    }
    .chat-input-wrapper { display: flex; gap: 10px; align-items: center; }
    #messageInput { 
      flex: 1; 
      padding: 12px 16px; 
      border: 2px solid #e0e0e0; 
      border-radius: 25px; 
      font-size: 14px; 
      outline: none; 
      transition: border-color 0.3s;
      -webkit-appearance: none;
      touch-action: manipulation;
    }
    #messageInput:focus { border-color: #667eea; }
    .voice-btn { 
      padding: 12px 16px; 
      background: #f0f0f0; 
      color: #333; 
      border: none; 
      border-radius: 25px; 
      font-size: 20px; 
      cursor: pointer; 
      transition: all 0.2s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .voice-btn:active { background: #e0e0e0; transform: scale(0.95); }
    .voice-btn.recording { 
      background: #ff4444; 
      color: white; 
      animation: pulse 1.5s infinite; 
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
    .mode-toggle { 
      display: flex; 
      gap: 10px; 
      margin-bottom: 10px; 
      justify-content: center; 
    }
    .mode-btn { 
      padding: 8px 16px; 
      background: #f0f0f0; 
      border: 2px solid #e0e0e0; 
      border-radius: 20px; 
      font-size: 13px; 
      cursor: pointer; 
      transition: all 0.2s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .mode-btn:active { transform: scale(0.95); }
    .mode-btn.active { 
      background: #667eea; 
      color: white; 
      border-color: #667eea; 
    }
    #sendBtn { 
      padding: 12px 24px; 
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
      color: white; 
      border: none; 
      border-radius: 25px; 
      font-size: 14px; 
      font-weight: 600; 
      cursor: pointer; 
      transition: transform 0.2s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    #sendBtn:active { transform: scale(0.95); }
    #sendBtn:disabled { opacity: 0.6; cursor: not-allowed; }
    .welcome-message { text-align: center; color: #999; margin-top: 100px; }
    .welcome-message h2 { font-size: 20px; margin-bottom: 10px; color: #667eea; }
    .welcome-message p { font-size: 14px; }
    .error-message { 
      background: #fee; 
      color: #c00; 
      padding: 10px; 
      border-radius: 8px; 
      margin-bottom: 10px; 
      font-size: 13px; 
      display: none; 
    }
    .error-message.active { display: block; }
    
    /* Mobile optimizations */
    @media (max-width: 768px) {
      html, body {
        height: 100%;
        overflow: hidden;
      }
      body { 
        padding: 0;
        align-items: stretch; /* Ubah dari center ke stretch */
      }
      .chat-container { 
        max-width: 100%; 
        height: 100%;
        max-height: 100%;
        border-radius: 0;
        box-shadow: none; /* Hilangkan shadow di mobile */
      }
      .chat-header { 
        padding: 12px 15px;
        flex-shrink: 0; /* Tidak mengecil */
      }
      .chat-header h1 { 
        font-size: 16px; 
        margin-bottom: 3px;
      }
      .chat-header p { 
        font-size: 11px; 
      }
      .chat-messages {
        padding: 12px;
        flex: 1; /* Ambil sisa ruang */
        min-height: 0; /* Penting untuk flex child dengan overflow */
        overflow-y: auto;
      }
      .chat-input-container {
        padding: 12px;
        flex-shrink: 0; /* Tidak mengecil */
        border-top: 1px solid #e0e0e0;
        background: white; /* Pastikan bg putih */
      }
      .mode-toggle {
        margin-bottom: 8px;
        gap: 8px;
      }
      .mode-btn { 
        padding: 7px 12px; 
        font-size: 12px; 
        flex: 1;
        border-radius: 18px;
        border-width: 1px; /* Kurangi border */
      }
      .chat-input-wrapper {
        gap: 8px;
      }
      #messageInput { 
        font-size: 15px;
        padding: 9px 14px;
        border-radius: 22px;
        border-width: 1px; /* Kurangi border */
      }
      #sendBtn { 
        padding: 9px 16px; 
        font-size: 12px;
        border-radius: 22px;
        white-space: nowrap;
        flex-shrink: 0; /* Tombol tidak mengecil */
      }
      .voice-btn {
        padding: 9px 13px;
        font-size: 16px;
        border-radius: 22px;
        flex-shrink: 0; /* Tombol tidak mengecil */
      }
      .welcome-message { 
        margin-top: 15px; 
      }
      .welcome-message h2 { 
        font-size: 14px; 
      }
      .welcome-message p { 
        font-size: 10px; 
      }
      .message-content {
        max-width: 85%;
        padding: 7px 10px;
        font-size: 12px;
      }
      .message-time {
        font-size: 9px;
      }
      .error-message {
        padding: 6px;
        margin-bottom: 5px;
        font-size: 10px;
      }
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
      const API_URL = 'https://kelurahan-chatbot-gemini.vercel.app/chat';
      
      let conversationHistory = [];
      let currentMode = 'text';
      let recognition = null;
      let isRecording = false;
      
      // Speech Recognition Setup
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
      
      // Mode switching
      textModeBtn.addEventListener('click', () => switchMode('text'));
      voiceModeBtn.addEventListener('click', () => switchMode('voice'));
      
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
      
      // Voice button
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
      
      // Send message
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
          console.error('Error:', error);
          typingIndicator.remove();
          showError(error.message || 'Terjadi kesalahan.');
        } finally {
          sendBtn.disabled = false;
          messageInput.disabled = false;
          messageInput.focus();
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
          window.speechSynthesis.speak(utterance);
        }
      }
      
      function addMessage(text, sender) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}`;
        const now = new Date();
        const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        messageDiv.innerHTML = `<div class="message-content">${text.replace(/\n/g, '<br>')}<div class="message-time">${time}</div></div>`;
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
</html>