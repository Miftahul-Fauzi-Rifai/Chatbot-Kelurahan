// rag_handler.js
// Modul RAG untuk pencarian semantik dan generation
// Digunakan sebagai Layer 4 Fallback di server.js

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// ======== KONFIGURASI =========
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-004';
const GENERATION_MODEL = 'gemini-2.0-flash-exp'; // Model untuk generate jawaban
const EMBEDDED_DOCS_FILE = './data/embedded_docs.json';
const SIMILARITY_THRESHOLD = 0.5; // Minimum similarity score (0-1)
const TOP_K = 3; // Ambil top 3 dokumen paling relevan

// ======== VALIDASI =========
if (!GEMINI_API_KEY) {
  console.error('❌ Error: GEMINI_API_KEY tidak ditemukan di .env file!');
  process.exit(1);
}

// ======== INISIALISASI GEMINI AI =========
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
const generationModel = genAI.getGenerativeModel({ model: GENERATION_MODEL });

// ======== LOAD EMBEDDED DOCUMENTS (CACHE) =========
let embeddedDocs = null;

function loadEmbeddedDocs() {
  if (embeddedDocs !== null) {
    return embeddedDocs; // Return cached
  }
  
  if (!fs.existsSync(EMBEDDED_DOCS_FILE)) {
    console.error(`❌ File embedding tidak ditemukan: ${EMBEDDED_DOCS_FILE}`);
    console.error('💡 Jalankan: node rag_index.js terlebih dahulu!');
    return [];
  }
  
  try {
    const rawData = fs.readFileSync(EMBEDDED_DOCS_FILE, 'utf8');
    embeddedDocs = JSON.parse(rawData);
    console.log(`✅ RAG: Loaded ${embeddedDocs.length} embedded documents`);
    return embeddedDocs;
  } catch (error) {
    console.error('❌ Error loading embedded docs:', error.message);
    return [];
  }
}

// ======== FUNGSI HELPER: COSINE SIMILARITY =========
/**
 * Menghitung cosine similarity antara dua vektor
 * @param {number[]} vecA - Vector A
 * @param {number[]} vecB - Vector B
 * @returns {number} Similarity score (0-1, semakin tinggi semakin mirip)
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  return dotProduct / (normA * normB);
}

// ======== FUNGSI HELPER: RETRIEVAL (Pencarian Semantik) =========
/**
 * Mencari dokumen yang paling relevan dengan query
 * @param {string} query - Pertanyaan user
 * @returns {Promise<Array>} Array of top K relevant documents dengan score
 */
async function retrieveRelevantDocs(query) {
  const docs = loadEmbeddedDocs();
  
  if (docs.length === 0) {
    console.warn('⚠️  RAG: No embedded documents available');
    return [];
  }
  
  try {
    // 1. Generate embedding untuk query
    const result = await embeddingModel.embedContent(query);
    const queryEmbedding = result.embedding.values;
    
    // 2. Hitung similarity dengan semua dokumen
    const similarities = docs.map(doc => {
      const score = cosineSimilarity(queryEmbedding, doc.embedding);
      return {
        doc,
        score
      };
    });
    
    // 3. Sort by score (descending) dan ambil top K
    const topDocs = similarities
      .filter(item => item.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);
    
    console.log(`🔍 RAG: Found ${topDocs.length} relevant docs (threshold: ${SIMILARITY_THRESHOLD})`);
    topDocs.forEach((item, i) => {
      console.log(`   ${i + 1}. [Score: ${item.score.toFixed(3)}] "${item.doc.text.substring(0, 60)}..."`);
    });
    
    return topDocs;
    
  } catch (error) {
    console.error('❌ RAG Retrieval Error:', error.message);
    return [];
  }
}

// ======== FUNGSI HELPER: GENERATION (Generate Jawaban) =========
/**
 * Generate jawaban berdasarkan context dari dokumen relevan
 * @param {string} query - Pertanyaan user
 * @param {Array} relevantDocs - Array of {doc, score}
 * @returns {Promise<string>} Generated answer
 */
async function generateAnswer(query, relevantDocs) {
  if (relevantDocs.length === 0) {
    return null; // No context available
  }
  
  // Build context dari top documents
  const context = relevantDocs
    .map((item, i) => {
      const doc = item.doc;
      return `[Dokumen ${i + 1} - Relevansi: ${(item.score * 100).toFixed(1)}%]\nPertanyaan: ${doc.text}\nJawaban: ${doc.answer}\nKategori: ${doc.kategori}`;
    })
    .join('\n\n---\n\n');
  
  // Build RAG prompt
  const ragPrompt = `Anda adalah Asisten Virtual Kelurahan Marga Sari, Balikpapan.

INSTRUKSI PENTING:
1. Gunakan HANYA informasi dari KONTEKS REFERENSI di bawah untuk menjawab pertanyaan
2. Jika konteks tidak cukup untuk menjawab, katakan dengan jujur
3. Jawab dengan bahasa formal, sopan, dan profesional
4. Berikan jawaban yang padat, jelas, maksimal 3-4 paragraf
5. Gunakan numbered list untuk syarat/langkah, bullet points untuk pilihan

KONTEKS REFERENSI:
${context}

PERTANYAAN USER:
${query}

JAWABAN (berdasarkan konteks di atas):`;

  try {
    const result = await generationModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: ragPrompt }] }],
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.7,
        topP: 0.95,
        topK: 40
      }
    });
    
    const answer = result.response.text();
    console.log(`✅ RAG: Generated answer (${answer.length} chars)`);
    
    return answer;
    
  } catch (error) {
    console.error('❌ RAG Generation Error:', error.message);
    throw error;
  }
}

// ======== FUNGSI UTAMA: LOCAL RAG (EXPORT) =========
/**
 * Fungsi utama RAG: Retrieve + Generate
 * @param {string} query - Pertanyaan user
 * @returns {Promise<Object>} { ok, answer, sources, error }
 */
export async function localRAG(query) {
  console.log(`\n🤖 RAG: Processing query: "${query.substring(0, 80)}..."`);
  
  try {
    // STEP 1: RETRIEVAL - Cari dokumen relevan
    const relevantDocs = await retrieveRelevantDocs(query);
    
    if (relevantDocs.length === 0) {
      console.warn('⚠️  RAG: No relevant documents found');
      return {
        ok: false,
        error: 'NO_RELEVANT_DOCS',
        message: 'Tidak ditemukan informasi relevan di database lokal'
      };
    }
    
    // STEP 2: GENERATION - Generate jawaban dari context
    const answer = await generateAnswer(query, relevantDocs);
    
    if (!answer) {
      return {
        ok: false,
        error: 'GENERATION_FAILED',
        message: 'Gagal menghasilkan jawaban'
      };
    }
    
    // STEP 3: Return hasil
    return {
      ok: true,
      answer: answer,
      sources: relevantDocs.map(item => ({
        id: item.doc.id,
        text: item.doc.text,
        score: item.score,
        kategori: item.doc.kategori
      })),
      metadata: {
        model: GENERATION_MODEL,
        retrievedDocs: relevantDocs.length,
        topScore: relevantDocs[0].score
      }
    };
    
  } catch (error) {
    console.error('❌ RAG Error:', error);
    return {
      ok: false,
      error: error.message,
      message: 'Terjadi kesalahan pada sistem RAG'
    };
  }
}

// ======== FUNGSI HELPER: GET RAG STATUS =========
/**
 * Mendapatkan status sistem RAG
 * @returns {Object} Status information
 */
export function getRAGStatus() {
  const docs = loadEmbeddedDocs();
  
  return {
    available: docs.length > 0,
    totalDocs: docs.length,
    embeddingModel: EMBEDDING_MODEL,
    generationModel: GENERATION_MODEL,
    similarityThreshold: SIMILARITY_THRESHOLD,
    topK: TOP_K,
    dataFile: EMBEDDED_DOCS_FILE
  };
}

// ======== EXPORT DEFAULT =========
export default {
  localRAG,
  getRAGStatus
};
