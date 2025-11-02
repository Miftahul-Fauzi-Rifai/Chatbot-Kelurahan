// ========================================
// CONTOH INTEGRASI RAG KE SERVER.JS
// Copy bagian ini ke server.js Anda
// ========================================

// ======== 1. IMPORT DI BAGIAN ATAS (GANTI require() DENGAN import) =========

import express from 'express';
import axios from 'axios';
import multer from 'multer';
import fs from 'fs';
import dotenv from 'dotenv';
import { localRAG, getRAGStatus } from './rag_handler.js';

dotenv.config();

const upload = multer({ dest: process.env.UPLOAD_DIR || 'uploads/' });
const app = express();
const PORT = process.env.PORT || 3000;

// ... (kode middleware CORS, rateLimit, dll tetap sama)


// ======== 2. TAMBAHKAN ENDPOINT RAG STATUS =========
// Letakkan sebelum app.listen()

app.get('/api/rag/status', (req, res) => {
  try {
    const ragStatus = getRAGStatus();
    res.json({
      ok: true,
      rag: ragStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});


// ======== 3. GANTI LAYER 4 FALLBACK DI /api/chat =========
// Cari bagian ini (sekitar line 300-400):

// ============================================
// LAYER 3: LOCAL FALLBACK (JIKA SEMUA GEMINI GAGAL)
// ============================================
console.warn('⚠️ All Gemini models failed, using local RAG fallback...');

// GANTI DENGAN KODE DI BAWAH INI:

// ============================================
// LAYER 4: RAG FALLBACK (JIKA SEMUA GEMINI GAGAL)
// ============================================
console.warn('⚠️ All Gemini models failed, trying RAG fallback...');

try {
  // Try RAG first (Semantic Search + LLM Generation)
  const ragResult = await localRAG(message);
  
  if (ragResult.ok) {
    console.log(`✅ RAG SUCCESS: ${ragResult.sources.length} sources, top score: ${ragResult.metadata.topScore.toFixed(3)}`);
    
    return res.json({
      ok: true,
      model: 'rag-local',
      output: {
        candidates: [{
          content: {
            parts: [{
              text: `${ragResult.answer}\n\n📚 *Informasi ini diambil dari ${ragResult.sources.length} dokumen lokal dengan tingkat relevansi ${(ragResult.metadata.topScore * 100).toFixed(1)}%*`
            }]
          }
        }]
      },
      ragMetadata: {
        sources: ragResult.sources.map(s => ({ id: s.id, score: s.score })),
        model: ragResult.metadata.model,
        retrievedDocs: ragResult.metadata.retrievedDocs
      }
    });
  }
  
  // RAG tidak menemukan dokumen relevan (score < threshold)
  console.warn(`⚠️ RAG: ${ragResult.error} - ${ragResult.message}`);
  
  // Fallback ke keyword matching (kode yang sudah ada)
  
} catch (ragError) {
  console.error('❌ RAG Error:', ragError.message);
  // Continue to keyword matching fallback
}

// ============================================
// LAYER 5: KEYWORD MATCHING (EXISTING CODE)
// ============================================
// Kode keyword matching yang sudah ada tetap di bawah
// (trainData, matches, bestMatch, dll)


// ======== 4. OPTIONAL: TAMBAHKAN RAG DI LAYER 2.5 (HYBRID MODE) =========
// Jika ingin RAG jalan bersamaan dengan Gemini (lebih cepat tapi pakai quota)

// Di dalam try-catch loop model Gemini, sebelum atau sesudah panggilan API:

// HYBRID MODE: RAG + Gemini
// const ragPromise = localRAG(message); // Async, tidak tunggu
// const geminiPromise = generateWithRetry(url, payload, model);
// const [ragResult, geminiResult] = await Promise.allSettled([ragPromise, geminiPromise]);
// if (geminiResult.status === 'fulfilled') return geminiResult.value;
// if (ragResult.status === 'fulfilled' && ragResult.value.ok) return ragResult.value;

