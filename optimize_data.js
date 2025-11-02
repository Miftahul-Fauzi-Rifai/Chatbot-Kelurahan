// optimize_data.js
// Script untuk mengoptimalkan data train.json agar tidak over/terlalu banyak
// Menghapus duplikasi, mengkategorikan, dan memilih data terpenting

import fs from 'fs';
import path from 'path';

const TRAIN_FILE = './data/train.json';
const KLARIFIKASI_FILE = './data/kosakata_jawa.json';
const OPTIMIZED_FILE = './data/train_optimized.json';
const BACKUP_FILE = './data/train_backup.json';

console.log('🔧 Optimasi Data Training Started...\n');

// Read data
const trainData = JSON.parse(fs.readFileSync(TRAIN_FILE, 'utf8'));
const klarifikasiData = fs.existsSync(KLARIFIKASI_FILE) 
  ? JSON.parse(fs.readFileSync(KLARIFIKASI_FILE, 'utf8'))
  : [];

console.log(`📊 Data Original:`);
console.log(`   - train.json: ${trainData.length} items`);
console.log(`   - kosakata_jawa.json: ${klarifikasiData.length} items`);
console.log(`   - Total: ${trainData.length + klarifikasiData.length} items\n`);

// STEP 1: Kategorisasi dan prioritas
const KATEGORI_PRIORITY = {
  'Kependudukan': 10,           // KTP, KK, Akta - PALING PENTING
  'Surat Kelurahan': 9,         // Surat domisili, dll
  'Perizinan': 8,               // SIM, SKCK, Paspor
  'Pajak': 7,                   // PBB, NPWP
  'Kendaraan': 7,               // STNK, BPKB
  'Layanan Publik': 6,          // BPJS, PLN, PDAM
  'Administrasi Nikah': 8,      // Persyaratan nikah
  'Pengaduan': 6,               // LAPOR!
  'Lokasi Instansi': 5,         // Alamat, jam kerja
  'Jam Kerja': 4,
  'Istilah': 3,                 // Klarifikasi istilah
  'Umum': 2
};

// STEP 2: Hapus duplikasi berdasarkan similarity text
function normalizeText(text) {
  return text.toLowerCase()
    .replace(/[^\w\s]/g, '')  // Hapus tanda baca
    .replace(/\s+/g, ' ')     // Multiple spaces jadi satu
    .trim();
}

function isSimilar(text1, text2, threshold = 0.8) {
  const norm1 = normalizeText(text1);
  const norm2 = normalizeText(text2);
  
  // Exact match
  if (norm1 === norm2) return true;
  
  // Word overlap similarity
  const words1 = new Set(norm1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(norm2.split(' ').filter(w => w.length > 2));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  const similarity = intersection.size / union.size;
  return similarity >= threshold;
}

// STEP 3: Deduplikasi
console.log('🔍 Checking for duplicates...');
const allData = [...trainData, ...klarifikasiData];
const uniqueData = [];
const seen = new Map();

for (const item of allData) {
  const text = item.text || item.question || '';
  const kategori = item.kategori_utama || item.kategori || 'Umum';
  
  // Cek apakah sudah ada yang mirip
  let isDuplicate = false;
  for (const [seenText, seenItem] of seen) {
    if (isSimilar(text, seenText, 0.85)) {
      isDuplicate = true;
      
      // Pilih yang lebih prioritas atau lebih lengkap
      const currentPriority = KATEGORI_PRIORITY[kategori] || 0;
      const seenPriority = KATEGORI_PRIORITY[seenItem.kategori_utama || seenItem.kategori || 'Umum'] || 0;
      
      // Replace jika prioritas lebih tinggi atau jawaban lebih panjang
      const currentAnswer = item.answer || item.response || '';
      const seenAnswer = seenItem.answer || seenItem.response || '';
      
      if (currentPriority > seenPriority || 
          (currentPriority === seenPriority && currentAnswer.length > seenAnswer.length)) {
        // Update dengan yang lebih baik
        const index = uniqueData.findIndex(d => d === seenItem);
        if (index !== -1) {
          uniqueData[index] = item;
          seen.set(seenText, item);
        }
      }
      break;
    }
  }
  
  if (!isDuplicate) {
    uniqueData.push(item);
    seen.set(text, item);
  }
}

console.log(`   ✅ Removed ${allData.length - uniqueData.length} duplicates\n`);

// STEP 4: Filter dan ranking
console.log('📊 Categorizing by priority...');

// Group by category
const byCategory = {};
for (const item of uniqueData) {
  const kategori = item.kategori_utama || item.kategori || 'Umum';
  if (!byCategory[kategori]) {
    byCategory[kategori] = [];
  }
  byCategory[kategori].push(item);
}

// Print statistics
console.log('\n📈 Data by Category:');
const sortedCategories = Object.entries(byCategory)
  .sort((a, b) => (KATEGORI_PRIORITY[b[0]] || 0) - (KATEGORI_PRIORITY[a[0]] || 0));

for (const [kategori, items] of sortedCategories) {
  const priority = KATEGORI_PRIORITY[kategori] || 0;
  console.log(`   ${kategori.padEnd(25)} : ${items.length.toString().padStart(3)} items (Priority: ${priority})`);
}

// STEP 5: Smart selection - ambil data terpenting
console.log('\n🎯 Smart Selection Strategy:');

const MAX_TOTAL = 150; // Target: ~150 data (dari 432)
const selectedData = [];

// Strategy: Ambil proporsi berdasarkan prioritas kategori
const totalPriority = sortedCategories.reduce((sum, [k, items]) => 
  sum + (KATEGORI_PRIORITY[k] || 0) * items.length, 0);

for (const [kategori, items] of sortedCategories) {
  const priority = KATEGORI_PRIORITY[kategori] || 0;
  
  // Hitung berapa banyak yang harus diambil dari kategori ini
  const proportion = (priority * items.length) / totalPriority;
  let quota = Math.ceil(proportion * MAX_TOTAL);
  
  // Minimum quota untuk kategori penting
  if (priority >= 8) {
    quota = Math.max(quota, Math.min(15, items.length));
  } else if (priority >= 6) {
    quota = Math.max(quota, Math.min(10, items.length));
  } else if (priority >= 4) {
    quota = Math.max(quota, Math.min(5, items.length));
  }
  
  // Jangan ambil lebih dari yang tersedia
  quota = Math.min(quota, items.length);
  
  // Prioritaskan berdasarkan panjang jawaban (lebih informatif)
  const sortedItems = items.sort((a, b) => {
    const answerA = (a.answer || a.response || '').length;
    const answerB = (b.answer || b.response || '').length;
    return answerB - answerA;
  });
  
  // Ambil top items
  const selected = sortedItems.slice(0, quota);
  selectedData.push(...selected);
  
  console.log(`   ✓ ${kategori.padEnd(25)} : ${selected.length}/${items.length} selected`);
}

console.log(`\n📊 Final Result:`);
console.log(`   - Original: ${allData.length} items`);
console.log(`   - After deduplication: ${uniqueData.length} items`);
console.log(`   - After optimization: ${selectedData.length} items`);
console.log(`   - Reduction: ${((1 - selectedData.length/allData.length) * 100).toFixed(1)}%\n`);

// STEP 6: Backup dan save
console.log('💾 Saving files...');

// Backup original
if (!fs.existsSync(BACKUP_FILE)) {
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(trainData, null, 2));
  console.log(`   ✓ Backup created: ${BACKUP_FILE}`);
}

// Save optimized
fs.writeFileSync(OPTIMIZED_FILE, JSON.stringify(selectedData, null, 2));
console.log(`   ✓ Optimized data saved: ${OPTIMIZED_FILE}`);

// Optional: Replace original with optimized (uncomment jika ingin langsung replace)
// fs.writeFileSync(TRAIN_FILE, JSON.stringify(selectedData, null, 2));
// console.log(`   ✓ Original file updated: ${TRAIN_FILE}`);

console.log('\n✅ Optimization Complete!');
console.log('\n💡 Next Steps:');
console.log('   1. Review optimized data: data/train_optimized.json');
console.log('   2. If satisfied, replace original:');
console.log('      cp data/train_optimized.json data/train.json');
console.log('   3. Or manually replace in server.js to use train_optimized.json\n');
