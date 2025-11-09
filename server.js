// server.js
// Express server untuk chatbot dengan Gemini API + data lokal (RAG sederhana)

import dotenv from 'dotenv';
import express from 'express';
import axios from 'axios';
import multer from 'multer';
import fs from 'fs';
import { localRAG } from './rag_handler.js';

dotenv.config(); // Load environment variables

const upload = multer({ dest: process.env.UPLOAD_DIR || 'uploads/' });
const app = express();
const PORT = process.env.PORT || 3000;

// ======== CORS Configuration untuk Laravel Integration =========
app.use((req, res, next) => {
  // Izinkan request dari Laravel development server
  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : [
        'http://localhost:8000',
        'http://127.0.0.1:8000',
        'http://localhost',
        'http://127.0.0.1'
      ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

app.use(express.json());
app.use(express.static('public'));

// ======== RATE LIMITER (Protect dari API quota) =========
const rateLimit = {
  requests: [],
  maxPerMinute: 10, // Conservative limit (API limit: 15/min)
  
  canMakeRequest() {
    const now = Date.now();
    // Remove requests older than 1 minute
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
      const waitTime = 60000 - (Date.now() - oldestRequest) + 1000; // +1s buffer
      console.log(`⏳ Rate limit: Waiting ${Math.ceil(waitTime/1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requests = []; // Reset after waiting
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

// ======== Penyimpanan data training lokal =========
const TRAIN_FILE = process.env.TRAIN_DATA_FILE || './data/train.json';
const KLARIFIKASI_FILE = './data/kosakata_jawa.json';

if (!fs.existsSync(TRAIN_FILE)) fs.writeFileSync(TRAIN_FILE, JSON.stringify([]));
if (!fs.existsSync(KLARIFIKASI_FILE)) fs.writeFileSync(KLARIFIKASI_FILE, JSON.stringify([]));

function readTrainData() {
  try { 
    const trainData = JSON.parse(fs.readFileSync(TRAIN_FILE));
    const klarifikasiData = JSON.parse(fs.readFileSync(KLARIFIKASI_FILE));
    // Gabungkan kedua data
    return [...trainData, ...klarifikasiData];
  }
  catch(e){ return []; }
}
function writeTrainData(d){ fs.writeFileSync(TRAIN_FILE, JSON.stringify(d, null, 2)); }

// ======== Fungsi pencarian sederhana (RAG) =========
function findRelevantData(message, allData, maxResults = 5) {
  const lowerMessage = message.toLowerCase();
  const queryWords = lowerMessage.split(/\s+/);
  
  // Detect question patterns for definitions/acronyms
  const isDefinitionQuestion = /^(apa|apakah)\s+(itu|kepanjangan|arti)\s+/i.test(message);
  
  const scores = allData.map(item => {
    let score = 0;
    const text = (item.text || item.question || '').toLowerCase();
    const answer = (item.answer || item.response || '').toLowerCase();
    const tags = (item.tags || []).join(' ').toLowerCase();
    const kategori = (item.kategori_utama || '').toLowerCase();
    
    // Special handling for definition questions
    if (isDefinitionQuestion) {
      // Extract the term being asked about (usually the last word or phrase)
      const termMatch = message.match(/(?:apa|apakah)\s+(?:itu|kepanjangan|arti)\s+(.+?)(?:\?|$)/i);
      if (termMatch) {
        const term = termMatch[1].toLowerCase().trim();
        // High score if term exactly matches in text
        if (text.includes(term)) score += 10;
        // Check if it's an acronym/definition question from klarifikasi
        if (kategori.includes('istilah') && (text.includes(term) || tags.includes(term))) {
          score += 15;
        }
      }
    }
    
    // Regular keyword matching
    queryWords.forEach(word => {
      if (word.length < 3) return; // skip short words
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

// ======== Endpoint list data training =========
app.get('/api/data', (req, res) => {
  res.json({ ok:true, data: readTrainData() });
});

// ======== Upload data training =========
app.post('/api/train', upload.single('file'), (req, res) => {
  let items = [];
  if (req.file) {
    const raw = fs.readFileSync(req.file.path, 'utf8');
    try { items = JSON.parse(raw); } catch(e){ return res.status(400).json({ok:false, error:'file tidak valid JSON'}); }
    fs.unlinkSync(req.file.path);
  } else if (req.body && req.body.items) {
    try { items = JSON.parse(req.body.items); } catch(e){ return res.status(400).json({ok:false, error:'items harus JSON'}); }
  } else {
    return res.status(400).json({ ok:false, error: 'Kirim file JSON atau field items' });
  }

  const cur = readTrainData();
  const existingIds = new Set(cur.map(d => d.id));
  const newItems = items.filter(item => item.id && !existingIds.has(item.id));
  const skipped = items.length - newItems.length;

  if (newItems.length > 0) {
    const merged = cur.concat(newItems);
    writeTrainData(merged);
    res.json({ ok:true, added: newItems.length, skipped, total: merged.length });
  } else {
    res.json({ ok:true, added: 0, skipped, total: cur.length, message: "Tidak ada data baru (mungkin duplikat)." });
  }
});

// ======== RETRY LOGIC (Auto retry on rate limit) =========
// OPTIMIZED: Faster retries, shorter timeout
async function generateWithRetry(url, payload, modelName, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Wait if rate limit protection is active
      await rateLimit.waitIfNeeded();
      
      console.log(`🔄 Attempt ${attempt}/${maxRetries} - ${modelName}`);
      const startTime = Date.now();
      
      const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000 // ⚡ REDUCED: 10 second timeout (was 30s)
      });
      
      const duration = Date.now() - startTime;
      console.log(`✅ Success with ${modelName} in ${duration}ms`);
      return response.data;
      
    } catch (error) {
      const statusCode = error.response?.status;
      const errorMessage = error.response?.data?.error?.message || error.message;
      
      // Handle rate limit (429) - only retry once with shorter wait
      if (statusCode === 429 && attempt < maxRetries) {
        const waitTime = 3000; // ⚡ REDUCED: 3s wait (was 5s, 10s, 20s)
        console.log(`⚠️  Rate limit (429) - Retry in ${waitTime/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Handle quota exceeded (429 with specific message)
      if (errorMessage.includes('quota') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
        console.log(`📊 Quota exceeded for ${modelName}`);
        throw new Error('QUOTA_EXCEEDED');
      }
      
      // Handle timeout - fail fast, don't retry
      if (errorMessage.includes('timeout') || errorMessage.includes('ECONNABORTED')) {
        console.log(`⏱️  Timeout for ${modelName} - skipping retry`);
        throw error;
      }
      
      // Handle other errors
      console.log(`❌ Error with ${modelName}:`, errorMessage);
      throw error;
    }
  }
  
  throw new Error(`Max retries (${maxRetries}) exceeded`);
}

// ======== Endpoint chat dengan Gemini API =========
app.post('/api/chat', async (req, res) => {
  const { message, history } = req.body || {}; // Ambil history dari app.js
  if (!message) return res.status(400).json({ ok:false, error: 'message kosong' });

  const allData = readTrainData();
  
  // ⚡ OPTIMIZED: Limit relevant data to top 3 (was 5)
  const relevantData = findRelevantData(message, allData, 3);
  
  // ⚡ OPTIMIZED: Shorter grounding text
  const grounding = relevantData.length > 0
    ? "Data referensi:\n" + 
      relevantData.map(d => `Q: ${(d.text||d.question||'').substring(0, 100)}\nA: ${(d.answer||d.response||'').substring(0, 200)}`).join('\n---\n')
    : "";

  // ⚡ OPTIMIZED: System instruction (Bahasa Indonesia WAJIB)
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

  // Load API Key from environment variable
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return res.status(500).json({ 
      ok: false, 
      error: 'GEMINI_API_KEY tidak ditemukan di .env file' 
    });
  }

  try {
    // ============================================
    // SMART FALLBACK SYSTEM - 3 LAYER PROTECTION
    // ============================================
    // Layer 1: Gemini 2.0 Flash Exp (v1beta - experimental, fast)
    // Layer 2: Gemini 2.5 Flash (v1 - stable, newest version!)
    // Layer 3: Gemini 2.0 Flash (v1 - stable, reliable)
    // Layer 4: Local RAG (Data lokal - unlimited)
    
    const models = [
      process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp', // Primary - Fastest
      'gemini-2.5-flash',   // Fallback 1 - Newest stable version (June 2025)
      'gemini-2.0-flash'    // Fallback 2 - Stable alternative
    ];
    
    let lastError = null;
    
    // Try each model in sequence
    for (const model of models) {
      try {
        console.log(`🤖 Trying model: ${model}`);
        
        // ⚡ SMART API VERSION SELECTION
        // v1beta: For experimental models (gemini-2.0-flash-exp)
        // v1: For stable models (gemini-1.5-flash, gemini-1.5-pro, gemini-pro)
        const apiVersion = model.includes('2.0') ? 'v1beta' : 'v1';
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`;
        
        console.log(`   📡 Using API version: ${apiVersion}`);

        // ⚡ OPTIMIZED: Build conversation with proper context
        const contents = [];
        
        // Add system instruction as first message
        contents.push({
          role: "user",
          parts: [{ text: systemInstruction }]
        });
        
        contents.push({
          role: "model",
          parts: [{ text: "Understood. Saya siap membantu sebagai Asisten Virtual Kelurahan Marga Sari." }]
        });
        
        // Add previous conversation history (if exists)
        if (history && Array.isArray(history) && history.length > 0) {
          // Only include last 5 messages to avoid token limit
          const recentHistory = history.slice(-5);
          contents.push(...recentHistory);
        }
        
        // Add current user message
        contents.push({
          role: "user",
          parts: [{ text: message }]
        });

        const payload = {
          contents: contents, 
          generationConfig: {
            maxOutputTokens: 500,  // ✅ INCREASED: 500 tokens for complete responses (was 200)
            temperature: 0.7,
            topP: 0.95,            // ⚡ OPTIMIZED: Higher for more focused responses
            topK: 40
          }
        };

        // ✅ USE RETRY LOGIC with rate limiter
        const out = await generateWithRetry(url, payload, model);

        if (!out.candidates || !out.candidates[0].content) {
          throw new Error("Respon API v1beta tidak valid: " + JSON.stringify(out));
        }

        // SUCCESS! Return response
        console.log(`✅ Success with model: ${model}`);
        return res.json({ ok:true, model, output: out });
        
      } catch (modelError) {
        lastError = modelError;
        const errorMsg = modelError.message || modelError.response?.data?.error?.message;
        console.warn(`⚠️ Model ${model} failed: ${errorMsg}`);
        
        // If quota exceeded, skip to next model immediately
        if (errorMsg.includes('QUOTA_EXCEEDED') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
          console.log(`📊 ${model} quota exhausted, trying next model...`);
          continue;
        }
        
        // Check if it's a quota/rate limit error
        if (errorMsg.includes('quota') || errorMsg.includes('limit') || 
            errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
          console.log(`💡 Quota exhausted for ${model}, trying next model...`);
          continue; // Try next model
        }
        
        // For other errors, try next model too
        continue;
      }
    }
    
    // ============================================
    // LAYER 4: RAG SEMANTIK FALLBACK (JIKA SEMUA GEMINI GAGAL)
    // ============================================
    console.warn('⚠️ All Gemini models failed, trying RAG semantic fallback...');
    
    try {
      const ragResult = await localRAG(message);

      if (ragResult?.ok && ragResult?.answer) {
        console.log(`✅ RAG Fallback success (${ragResult.sources.length} sources)`);
        return res.json({
          ok: true,
          model: 'rag-local',
          output: { candidates: [{ content: { parts: [{ text: ragResult.answer }] } }] }
        });
      }
      console.warn('RAG gagal:', ragResult?.error || ragResult?.message);
    } catch (ragError) {
      console.error('RAG exception:', ragError.message);
    }
    
    // ============================================
    // LAYER 5: KEYWORD FALLBACK (JIKA RAG JUGA GAGAL)
    // ============================================
    console.warn('⚠️ RAG failed, using keyword fallback...');
    
    // Search local training data with improved scoring
    const trainData = readTrainData();
    const lowerMessage = message.toLowerCase();
    const queryWords = lowerMessage.split(/\s+/).filter(w => w.length > 2);
    
    // Common words to filter out (tidak informatif)
    const commonWords = ['cara', 'bagaimana', 'apa', 'dimana', 'berapa', 'apakah', 'bisa', 'saya', 'membuat', 'mengurus', 'untuk'];
    
    // Extract specific keywords (kata penting)
    const specificWords = queryWords.filter(w => !commonWords.includes(w));
    
    // Advanced keyword matching with weighted scoring
    const matches = trainData.map(item => {
      const lowerText = (item.text || '').toLowerCase();
      const lowerAnswer = (item.answer || '').toLowerCase();
      const lowerTags = (item.tags || []).join(' ').toLowerCase();
      const kategori = (item.kategori_utama || '').toLowerCase();
      
      let score = 0;
      let matchedKeywords = [];
      
      // PRIORITY 1: Specific keyword exact match in question (HIGHEST)
      specificWords.forEach(word => {
        if (lowerText.includes(word)) {
          score += 30; // Very high weight for specific keywords
          matchedKeywords.push(word);
        }
      });
      
      // PRIORITY 2: Specific keyword in tags (VERY HIGH)
      specificWords.forEach(word => {
        if (lowerTags.includes(word)) {
          score += 25;
          matchedKeywords.push(`tag:${word}`);
        }
      });
      
      // PRIORITY 3: Specific keyword in kategori (HIGH)
      specificWords.forEach(word => {
        if (kategori.includes(word)) {
          score += 20;
        }
      });
      
      // PRIORITY 4: Phrase matching (HIGH)
      const cleanMessage = lowerMessage.replace(/[^\w\s]/g, '');
      const cleanText = lowerText.replace(/[^\w\s]/g, '');
      
      if (cleanMessage.length > 10 && cleanText.includes(cleanMessage.substring(0, Math.min(15, cleanMessage.length)))) {
        score += 40; // Huge bonus for phrase match
        matchedKeywords.push('phrase_match');
      }
      
      // PRIORITY 5: Common words match in text (LOW - only for tie-breaking)
      queryWords.forEach(word => {
        if (commonWords.includes(word) && lowerText.includes(word)) {
          score += 2; // Very low weight
        }
      });
      
      // PRIORITY 6: Match in answer (VERY LOW - least priority)
      specificWords.forEach(word => {
        if (lowerAnswer.includes(word)) {
          score += 5;
        }
      });
      
      // PENALTY: Jika tidak ada specific keyword yang match, kurangi score drastis
      if (matchedKeywords.length === 0) {
        score = Math.max(0, score - 20);
      }
      
      return { item, score, matchedKeywords };
    }).filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score);
    
    if (matches.length > 0) {
      // Return best match
      const bestMatch = matches[0].item;
      console.log(`✅ Keyword match found (score: ${matches[0].score}, keywords: [${matches[0].matchedKeywords.join(', ')}])`);
      
      return res.json({ 
        ok: true, 
        model: 'keyword-fallback',
        output: {
          candidates: [{
            content: {
              parts: [{ text: bestMatch.answer }]
            }
          }]
        }
      });
    }
    
    // No local match found - check if incomplete or out of topic
    console.log('❌ No relevant local data found');
    
    // Check if question is incomplete (asking "how to make" without specifying what)
    const incompletePatterns = [
      /^(bagaimana|gimana|cara)\s+(membuat|bikin|buat|mengurus|urus)\??$/i,
      /^(cara|bagaimana)\s+$/i,
      /^(buat|bikin)\s+(apa|bagaimana)\??$/i
    ];
    
    const isIncomplete = incompletePatterns.some(pattern => pattern.test(message.trim()));
    
    if (isIncomplete) {
      return res.json({ 
        ok: true, 
        model: 'clarification-needed',
        output: {
          candidates: [{
            content: {
              parts: [{ 
                text: `Untuk membantu Anda, boleh saya tahu dokumen atau layanan apa yang ingin Anda tanyakan?\n\nBeberapa layanan yang tersedia:\n• KTP / e-KTP\n• Kartu Keluarga (KK)\n• Surat Keterangan (berbagai jenis)\n• Perpanjangan SIM\n• SKCK\n• Atau layanan lainnya?\n\nSilakan sebutkan jenis layanan yang Anda butuhkan.` 
              }]
            }
          }]
        }
      });
    }
    
    // Check if question is out of topic (not related to kelurahan services)
    const keluarhanKeywords = ['ktp', 'kk', 'kartu keluarga', 'kelurahan', 'surat', 'akta', 'sim', 'skck', 'paspor', 
                               'disdukcapil', 'pajak kendaraan', 'bpjs', 'samsat', 'stnk', 'domisili', 'nikah', 
                               'lahir', 'mati', 'kematian', 'pindah', 'penduduk', 'layanan', 'balikpapan', 'kartu kuning', 'ak1'];
    
    const isRelevant = keluarhanKeywords.some(keyword => lowerMessage.includes(keyword));
    
    if (!isRelevant) {
      // Out of topic - return polite rejection
      return res.json({ 
        ok: true, 
        model: 'out-of-topic',
        output: {
          candidates: [{
            content: {
              parts: [{ 
                text: `Maaf, sebagai Asisten Virtual Kelurahan Marga Sari, saya hanya dapat membantu informasi terkait:\n\n• Layanan kelurahan (KTP, KK, surat keterangan)\n• Administrasi kependudukan\n• Layanan publik di Balikpapan (SIM, SKCK, pajak kendaraan, dll)\n\nApakah ada yang bisa saya bantu terkait layanan kelurahan?` 
              }]
            }
          }]
        }
      });
    }
    
    // Relevant but no data found - return professional generic response (manusiawi)
    return res.json({ 
      ok: true, 
      model: 'fallback-generic',
      output: {
        candidates: [{
          content: {
            parts: [{ 
              text: `Maaf, saya belum menemukan jawaban yang tepat untuk pertanyaan Anda. Bisa dijelaskan lebih rinci atau sebutkan dokumen/layanan yang dimaksud?\n\nUntuk informasi lebih detail, Anda juga bisa:\n• Menghubungi kantor Kelurahan Marga Sari langsung (Senin-Jumat, 08:00-16:00 WITA)\n• Mencoba mengulang pertanyaan dengan kata kunci yang lebih spesifik\n\nTerima kasih atas pengertiannya.` 
            }]
          }
        }]
      }
    });

  } catch (err) {
    // Final catch-all error handler
    const errorMsg = err.response?.data?.error?.message || err.message;
    console.error('❌ Fatal error:', errorMsg);
    
    const errorDetail = err.response?.data || { message: err.message };
    return res.status(500).json({ 
      ok: false, 
      error: 'Maaf, terjadi gangguan teknis. Untuk bantuan segera, silakan hubungi kantor kelurahan langsung.', 
      detail: errorDetail 
    });
  }
});

// ======== STATUS ENDPOINT (Check rate limit & API health) =========
app.get('/api/status', (req, res) => {
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
      fallback: 'gemini-1.5-flash',
      local: 'RAG (training data)'
    },
    limits: {
      rpm: '15 requests/minute (Free tier)',
      tpm: '1M tokens/minute',
      rpd: '1,500 requests/day'
    }
  });
});

app.listen(PORT, () => console.log('Server running on port', PORT));