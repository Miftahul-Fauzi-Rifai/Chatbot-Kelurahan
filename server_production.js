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
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rateLimit.waitIfNeeded();
      
      console.log(`🔄 Attempt ${attempt}/${maxRetries} - ${modelName}`);
      const startTime = Date.now();
      
      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      
      const duration = Date.now() - startTime;
      console.log(`✅ Success with ${modelName} in ${duration}ms`);
      return response.data;
      
    } catch (error) {
      const statusCode = error.response?.status;
      const errorMessage = error.response?.data?.error?.message || error.message;
      
      if (statusCode === 429 && attempt < maxRetries) {
        const waitTime = 3000;
        console.log(`⚠️ Rate limit (429) - Retry in ${waitTime/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      if (errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
        console.log(`📊 Quota exceeded for ${modelName}`);
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
  // Serve chat.html sebagai homepage
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    service: 'Chatbot Kelurahan API',
    version: '2.0.0',
    status: 'online',
    endpoints: {
      chat: 'POST /chat',
      health: 'GET /health',
      status: 'GET /status'
    },
    documentation: 'https://github.com/Miftahul-Fauzi-Rifai/Chatbot-Kelurahan'
  });
});

// ======== HEALTH CHECK ENDPOINT (untuk Render monitoring) =========
app.get('/health', (req, res) => {
  const apiKeyConfigured = !!process.env.GEMINI_API_KEY;
  const dataLoaded = trainingData.length > 0;
  
  const health = {
    status: (apiKeyConfigured && dataLoaded) ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    checks: {
      api_key: apiKeyConfigured ? 'OK' : 'MISSING',
      training_data: dataLoaded ? `OK (${trainingData.length} items)` : 'EMPTY',
      memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
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
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;

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

        const out = await generateWithRetry(url, payload, model);

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
    console.warn('⚠️ All Gemini models failed, trying RAG semantic fallback...');
    
    try {
      const ragResult = await localRAG(message);

      if (ragResult?.ok && ragResult?.answer) {
        console.log(`✅ RAG Fallback success (${ragResult.sources.length} sources)`);
        return replyAndCache({
          ok: true,
          model: 'rag-local',
          output: { candidates: [{ content: { parts: [{ text: ragResult.answer }] } }] }
        });
      }
      console.warn('RAG gagal:', ragResult?.error || ragResult?.message);
    } catch (ragError) {
      console.error('RAG exception:', ragError.message);
    }
    
    // RAG failed - use keyword fallback
    console.warn('⚠️ RAG failed, using keyword fallback...');
    
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
      console.log(`✅ Keyword match found (score: ${matches[0].score})`);
      
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
    console.log(`🔑 API Key: ${process.env.GEMINI_API_KEY ? 'Configured ✓' : 'Missing ✗'}`);
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
