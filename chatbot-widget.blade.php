{{-- 
    CHATBOT WIDGET COMPONENT - VERCEL IFRAME INTEGRATION
    
    Popup widget chatbot dengan touch support untuk mobile.
    Perubahan:
    1. Menambahkan cache-buster ?v={{ time() }} ke src iframe.
    2. Menambahkan pointer-events: auto !important; untuk paksa touch.
--}}

<div id="chatbot-widget">
    <button id="chatbot-toggle" aria-label="Open Chatbot">💬</button>
    
    <div id="chatbot-frame">
        <iframe 
            src="https://kelurahan-chatbot-gemini.vercel.app/ui?v={{ time() }}"
            width="100%"
            height="100%"
            style="border: none; touch-action: auto; pointer-events: auto !important;"
            allow="microphone; camera; geolocation; accelerometer; gyroscope"
            title="Chatbot Kelurahan Marga Sari"
        ></iframe>
    </div>
</div>

<style>
/* ========== Floating Button Styles ========== */
#chatbot-toggle {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    border: none;
    font-size: 28px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    z-index: 9999;
    transition: all 0.2s ease;
    -webkit-tap-highlight-color: transparent;
}

#chatbot-toggle:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}

#chatbot-toggle:active {
    transform: scale(0.95);
}

/* ========== Chatbot Frame Styles (Desktop) ========== */
#chatbot-frame {
    position: fixed;
    bottom: 90px;
    right: 20px;
    width: 420px;
    height: 650px;
    max-height: calc(100vh - 120px); /* Prevent cutoff on small screens */
    border-radius: 15px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    overflow: hidden;
    display: none;
    z-index: 9998;
    background: white;
    pointer-events: auto !important; /* Paksa iframe bisa di-klik */
}

#chatbot-frame.active {
    display: block;
    animation: slideUp 0.3s ease-out;
}

/* ========== Animations ========== */
@keyframes slideUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

/* ========== Responsive (Mobile) ========== */
@media (max-width: 768px) {
    #chatbot-frame {
        width: calc(100vw - 20px);
        height: 600px; /* Fixed height seperti desktop */
        max-height: 600px; /* Sama dengan height */
        bottom: 75px;
        right: 10px;
        left: 10px;
        border-radius: 12px;
    }
    
    #chatbot-toggle {
        bottom: 15px;
        right: 15px;
        width: 56px;
        height: 56px;
        font-size: 24px;
    }
}

/* Extra small screens */
@media (max-width: 480px) {
    #chatbot-frame {
        width: calc(100vw - 16px);
        height: 570px; /* Fixed height untuk layar kecil */
        max-height: 570px; /* Sama dengan height */
        bottom: 70px;
        right: 8px;
        left: 8px;
        border-radius: 10px;
    }
}

/* Hide on print */
@media print {
    #chatbot-widget {
        display: none !important;
    }
}
</style>

<script>
// ========== Chatbot Widget Script ==========
(function() {
    'use strict';
    
    const toggleBtn = document.getElementById('chatbot-toggle');
    const chatFrame = document.getElementById('chatbot-frame');
    
    if (!toggleBtn || !chatFrame) {
        console.error('❌ Chatbot elements not found');
        return;
    }
    
    // Touch-friendly toggle handler
    toggleBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        if (chatFrame.classList.contains('active')) {
            // Close chatbot
            chatFrame.classList.remove('active');
            toggleBtn.textContent = '💬';
            toggleBtn.setAttribute('aria-label', 'Open Chatbot');
            sessionStorage.setItem('chatbot-open', 'false');
            console.log('Chatbot closed');
        } else {
            // Open chatbot
            chatFrame.classList.add('active');
            toggleBtn.textContent = '✖️';
            toggleBtn.setAttribute('aria-label', 'Close Chatbot');
            sessionStorage.setItem('chatbot-open', 'true');
            console.log('Chatbot opened');
        }
    });
    
    // Restore state from sessionStorage
    const chatbotState = sessionStorage.getItem('chatbot-open');
    if (chatbotState === 'true') {
        chatFrame.classList.add('active');
        toggleBtn.textContent = '✖️';
    }
    
    // Close with ESC key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && chatFrame.classList.contains('active')) {
            chatFrame.classList.remove('active');
            toggleBtn.textContent = '💬';
            toggleBtn.setAttribute('aria-label', 'Open Chatbot');
            sessionStorage.setItem('chatbot-open', 'false');
        }
    });
    
    // Prevent scroll propagation on mobile when iframe is open
    chatFrame.addEventListener('touchmove', function(e) {
        e.stopPropagation();
    }, { passive: false });
    
    // Mobile responsive detection
    if (window.innerWidth <= 768) {
        console.log('📱 Mobile device detected - Touch events enabled');
    }
})();
</script>