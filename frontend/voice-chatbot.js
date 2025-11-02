// voice-chatbot.js
// Frontend JavaScript untuk Voice UI Chatbot Kelurahan
// Menggunakan Web Speech API (SpeechRecognition + SpeechSynthesis)

// ==================== CONFIGURATION ====================
const CONFIG = {
  apiUrl: localStorage.getItem('chatbot_api_url') || 'http://localhost:3000/chat',
  speechRate: parseFloat(localStorage.getItem('chatbot_speech_rate')) || 1.0,
  selectedVoice: localStorage.getItem('chatbot_selected_voice') || null
};

// ==================== STATE MANAGEMENT ====================
let chatHistory = [];
let recognition = null;
let synthesis = window.speechSynthesis;
let availableVoices = [];
let isListening = false;
let isProcessing = false;

// ==================== DOM ELEMENTS ====================
const voiceBtn = document.getElementById('voiceBtn');
const statusText = document.getElementById('statusText');
const transcriptText = document.getElementById('transcriptText');
const responseText = document.getElementById('responseText');
const errorMessage = document.getElementById('error-message');
const infoMessage = document.getElementById('info-message');
const clearBtn = document.getElementById('clearBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const apiUrlInput = document.getElementById('apiUrl');
const voiceSelect = document.getElementById('voiceSelect');
const speechRateInput = document.getElementById('speechRate');
const rateValue = document.getElementById('rateValue');

// ==================== INITIALIZATION ====================
function init() {
  console.log('🚀 Initializing Voice Chatbot...');
  
  // Check browser support
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showError('Browser Anda tidak mendukung Speech Recognition. Gunakan Chrome, Edge, atau Safari.');
    voiceBtn.disabled = true;
    return;
  }

  if (!('speechSynthesis' in window)) {
    showError('Browser Anda tidak mendukung Text-to-Speech.');
    return;
  }

  // Initialize Speech Recognition
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'id-ID'; // Bahasa Indonesia
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  // Setup event listeners
  setupRecognitionEvents();
  setupUIEvents();
  loadVoices();
  
  // Load saved settings
  apiUrlInput.value = CONFIG.apiUrl;
  speechRateInput.value = CONFIG.speechRate;
  rateValue.textContent = CONFIG.speechRate;

  console.log('✅ Voice Chatbot initialized');
  showInfo('Sistem siap! Klik tombol mikrofon untuk berbicara.');
}

// ==================== SPEECH RECOGNITION EVENTS ====================
function setupRecognitionEvents() {
  recognition.onstart = () => {
    console.log('🎤 Speech recognition started');
    isListening = true;
    updateUI('listening');
    statusText.textContent = '🎤 Mendengarkan... Silakan bicara';
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    console.log('📝 Transcript:', transcript);
    
    transcriptText.textContent = transcript;
    
    // Send to backend
    sendMessageToBackend(transcript);
  };

  recognition.onerror = (event) => {
    console.error('❌ Speech recognition error:', event.error);
    isListening = false;
    updateUI('idle');
    
    let errorMsg = 'Terjadi kesalahan pada speech recognition.';
    
    switch (event.error) {
      case 'no-speech':
        errorMsg = 'Tidak ada suara yang terdeteksi. Silakan coba lagi.';
        break;
      case 'audio-capture':
        errorMsg = 'Mikrofon tidak terdeteksi. Pastikan mikrofon Anda terhubung.';
        break;
      case 'not-allowed':
        errorMsg = 'Akses mikrofon ditolak. Izinkan akses mikrofon di browser Anda.';
        break;
      case 'network':
        errorMsg = 'Koneksi internet bermasalah.';
        break;
    }
    
    showError(errorMsg);
    statusText.textContent = 'Klik tombol untuk mulai berbicara';
  };

  recognition.onend = () => {
    console.log('🛑 Speech recognition ended');
    if (isListening && !isProcessing) {
      isListening = false;
      updateUI('idle');
      statusText.textContent = 'Klik tombol untuk mulai berbicara';
    }
  };
}

// ==================== UI EVENTS ====================
function setupUIEvents() {
  voiceBtn.addEventListener('click', toggleVoiceRecognition);
  
  clearBtn.addEventListener('click', () => {
    chatHistory = [];
    transcriptText.innerHTML = '<em>Belum ada pertanyaan...</em>';
    responseText.innerHTML = '<em>Silakan ajukan pertanyaan terlebih dahulu...</em>';
    hideError();
    hideInfo();
    console.log('🗑️ Chat history cleared');
  });

  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('show');
  });

  apiUrlInput.addEventListener('change', (e) => {
    CONFIG.apiUrl = e.target.value;
    localStorage.setItem('chatbot_api_url', CONFIG.apiUrl);
    console.log('💾 API URL saved:', CONFIG.apiUrl);
  });

  voiceSelect.addEventListener('change', (e) => {
    CONFIG.selectedVoice = e.target.value;
    localStorage.setItem('chatbot_selected_voice', CONFIG.selectedVoice);
    console.log('💾 Voice saved:', CONFIG.selectedVoice);
  });

  speechRateInput.addEventListener('input', (e) => {
    CONFIG.speechRate = parseFloat(e.target.value);
    rateValue.textContent = CONFIG.speechRate;
    localStorage.setItem('chatbot_speech_rate', CONFIG.speechRate);
  });
}

// ==================== VOICE CONTROL ====================
function toggleVoiceRecognition() {
  if (isListening) {
    recognition.stop();
    isListening = false;
    updateUI('idle');
    statusText.textContent = 'Klik tombol untuk mulai berbicara';
  } else if (!isProcessing) {
    hideError();
    hideInfo();
    try {
      recognition.start();
    } catch (error) {
      console.error('Error starting recognition:', error);
      showError('Gagal memulai speech recognition. Coba lagi.');
    }
  }
}

// ==================== BACKEND COMMUNICATION ====================
async function sendMessageToBackend(message) {
  isProcessing = true;
  updateUI('processing');
  statusText.textContent = '⏳ Memproses pertanyaan...';
  
  try {
    console.log('📤 Sending to backend:', message);
    
    const response = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: message,
        history: chatHistory
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('📥 Response from backend:', data);

    if (data.ok && data.output?.candidates?.[0]?.content?.parts?.[0]?.text) {
      const botResponse = data.output.candidates[0].content.parts[0].text;
      
      // Update chat history
      chatHistory.push({
        role: "user",
        parts: [{ text: message }]
      });
      
      chatHistory.push({
        role: "model",
        parts: [{ text: botResponse }]
      });

      // Display response
      responseText.textContent = botResponse;

      // Speak response
      speak(botResponse);

      statusText.textContent = '✅ Selesai! Klik tombol untuk bertanya lagi';
    } else {
      throw new Error(data.error || 'Invalid response from backend');
    }

  } catch (error) {
    console.error('❌ Error communicating with backend:', error);
    showError(`Gagal menghubungi server: ${error.message}`);
    responseText.innerHTML = '<em style="color: #c62828;">Gagal mendapatkan jawaban dari server.</em>';
    statusText.textContent = 'Klik tombol untuk mencoba lagi';
  } finally {
    isProcessing = false;
    updateUI('idle');
  }
}

// ==================== TEXT-TO-SPEECH ====================
function speak(text) {
  // Cancel any ongoing speech
  synthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'id-ID';
  utterance.rate = CONFIG.speechRate;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  // Set selected voice
  if (CONFIG.selectedVoice) {
    const voice = availableVoices.find(v => v.name === CONFIG.selectedVoice);
    if (voice) {
      utterance.voice = voice;
    }
  }

  utterance.onstart = () => {
    console.log('🔊 Speaking started');
    statusText.textContent = '🔊 Membacakan jawaban...';
  };

  utterance.onend = () => {
    console.log('✅ Speaking finished');
    statusText.textContent = 'Klik tombol untuk bertanya lagi';
  };

  utterance.onerror = (event) => {
    console.error('❌ Speech synthesis error:', event.error);
    showError('Gagal membacakan jawaban.');
  };

  synthesis.speak(utterance);
}

// ==================== VOICE LOADING ====================
function loadVoices() {
  availableVoices = synthesis.getVoices();
  
  if (availableVoices.length === 0) {
    // Voices not loaded yet, wait for event
    synthesis.onvoiceschanged = () => {
      availableVoices = synthesis.getVoices();
      populateVoiceSelect();
    };
  } else {
    populateVoiceSelect();
  }
}

function populateVoiceSelect() {
  console.log(`🎵 Loaded ${availableVoices.length} voices`);
  
  // Filter Indonesian voices or fallback to all
  let indonesianVoices = availableVoices.filter(voice => 
    voice.lang.startsWith('id') || voice.lang.startsWith('ID')
  );

  if (indonesianVoices.length === 0) {
    indonesianVoices = availableVoices;
  }

  voiceSelect.innerHTML = '<option value="">Default Voice</option>';
  
  indonesianVoices.forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    
    if (CONFIG.selectedVoice === voice.name) {
      option.selected = true;
    }
    
    voiceSelect.appendChild(option);
  });
}

// ==================== UI HELPERS ====================
function updateUI(state) {
  voiceBtn.className = 'voice-button';
  statusText.className = 'status-text';
  
  switch (state) {
    case 'listening':
      voiceBtn.classList.add('listening');
      voiceBtn.textContent = '🎙️';
      statusText.classList.add('listening');
      break;
    case 'processing':
      voiceBtn.classList.add('processing');
      voiceBtn.textContent = '⏳';
      statusText.classList.add('processing');
      voiceBtn.disabled = true;
      break;
    case 'idle':
    default:
      voiceBtn.textContent = '🎤';
      voiceBtn.disabled = false;
      break;
  }
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  
  setTimeout(() => {
    hideError();
  }, 5000);
}

function hideError() {
  errorMessage.style.display = 'none';
}

function showInfo(message) {
  infoMessage.textContent = message;
  infoMessage.style.display = 'block';
  
  setTimeout(() => {
    hideInfo();
  }, 3000);
}

function hideInfo() {
  infoMessage.style.display = 'none';
}

// ==================== START APPLICATION ====================
document.addEventListener('DOMContentLoaded', init);
