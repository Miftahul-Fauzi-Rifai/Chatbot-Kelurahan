// rag_index.js
// Script untuk membuat embedding dari data training dan menyimpannya ke file
// Jalankan sekali saja: node rag_index.js

import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import dotenv from 'dotenv';

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

// ======== FUNGSI HELPER: TRANSFORM KOSAKATA JAWA =========
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

// ======== FUNGSI HELPER: LOAD DATA =========
function loadTrainingData() {
  let allData = [];
  
  for (const file of DATA_FILES) {
    if (!fs.existsSync(file)) {
      console.warn(`⚠️  File tidak ditemukan: ${file}`);
      continue;
    }
    
    try {
      const rawData = fs.readFileSync(file, 'utf8');
      const jsonData = JSON.parse(rawData);
      
      if (Array.isArray(jsonData)) {
        // Transform kosakata jawa format jika diperlukan
        const transformedData = jsonData.map(item => transformKosakata(item));
        allData = allData.concat(transformedData);
        console.log(`✅ Loaded ${jsonData.length} items from ${file}`);
      } else {
        console.warn(`⚠️  ${file} bukan array, dilewati.`);
      }
    } catch (error) {
      console.error(`❌ Error membaca ${file}:`, error.message);
    }
  }
  
  return allData;
}

// ======== FUNGSI HELPER: BUAT TEXT UNTUK EMBEDDING =========
function prepareTextForEmbedding(item) {
  // Gabungkan semua informasi penting dari item
  const parts = [];
  
  // Prioritas 1: Question/Text (pertanyaan/topik utama)
  if (item.text || item.question) {
    parts.push(item.text || item.question);
  }
  
  // Prioritas 2: Answer/Response (jawaban/informasi)
  if (item.answer || item.response) {
    parts.push(item.answer || item.response);
  }
  
  // Prioritas 3: Tags (kata kunci)
  if (item.tags && Array.isArray(item.tags)) {
    parts.push('Tag: ' + item.tags.join(', '));
  }
  
  // Prioritas 4: Kategori
  if (item.kategori_utama) {
    parts.push('Kategori: ' + item.kategori_utama);
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
  const batchSize = 5; // Process 5 items at a time to avoid rate limits
  
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
        
        // Return embedded document
        return {
          id: item.id,
          text: item.text || item.question || '',
          answer: item.answer || item.response || '',
          kategori: item.kategori_utama || '',
          tags: item.tags || [],
          embedding: embedding,
          embeddingText: textToEmbed // Simpan untuk debugging
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
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
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
  console.log(`📊 Total documents: ${embeddedDocs.length}`);
  console.log(`📏 Embedding dimension: ${embeddedDocs[0]?.embedding?.length || 'N/A'}`);
  console.log('\n🎉 RAG Index siap digunakan!\n');
}

// ======== JALANKAN SCRIPT =========
generateEmbeddings().catch(error => {
  console.error('\n❌ Fatal Error:', error);
  process.exit(1);
});
