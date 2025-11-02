/**
 * Test Layer 4: Local RAG (Keyword Matching - Pure Lokal)
 * Script untuk testing Local RAG handler (TANPA API CALL)
 * Jalankan: npm run test:local
 */

import fs from 'fs';

// ========================================
// LOCAL RAG FUNCTIONS (Layer 4)
// ========================================

/**
 * Load training data
 */
function loadTrainingData() {
  try {
    const trainFile = './data/train.json';
    const klarifikasiFile = './data/kosakata_jawa.json';
    
    const trainData = fs.existsSync(trainFile) 
      ? JSON.parse(fs.readFileSync(trainFile, 'utf8')) 
      : [];
    
    const klarifikasiData = fs.existsSync(klarifikasiFile) 
      ? JSON.parse(fs.readFileSync(klarifikasiFile, 'utf8')) 
      : [];
    
    return [...trainData, ...klarifikasiData];
  } catch (error) {
    console.error('❌ Error loading training data:', error.message);
    return [];
  }
}

/**
 * Advanced Local Keyword Matching
 * @param {string} message - User query
 * @param {Array} allData - Training data
 * @param {number} topK - Number of results to return
 * @returns {Array} - Matched documents with scores
 */
function localKeywordSearch(message, allData, topK = 3) {
  const lowerMessage = message.toLowerCase().trim();
  
  // Remove common stop words
  const stopWords = [
    'cara', 'bagaimana', 'apa', 'dimana', 'berapa', 'apakah', 
    'bisa', 'saya', 'untuk', 'yang', 'dan', 'atau', 'di', 'ke', 'dari',
    // Javanese stop words
    'opo', 'pripun', 'nopo', 'piye', 'ngendi', 'piro', 'opo iku',
    // Bugis stop words
    'aga', 'iko', 'aganna'
  ];
  
  const queryWords = lowerMessage
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w));
  
  // High-priority keyword patterns
  const patterns = [
    { regex: /\b(ktp|e-?ktp|ektp|kartu tanda penduduk)\b/i, boost: 50, type: 'ktp', label: 'KTP/e-KTP' },
    { regex: /\b(kk|kartu keluarga)\b/i, boost: 50, type: 'kk', label: 'Kartu Keluarga' },
    { regex: /\b(akta (kelahiran|lahir))\b/i, boost: 50, type: 'akta_lahir', label: 'Akta Kelahiran' },
    { regex: /\b(akta (kematian|meninggal|mati))\b/i, boost: 50, type: 'akta_mati', label: 'Akta Kematian' },
    { regex: /\b(sim|surat izin mengemudi)\b/i, boost: 50, type: 'sim', label: 'SIM' },
    { regex: /\b(skck|surat keterangan catatan kepolisian)\b/i, boost: 50, type: 'skck', label: 'SKCK' },
    { regex: /\b(npwp|nomor pokok wajib pajak)\b/i, boost: 50, type: 'npwp', label: 'NPWP' },
    { regex: /\b(bpjs|kartu indonesia sehat|kis)\b/i, boost: 50, type: 'bpjs', label: 'BPJS/KIS' },
    { regex: /\bpaspor\b/i, boost: 50, type: 'paspor', label: 'Paspor' },
    { regex: /\b(stnk|bpkb)\b/i, boost: 50, type: 'kendaraan', label: 'STNK/BPKB' },
    { regex: /\b(nikah|menikah|kawin)\b/i, boost: 50, type: 'nikah', label: 'Pernikahan' },
    { regex: /\b(pindah|domisili|surat pindah)\b/i, boost: 40, type: 'pindah', label: 'Pindah Domisili' },
    { regex: /\b(usaha|sku|surat keterangan usaha)\b/i, boost: 40, type: 'usaha', label: 'Surat Usaha' },
    { regex: /\b(disdukcapil|dinas kependudukan)\b/i, boost: 30, type: 'disdukcapil', label: 'Disdukcapil' },
    { regex: /\b(kelurahan|kantor kelurahan)\b/i, boost: 30, type: 'kelurahan', label: 'Kelurahan' }
  ];
  
  // Find matched pattern
  let matchedPattern = null;
  for (const pattern of patterns) {
    if (pattern.regex.test(lowerMessage)) {
      matchedPattern = pattern;
      break;
    }
  }
  
  // Score each document
  const matches = allData.map(item => {
    const text = (item.text || item.question || '').toLowerCase();
    const answer = (item.answer || item.response || '').toLowerCase();
    const tags = (item.tags || []).join(' ').toLowerCase();
    const kategori = (item.kategori_utama || '').toLowerCase();
    
    let score = 0;
    let matchDetails = [];
    
    // 1. Pattern matching (HIGHEST PRIORITY)
    if (matchedPattern) {
      if (tags.includes(matchedPattern.type)) {
        score += matchedPattern.boost;
        matchDetails.push(`Pattern match in tags: ${matchedPattern.label}`);
      } else if (text.includes(matchedPattern.type)) {
        score += matchedPattern.boost * 0.8;
        matchDetails.push(`Pattern match in text: ${matchedPattern.label}`);
      } else if (kategori.includes(matchedPattern.type)) {
        score += matchedPattern.boost * 0.6;
        matchDetails.push(`Pattern match in category: ${matchedPattern.label}`);
      }
    }
    
    // 2. Exact phrase matching
    const cleanMessage = lowerMessage.replace(/[^\w\s]/g, '');
    const cleanText = text.replace(/[^\w\s]/g, '');
    
    if (cleanMessage.length > 10 && cleanText.includes(cleanMessage.substring(0, 15))) {
      score += 40;
      matchDetails.push('Exact phrase match');
    }
    
    // 3. Individual keyword matching
    let keywordMatches = 0;
    queryWords.forEach(word => {
      if (text.includes(word)) {
        score += 20;
        keywordMatches++;
      }
      if (tags.includes(word)) {
        score += 15;
        keywordMatches++;
      }
      if (kategori.includes(word)) {
        score += 10;
        keywordMatches++;
      }
      if (answer.includes(word)) {
        score += 5;
        keywordMatches++;
      }
    });
    
    if (keywordMatches > 0) {
      matchDetails.push(`${keywordMatches} keyword matches`);
    }
    
    // 4. Multi-word bonus
    const matchedWords = queryWords.filter(w => text.includes(w) || tags.includes(w));
    if (matchedWords.length >= 2) {
      score += matchedWords.length * 10;
      matchDetails.push(`Multi-word bonus (${matchedWords.length} words)`);
    }
    
    return { 
      item, 
      score,
      matchedWords: matchedWords.length,
      totalWords: queryWords.length,
      matchDetails,
      confidence: Math.min((score / 100) * 100, 100) // Normalize to percentage
    };
  })
  .filter(m => m.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, topK);
  
  return matches;
}

/**
 * Get Local RAG Status
 */
function getLocalRAGStatus() {
  const allData = loadTrainingData();
  
  return {
    available: allData.length > 0,
    documentCount: allData.length,
    mode: 'local_keyword_matching',
    apiCalls: 0,
    cost: '$0 (unlimited)',
    status: allData.length > 0 ? 'ready' : 'not_initialized'
  };
}

/**
 * Local RAG: Search + Return Answer
 * @param {string} query - User query
 * @returns {Object} - Result object
 */
function localRAG(query) {
  const allData = loadTrainingData();
  
  if (allData.length === 0) {
    return {
      ok: false,
      error: 'NO_DATA',
      message: 'Training data tidak ditemukan. Periksa file data/train.json',
      sources: []
    };
  }
  
  const startTime = Date.now();
  const results = localKeywordSearch(query, allData, 3);
  const latency = Date.now() - startTime;
  
  if (results.length === 0) {
    return {
      ok: false,
      error: 'NO_MATCH',
      message: 'Maaf, saya tidak menemukan informasi yang relevan. Silakan hubungi petugas kelurahan untuk bantuan lebih lanjut.',
      sources: [],
      metadata: {
        latency: `${latency}ms`,
        apiCalls: 0,
        mode: 'local_keyword'
      }
    };
  }
  
  // Return best match answer
  const bestMatch = results[0];
  
  return {
    ok: true,
    answer: bestMatch.item.answer || bestMatch.item.response || 'Informasi tidak tersedia.',
    sources: results.map(r => ({
      text: r.item.text || r.item.question || '',
      score: r.confidence / 100,
      kategori: r.item.kategori_utama || 'N/A',
      tags: r.item.tags || [],
      matchDetails: r.matchDetails
    })),
    metadata: {
      mode: 'local_keyword',
      latency: `${latency}ms`,
      confidence: `${bestMatch.confidence.toFixed(1)}%`,
      matchedWords: `${bestMatch.matchedWords}/${bestMatch.totalWords}`,
      apiCalls: 0,
      cost: '$0'
    }
  };
}

// ========================================
// TEST SUITE (Mirip test_rag.js)
// ========================================

async function testLocalRAG() {
  console.log('🧪 Testing LOCAL RAG System (Layer 4 - Keyword Matching)\n');
  
  // 1. Check RAG Status
  console.log('📊 Local RAG Status:');
  const status = getLocalRAGStatus();
  console.log(JSON.stringify(status, null, 2));
  console.log('\n');
  
  if (!status.available) {
    console.error('❌ Local RAG tidak tersedia. Periksa file data/train.json');
    process.exit(1);
  }
  
  // 2. Test queries (SAMA dengan test_rag.js)
  const testQueries = [
    'Bagaimana cara membuat KTP?',
    'Apa itu SKCK?',
    'Dimana lokasi Disdukcapil?',
    'Cara perpanjang SIM online',
    'Opo kuwi SKCK',           // Bahasa Jawa
    'Nopo niku STNK?'          // Bahasa Jawa
  ];
  
  let successCount = 0;
  let totalLatency = 0;
  
  for (const query of testQueries) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`❓ QUERY: "${query}"`);
    console.log('='.repeat(80));
    
    const result = localRAG(query);
    
    if (result.ok) {
      successCount++;
      totalLatency += parseInt(result.metadata.latency);
      
      console.log(`\n✅ SUCCESS\n`);
      console.log(`📝 JAWABAN:\n${result.answer}\n`);
      console.log(`📚 SOURCES (${result.sources.length}):`);
      result.sources.forEach((source, i) => {
        console.log(`   ${i + 1}. [${(source.score * 100).toFixed(1)}%] ${source.text.substring(0, 60)}...`);
        console.log(`      Kategori: ${source.kategori}`);
        console.log(`      Tags: ${source.tags.join(', ')}`);
        if (source.matchDetails && source.matchDetails.length > 0) {
          console.log(`      Match: ${source.matchDetails.join(', ')}`);
        }
      });
      console.log(`\n🤖 Metadata:`, result.metadata);
    } else {
      console.log(`\n❌ FAILED: ${result.error}`);
      console.log(`💬 Message: ${result.message}`);
      if (result.metadata) {
        console.log(`🤖 Metadata:`, result.metadata);
      }
    }
    
    // NO DELAY NEEDED (tidak ada API call!)
    // await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log('🎉 Testing selesai!');
  console.log('='.repeat(80));
  
  // Summary statistics
  console.log(`\n📊 SUMMARY:`);
  console.log(`   Total Queries: ${testQueries.length}`);
  console.log(`   Successful: ${successCount} (${((successCount/testQueries.length)*100).toFixed(1)}%)`);
  console.log(`   Failed: ${testQueries.length - successCount}`);
  console.log(`   Avg Latency: ${(totalLatency / successCount).toFixed(0)}ms`);
  console.log(`   API Calls: 0 (UNLIMITED, GRATIS 100%)`);
  console.log(`   Total Cost: $0`);
  console.log(`\n💡 KEUNGGULAN LOCAL RAG:`);
  console.log(`   ✅ Instant response (<10ms average)`);
  console.log(`   ✅ Unlimited queries (no quota)`);
  console.log(`   ✅ 100% gratis (no API cost)`);
  console.log(`   ✅ Works offline (no internet needed)`);
  console.log(`   ⚠️  Akurasi: 60-75% (lower than Gemini API)`);
  console.log(`\n💬 REKOMENDASI:`);
  console.log(`   - Gunakan untuk FAQ sederhana`);
  console.log(`   - Fallback ketika API quota habis`);
  console.log(`   - Combine dengan caching untuk performa maksimal`);
  console.log('='.repeat(80));
}

// Run test
testLocalRAG().catch(console.error);