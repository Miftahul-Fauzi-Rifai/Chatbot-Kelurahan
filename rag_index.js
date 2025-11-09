// rag_index.js
// Script untuk membuat embedding dari data training dan menyimpannya ke file
// Jalankan sekali saja: node rag_index.js

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// ======== KONFIGURASI =========
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = 'text-embedding-004'; // Model embedding Google terbaru
const DATA_FILES = [
  './data/kosakata_jawa.json',
  './data/train.json'
];
const OUTPUT_FILE = './data/embedded_docs.json';

// ======== VALIDASI =========
if (!GEMINI_API_KEY) {
  console.error('❌ Error: GEMINI_API_KEY tidak ditemukan di .env file!');
  process.exit(1);
}

// ======== INISIALISASI GEMINI AI =========
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });

// ======== FUNGSI HELPER: OPTIMASI DATA =========
// Stopwords untuk filter (Indonesia + Jawa)
const STOPWORDS = new Set(['dan','atau','yang','dengan','untuk','pada','di','ke','dari','ini','itu','adalah','sebagai','opo','kuwi','niki','ing','sak','karo']);

function normalizeText(text) {
  return (text || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
}

function removeStopwords(words) {
  return words.filter(w => w && w.length > 2 && !STOPWORDS.has(w));
}

function hashText(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function chunkMerge(lines, maxLen = 500) {
  const chunks = [];
  let buf = '';
  for (const line of lines) {
    const cleaned = (line || '').toString().trim();
    if (!cleaned || cleaned.length < 20) continue; // Skip very short lines
    if ((buf + ' ' + cleaned).length > maxLen) {
      if (buf) chunks.push(buf.trim());
      buf = cleaned;
    } else {
      buf = buf ? `${buf} ${cleaned}` : cleaned;
    }
  }
  if (buf) chunks.push(buf.trim());
  return chunks;
}

// ======== FUNGSI HELPER: TRANSFORM KOSAKATA JAWA (OPTIMIZED) =========
function transformKosakata(item) {
  // Jika item memiliki format kosakata Jawa (indonesia, ngoko, madya, krama)
  if (item.indonesia && (item.ngoko || item.madya || item.krama)) {
    const parts = [];
    if (item.ngoko) parts.push(`Ngoko: ${item.ngoko}`);
    if (item.madya) parts.push(`Madya: ${item.madya}`);
    if (item.krama) parts.push(`Krama: ${item.krama}`);
    
    return {
      ...item,
      text: `Apa bahasa Jawa dari '${item.indonesia}'?`,
      answer: `Bahasa Jawa dari '${item.indonesia}':\n- ${parts.join('\n- ')}`,
      tags: item.tags || ['kosakata', 'bahasa jawa', item.indonesia],
      kategori_utama: item.kategori_utama || 'kosakata_jawa'
    };
  }
  
  // Jika sudah format standar, return as-is
  return item;
}

// ======== FUNGSI HELPER: LOAD DATA (WITH DEDUPLICATION) =========
function loadTrainingData() {
  let allData = [];
  const seen = new Set(); // For deduplication
  
  for (const file of DATA_FILES) {
    if (!fs.existsSync(file)) {
      console.warn(`⚠️  File tidak ditemukan: ${file}`);
      continue;
    }
    
    try {
      const rawData = fs.readFileSync(file, 'utf8');
      const jsonData = JSON.parse(rawData);
      
      if (Array.isArray(jsonData)) {
        // Transform dan deduplikasi
        jsonData.forEach(item => {
          const transformed = transformKosakata(item);
          const textToCheck = (transformed.text || transformed.question || '') + (transformed.answer || transformed.response || '');
          const hash = hashText(normalizeText(textToCheck));
          
          // Skip jika duplikat atau terlalu pendek
          if (!seen.has(hash) && textToCheck.length >= 40) {
            seen.add(hash);
            allData.push(transformed);
          }
        });
        console.log(`✅ Loaded ${jsonData.length} items from ${file} (${allData.length} unique after dedup)`);
      } else {
        console.warn(`⚠️  ${file} bukan array, dilewati.`);
      }
    } catch (error) {
      console.error(`❌ Error membaca ${file}:`, error.message);
    }
  }
  
  // IMPORTANT: Batasi jumlah total dokumen (maksimal 300-400)
  if (allData.length > 400) {
    console.log(`⚠️  Terlalu banyak data (${allData.length}), mengambil 400 teratas berdasarkan panjang jawaban...`);
    allData = allData
      .sort((a, b) => {
        const lenA = (a.answer || a.response || '').length;
        const lenB = (b.answer || b.response || '').length;
        return lenB - lenA; // Sort by answer length descending
      })
      .slice(0, 400);
  }
  
  return allData;
}

// ======== FUNGSI HELPER: BUAT TEXT UNTUK EMBEDDING (OPTIMIZED) =========
function prepareTextForEmbedding(item) {
  // Hanya gabungkan field penting (hemat token)
  const parts = [];
  
  // Question/Text
  if (item.text || item.question) {
    parts.push(item.text || item.question);
  }
  
  // Answer/Response (batasi panjang maksimal 300 karakter)
  if (item.answer || item.response) {
    const answer = (item.answer || item.response).substring(0, 300);
    parts.push(answer);
  }
  
  // Tags (hanya 3 pertama)
  if (item.tags && Array.isArray(item.tags) && item.tags.length > 0) {
    const topTags = item.tags.slice(0, 3).join(', ');
    parts.push('Tag: ' + topTags);
  }
  
  return parts.join('\n');
}

// ======== FUNGSI UTAMA: GENERATE EMBEDDINGS =========
async function generateEmbeddings() {
  console.log('\n🚀 Memulai proses indexing RAG...\n');
  
  // 1. Load data training
  const trainingData = loadTrainingData();
  
  if (trainingData.length === 0) {
    console.error('❌ Tidak ada data untuk di-index!');
    process.exit(1);
  }
  
  console.log(`\n📊 Total data yang akan diproses: ${trainingData.length} items\n`);
  
  // 2. Generate embeddings untuk setiap item
  const embeddedDocs = [];
  const batchSize = 10; // ⚡ INCREASED: Process 10 items at a time (was 5)
  
  for (let i = 0; i < trainingData.length; i += batchSize) {
    const batch = trainingData.slice(i, i + batchSize);
    const batchPromises = batch.map(async (item, batchIndex) => {
      const globalIndex = i + batchIndex;
      
      try {
        // Prepare text untuk embedding
        const textToEmbed = prepareTextForEmbedding(item);
        
        if (!textToEmbed || textToEmbed.trim().length === 0) {
          console.warn(`⚠️  [${globalIndex + 1}/${trainingData.length}] Item ID ${item.id} kosong, dilewati.`);
          return null;
        }
        
        // Generate embedding
        const result = await embeddingModel.embedContent(textToEmbed);
        const embedding = result.embedding.values; // Array of numbers
        
        console.log(`✅ [${globalIndex + 1}/${trainingData.length}] Embedded: ${item.id || 'no-id'} - "${(item.text || item.question || '').substring(0, 50)}..."`);
        
        // Return embedded document (ONLY essential fields)
        return {
          id: item.id,
          text: item.text || item.question || '',
          answer: item.answer || item.response || '',
          kategori: item.kategori_utama || '',
          tags: (item.tags || []).slice(0, 3), // Only top 3 tags
          embedding: embedding
        };
        
      } catch (error) {
        console.error(`❌ [${globalIndex + 1}/${trainingData.length}] Error embedding item ${item.id}:`, error.message);
        
        // Handle rate limit
        if (error.message.includes('429') || error.message.includes('quota')) {
          console.log('⏳ Rate limit hit, waiting 10s...');
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
        
        return null;
      }
    });
    
    // Wait for batch to complete
    const batchResults = await Promise.all(batchPromises);
    embeddedDocs.push(...batchResults.filter(doc => doc !== null));
    
    // Small delay between batches to avoid rate limits
    if (i + batchSize < trainingData.length) {
      await new Promise(resolve => setTimeout(resolve, 500)); // ⚡ REDUCED: 0.5s delay (was 1s)
    }
  }
  
  // 3. Save to file
  console.log(`\n💾 Menyimpan ${embeddedDocs.length} embedded documents ke ${OUTPUT_FILE}...`);
  
  // Ensure data directory exists
  const outputDir = OUTPUT_FILE.substring(0, OUTPUT_FILE.lastIndexOf('/'));
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(embeddedDocs, null, 2), 'utf8');
  
  console.log(`\n✅ SELESAI! Embedding berhasil disimpan.`);
  console.log(`📄 File: ${OUTPUT_FILE}`);
  console.log(`📊 Total documents: ${embeddedDocs.length} (dari ${trainingData.length} data awal)`);
  console.log(`📏 Embedding dimension: ${embeddedDocs[0]?.embedding?.length || 'N/A'}`);
  
  // Hitung ukuran file
  const stats = fs.statSync(OUTPUT_FILE);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`💾 File size: ${fileSizeMB} MB`);
  console.log('\n🎉 RAG Index siap digunakan!\n');
}

// ======== JALANKAN SCRIPT =========
generateEmbeddings().catch(error => {
  console.error('\n❌ Fatal Error:', error);
  process.exit(1);
});
