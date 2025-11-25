// server_production.js
// Backend API chatbot untuk deployment
// Fokus: REST API only, CORS-friendly, production-ready

import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage() });
import { localRAG, getRAGStatus, semanticSearch } from './rag_handler.js';
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
  
  // ======== IFRAME EMBEDDING SUPPORT (untuk mobile widget) =========
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', 'frame-ancestors *');
  
  // Security headers tambahan untuk mobile compatibility
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  
  // CRITICAL: Permissions Policy untuk touch events di mobile iframe
  res.setHeader('Permissions-Policy', 'microphone=*, camera=*, geolocation=*, accelerometer=*, gyroscope=*, magnetometer=*');
  
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

// Load data saat startup
const trainingData = readTrainData();

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

// ======== FUNGSI PENCARIAN KEYWORD =========
function findRelevantData(message, allData, maxResults = 3) {
  const lowerMessage = message.toLowerCase();
  const queryWords = lowerMessage.split(/\s+/);
  
  const isOnlineQuery = lowerMessage.includes('online') || 
                        lowerMessage.includes('web') || 
                        lowerMessage.includes('website') ||
                        lowerMessage.includes('aplikasi') ||
                        lowerMessage.includes('internet');
  
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
        if (kategori.includes('istilah') && (text.includes(term) || tagsString.includes(term))) {
          score += 15;
        }
      }
    }
    
    queryWords.forEach(word => {
      if (word.length < 3) return;
      if (text.includes(word)) score += 2;
      if (tagsString.includes(word)) score += 2;
      if (answer.includes(word)) score += 1;
    });

    if (isOnlineQuery) {
       if (text.includes('online') || tags.includes('online') || tags.includes('layanan online')) {
         score += 50;
       }
    }
    
    return { item, score };
  });

  return scores
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => s.item);
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

// ======== RETRY LOGIC =========
async function generateWithRetry(url, payload, modelName, maxRetries = 2) {
  const totalKeys = API_KEYS.length;
  const attemptsPerKey = Math.max(1, Math.floor(maxRetries / Math.max(1, totalKeys)));
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await rateLimit.waitIfNeeded();
      
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
        if (totalKeys > 1 && attempt < maxRetries) {
          console.log(`⚠️ Rate limit (429) [Key ${keyInfo.current}] - Rotating to next key...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        console.log(`⚠️ Rate limit (429) - All keys exhausted, skip to next layer`);
        throw new Error('QUOTA_EXCEEDED');
      }
      
      if (errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
        console.log(`📊 Quota exceeded [Key ${keyInfo.current}]`);
        
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
    version: '2.1.0',
    status: 'online',
    endpoints: {
      chat: 'POST /chat',
      chat_image: 'POST /chat-image',
      health: 'GET /health',
      status: 'GET /status',
      ui: 'GET /ui (Chat Interface)'
    },
    documentation: 'https://github.com/Miftahul-Fauzi-Rifai/Chatbot-Kelurahan',
    ui_url: '/ui'
  });
});

// ======== UI Chat Interface =========
app.get('/ui', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ======== HEALTH CHECK ENDPOINT =========
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

// ======== HELPER: CONTEXT AWARENESS =========
function isFollowUpQuestion(message) {
  const lower = message.toLowerCase();
  const followUpTriggers = [
    'syarat', 'caranya', 'biayanya', 'berapa', 'dimana', 
    'dokumen', 'berkas', 'bikinnya', 'buatnya', 'gimana',
    'itu', 'saja', 'online', 'offline', 'bisa gak', 'apakah'
  ];
  const isShort = message.split(/\s+/).length <= 5;
  const hasTrigger = followUpTriggers.some(t => lower.includes(t));
  return isShort || hasTrigger;
}

function getLastUserTopic(history) {
  if (!history || !Array.isArray(history) || history.length === 0) return '';
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      return history[i].parts[0].text;
    }
  }
  return '';
}

// ======== IMAGE DOC HELPERS =========
function normalizeTitle(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isJunkTitle(str) {
  if (!str) return true;

  const junkWords = [
    "provinsi", "kota", "kabupaten", "kecamatan", "kelurahan",
    "pemerintah", "kementerian", "indonesia",
    "pemkot", "pemkab",
    "nomor", "perihal",
    "tempat anda", "kota anda"
  ];

  const clean = normalizeTitle(str);
  let hits = 0;

  for (const j of junkWords) {
    if (clean.includes(j)) hits++;
  }

  return hits >= 2; // jika 2 keyword sampah muncul → judul tidak valid
}

function matchDocument(title, data) {
  const norm = normalizeTitle(title);
  const titleWords = norm.split(" ").filter(w => w.length >= 4);

  let bestMatch = null;
  let bestScore = 0;

  for (const item of data) {
    const fields = normalizeTitle(
      [
        item.text || "",
        item.answer || "",
        (item.tags || []).join(" "),
        item.kategori_utama || "",
        item.judul || ""
      ].join(" ")
    );

    // Exact match
    if (fields.includes(norm)) {
      return item;
    }

    // Hit score
    let hits = 0;
    for (const w of titleWords) {
      if (fields.includes(w)) hits++;
    }

    if (hits > bestScore) {
      bestScore = hits;
      bestMatch = item;
    }
  }

  // Butuh minimal 2 kata cocok
  if (bestScore >= 2) return bestMatch;

  return null;
}

// ======== IMAGE CHAT ENDPOINT (AUTO ANSWER MODE) =========
app.post('/chat-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ ok: false, error: "No image uploaded" });

    const base64 = req.file.buffer.toString('base64');

    // Step 1: Deteksi judul dokumen dengan Gemini Vision
    const visionResp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{
          parts: [
            { text: "Identify the title of this Indonesian administrative document. Return ONLY the title." },
            { inlineData: { data: base64, mimeType: req.file.mimetype } }
          ]
        }]
      }
    );

    const detected = visionResp.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    // ==== FILTER OCR SAMPAH / HEADER SURAT ====
    if (!detected || isJunkTitle(detected)) {
      return res.json({
        ok: true,
        detected_title: detected || "(Tidak dikenali)",
        answer:
          "Maaf, saya tidak dapat mengenali jenis surat dari gambar ini. " +
          "Pastikan bagian judul atau isi utama surat terlihat jelas."
      });
    }

    const norm = normalizeTitle(detected);
    const match = matchDocument(norm, trainingData);

    // Step 2: Jika tidak ditemukan, langsung fallback
    if (!match) {
      return res.json({
        ok: true,
        detected_title: detected,
        answer: `Dokumen terdeteksi: ${detected}\n\nNamun tidak ditemukan data yang cocok dalam database.`
      });
    }

    // Step 3: Jika ditemukan → Auto Answer menggunakan trainingData
    const finalAnswer = match.answer || "Data tersedia, tetapi tidak ada jawaban tertulis.";

    return res.json({
      ok: true,
      detected_title: detected,
      matched_id: match.id,
      matched_json: match,
      answer: finalAnswer
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
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
  
    // ===== FILTER PERTANYAAN DI LUAR TOPIK =====
  const outOfScopeKeywords = [
    "masak", "makanan", "resep", "kue", "minuman", "es krim", "eskrim",
    "hp", "gadget", "android", "iphone",
    "tiktok", "instagram", "youtube",
    "game", "ml", "free fire", "pubg",
    "laptop", "komputer",
    "dokter", "kesehatan", "obat",
    "crypto", "bitcoin", "trading", "saham", "forex"
  ];

  const lowerMsg = message.toLowerCase();

  if (outOfScopeKeywords.some(k => lowerMsg.includes(k))) {
    return res.json({
      ok: true,
      model: "out-of-scope-filter",
      output: {
        candidates: [{
          content: {
            parts: [{
              text: "Maaf, sebagai Asisten Virtual Kelurahan Marga Sari, saya hanya dapat membantu informasi terkait layanan administrasi kelurahan dan kependudukan. Apakah ada yang bisa saya bantu terkait layanan kelurahan?"
            }]
          }
        }]
      }
    });
  }


  if (API_KEYS.length === 0) {
    return res.status(500).json({ 
      ok: false, 
      error: 'GEMINI_API_KEY not configured. Please add at least one API key.' 
    });
  }
  
  console.log(`🔑 Available API Keys: ${API_KEYS.length}`);

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
  
  const cacheKey = makeCacheKey(searchQuery);
  const cached = await getCache(cacheKey);
  
  if (cached && !isContextualSearch) {
    console.log('♻️ Returning cached response (no API call)');
    return res.json({ ...cached, cached: true });
  }
  
  const replyAndCache = async (payload) => {
    try {
      await setCache(cacheKey, payload);
    } catch (err) {
      console.warn('⚠️  Cache set failed:', err?.message);
    }
    return res.json(payload);
  };

  const respondWithDirectDoc = async (doc, score, label = 'direct-data') => {
    if (!doc) return null;
    const directAnswer = doc.answer || doc.response;
    if (!directAnswer) return null;
    return replyAndCache({
      ok: true,
      model: label,
      ragSource,
      directMatchScore: score,
      directMatchId: doc.id || null,
      output: {
        candidates: [{
          content: { parts: [{ text: directAnswer }] }
        }]
      }
    });
  };

  const tryDirectAnswer = async (docs, label = 'direct-data') => {
    if (!docs || docs.length === 0) return null;
    const threshold = isContextualSearch ? 0.85 : DIRECT_ANSWER_THRESHOLD;
    const directMatch = getBestDirectMatch(searchQuery, docs);
    if (directMatch && directMatch.item && directMatch.score >= threshold) {
      console.log(`🎯 Direct data hit (${label}) score ${(directMatch.score * 100).toFixed(1)}% -> ${directMatch.item.text || directMatch.item.question}`);
      return respondWithDirectDoc(directMatch.item, directMatch.score, label);
    }
    return null;
  };
  
  let relevantData = [];
  let ragSource = 'none';

  try {
    const ragResults = await semanticSearch(searchQuery);
    
    if (ragResults.length > 0) {
      console.log(`🔍 Smart Search: Found ${ragResults.length} relevant docs for: "${searchQuery}"`);
      relevantData = ragResults.map(res => res.doc);
      ragSource = 'semantic';
    } else {
      console.log('⚠️ Smart Search miss, falling back to keyword search');
      relevantData = findRelevantData(searchQuery, trainingData, 3);
      ragSource = 'keyword';
    }
  } catch (e) {
    console.error('❌ Smart Search Error:', e.message);
    relevantData = findRelevantData(searchQuery, trainingData, 3);
    ragSource = 'fallback-keyword';
  }

  const keywordBoosted = findRelevantData(searchQuery, trainingData, 5);
  const directDocs = mergeDocLists(relevantData, keywordBoosted);

  let directResponse = await tryDirectAnswer(directDocs, 'direct-data-initial');
  if (directResponse) return directResponse;

  if (process.env.DIRECT_SEARCH_EXPANDED !== 'off') {
    const expandedDocs = findRelevantData(searchQuery, trainingData, 50);
    const mergedExpanded = mergeDocLists(directDocs, expandedDocs);
    directResponse = await tryDirectAnswer(mergedExpanded, 'direct-data-expanded');
    if (directResponse) return directResponse;
  }

  const fullDirectResponse = await tryDirectAnswer(trainingData, 'direct-data-full');
  if (fullDirectResponse) return fullDirectResponse;

  const cachedHandled = await getCache(cacheKey);
  if (cachedHandled && !isContextualSearch) return res.json({ ...cachedHandled, cached: true });
  
  const grounding = directDocs.length > 0
    ? "Data referensi (Gunakan ini sebagai sumber kebenaran MUTLAK):\n" + 
      directDocs.map(d => 
        `[ID: ${d.id} | Kategori: ${d.kategori_utama || d.kategori}]\nTanya: ${d.text || d.question}\nJawab: ${d.answer || d.response}`
      ).join('\n---\n')
    : "";

  const systemInstruction = `Anda adalah Asisten Virtual Kelurahan Marga Sari, Balikpapan.

ATURAN UTAMA (WAJIB DIPATUHI):
1. Jawab pertanyaan HANYA berdasarkan "DATA REFERENSI" di bawah.
2. Jika Data Referensi menyarankan ONLINE, tawarkan itu sebagai opsi utama.
3. KONTEKS: Jika user bertanya "Syaratnya apa?" atau "Caranya gimana?", lihat percakapan sebelumnya untuk mengetahui layanan apa yang dimaksud (misal: KTP, Domisili, dll).
4. Jika tidak ada data di referensi yang cocok, katakan jujur Anda belum tahu.

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

DATA REFERENSI (SUMBER KEBENARAN):
==================================
${grounding}
==================================

Jawablah pertanyaan user berikut:
"${message}"`;

  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey && API_KEYS.length === 0) {
    return res.status(500).json({ 
      ok: false, 
      error: 'GEMINI_API_KEY not configured' 
    });
  }

  try {
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
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=PLACEHOLDER`;

        const contents = [];
        
        contents.push({
          role: "user",
          parts: [{ text: systemInstruction }]
        });
        
        if (history && Array.isArray(history) && history.length > 0) {
          const recentHistory = history.slice(-5);
          contents.push(...recentHistory);
        }
        
        contents.push({
          role: "user",
          parts: [{ text: message }]
        });

        const payload = {
          contents: contents,
          generationConfig: {
            maxOutputTokens: 800,
            temperature: 0.3,
            topP: 0.95,
            topK: 40
          }
        };

        const out = await generateWithRetry(url, payload, model, 2);

        if (!out.candidates || !out.candidates[0].content) {
          throw new Error("Invalid API response");
        }

        console.log(`✅ Success with model: ${model}`);
        return replyAndCache({ 
          ok: true, 
          model, 
          output: out,
          ragSource
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
    
    console.log('🔄 Layer 4: All Gemini models failed, trying RAG semantic fallback...');
    
    try {
      const ragResult = await localRAG(searchQuery);

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
    
    console.log('🔄 Layer 5: RAG failed, using keyword fallback...');
    
    const lowerMessage = searchQuery.toLowerCase();
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
    
    console.log('⚠️ Layer 6: No keyword match, using generic response');
    return replyAndCache({ 
      ok: true, 
      model: 'fallback-generic',
      output: {
        candidates: [{
          content: {
            parts: [{ 
              text: `Maaf, saya kurang paham detail pertanyaan Anda. Apakah maksud Anda terkait layanan tertentu? (Misal: "Syarat KTP" atau "Cara Domisili").\n\nBisa diperjelas agar saya bisa bantu lebih baik? Terima kasih.` 
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

// ======== EXPORT FOR VERCEL / NODE =========
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🚀 Local Server running on port ${PORT}`));
}

export default app;
