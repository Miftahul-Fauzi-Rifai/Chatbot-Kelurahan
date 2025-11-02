// Nama file: cek_model.js
// Skrip ini hanya untuk mengecek model apa saja yang tersedia untuk API key Anda.

const axios = require('axios');

// ------------------------------------------------------------------
// --- PASTE API KEY ANDA DI SINI ---
const API_KEY = "AIzaSyAcpR2yI9uUKpouInHeKFUlKvQOw4QASKQ";
// ------------------------------------------------------------------


// Kita akan mencoba dua endpoint: v1beta dan v1
const endpoints = [
  { version: "v1beta", url: `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}` },
  { version: "v1", url: `https://generativelanguage.googleapis.com/v1/models?key=${API_KEY}` }
];

async function cekModel() {
  console.log(`Mencari model untuk API key yang berakhiran: ...${API_KEY.slice(-4)}`);
  
  let modelsFound = [];

  for (const endpoint of endpoints) {
    console.log(`\n--- Mencoba endpoint ${endpoint.version} ---`);
    try {
      const response = await axios.get(endpoint.url, {
        headers: { 'Content-Type': 'application/json' }
      });

      const models = response.data.models;
      if (!models || models.length === 0) {
        console.log(`Tidak ada model ditemukan di endpoint ${endpoint.version}.`);
        continue;
      }

      console.log(`Sukses! Model yang ditemukan di ${endpoint.version}:`);
      
      models.forEach(model => {
        // Dapatkan nama pendeknya, cth: "gemini-pro"
        const modelName = model.name.split('/')[1];
        
        // Cari model yang bisa kita pakai untuk chat
        const methods = model.supportedGenerationMethods || [];
        
        if (methods.includes('generateContent') || methods.includes('generateText')) {
          console.log(`\n  ✅ ${modelName}`);
          console.log(`     Full Name: ${model.name}`);
          console.log(`     Endpoint: ${endpoint.version}`);
          console.log(`     Methods: ${methods.join(', ')}`);
          
          modelsFound.push({
            name: modelName,
            version: endpoint.version,
            method: methods.includes('generateContent') ? 'generateContent' : 'generateText'
          });
        }
      });

    } catch (err) {
      const errorMsg = err.response ? `${err.response.status} ${err.response.statusText}` : err.message;
      console.error(`Gagal di endpoint ${endpoint.version}: ${errorMsg}`);
    }
  }

  console.log("\n--- Rekomendasi ---");
  if (modelsFound.length > 0) {
    console.log("Silakan PERBARUI file server.js Anda dengan salah satu model di atas.");
    console.log("Contoh: Jika Anda menemukan 'gemini-pro', gunakan itu di server.js Anda.");
  } else {
    console.log("Tidak ada model yang ditemukan. Pastikan API key Anda benar dan aktif.");
  }
}

cekModel();