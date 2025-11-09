# ✅ CHECKLIST PEMBARUAN CHATBOT KELURAHAN

## 🎯 Pembaruan yang Sudah Diterapkan

### 1. ✅ Aktivasi RAG Semantik
- [x] Import `localRAG` dan `getRAGStatus` di `server.js`
- [x] Import `localRAG` dan `getRAGStatus` di `server_production.js`
- [x] RAG dijadikan fallback Layer 4 (sebelum keyword fallback)
- [x] Endpoint `/api/rag/status` untuk monitoring

### 2. ✅ System Instruction Final
- [x] Aturan bahasa KETAT: Jawaban WAJIB Bahasa Indonesia
- [x] Dapat memahami input bahasa lain (Jawa, Inggris)
- [x] Format jawaban terstruktur (pembukaan, syarat, prosedur, penutup)
- [x] Penolakan sopan untuk topik di luar cakupan
- [x] Klarifikasi untuk pertanyaan tidak lengkap

### 3. ✅ Pesan Fallback Manusiawi
- [x] Tidak ada frasa "AI sedang sibuk"
- [x] Tidak menyebut "data lokal" atau "sumber"
- [x] Pesan singkat, jelas, sopan
- [x] Contoh: "Maaf, saya belum menemukan jawaban yang tepat. Bisa dijelaskan lebih rinci?"

### 4. ✅ Optimasi Embedding (rag_index.js)
- [x] Deduplikasi otomatis (hash SHA-1)
- [x] Chunk merge (max 500 karakter per chunk)
- [x] Filter stopwords (Indonesia + Jawa)
- [x] Batasi total dokumen (maksimal 400)
- [x] Simpan hanya field penting (id, text, answer, kategori, tags, embedding)
- [x] Batch size dinaikkan (5 → 10 items)
- [x] Delay dikurangi (1s → 0.5s)

### 5. ✅ Kompatibilitas Deploy
- [x] `server_production.js` ekspor `app` untuk Vercel
- [x] Conditional `app.listen()` (skip jika VERCEL env)
- [x] File `vercel.json` untuk routing
- [x] File `api/index.js` wrapper untuk serverless
- [x] File `PRODUCTION_READY.md` dengan panduan lengkap

## 🧪 Testing yang Harus Dilakukan

### Test 1: Bahasa Jawa → Bahasa Indonesia
```bash
# Input: "Opo kuwi SKCK?"
# Expected: Jawaban lengkap dalam Bahasa Indonesia
```

### Test 2: Pertanyaan Tidak Lengkap
```bash
# Input: "cara membuat?"
# Expected: "Untuk membantu Anda, boleh saya tahu dokumen apa yang ingin Anda buat?..."
```

### Test 3: Di Luar Topik
```bash
# Input: "Resep nasi goreng"
# Expected: "Maaf, sebagai Asisten Virtual Kelurahan Marga Sari, saya hanya dapat membantu..."
```

### Test 4: RAG Fallback
```bash
# Matikan API Gemini (set API key salah sementara)
# Input: "Syarat buat KTP"
# Expected: Jawaban dari RAG semantik (manusiawi, tanpa sebut "AI sibuk")
```

## 🚀 Langkah Deployment

### Persiapan
```bash
# 1. Install dependencies
npm install

# 2. Build RAG index (PENTING!)
npm run rag:index

# 3. Test lokal
npm start

# 4. Verifikasi
curl http://localhost:3000/health
curl http://localhost:3000/api/rag/status
```

### Deploy ke Render
1. Push ke GitHub:
   ```bash
   git add .
   git commit -m "Production ready: RAG semantik aktif, optimasi embedding"
   git push origin main
   ```

2. Buat Web Service di Render:
   - Build Command: `npm install && npm run rag:index`
   - Start Command: `npm start`
   - Environment: `GEMINI_API_KEY`, `NODE_ENV=production`

3. Tunggu deploy selesai (~5-10 menit)

4. Test endpoint production:
   ```bash
   curl https://your-app.onrender.com/health
   curl https://your-app.onrender.com/api/rag/status
   ```

### Deploy ke Vercel (Opsional)
```bash
npm i -g vercel
vercel
vercel env add GEMINI_API_KEY
```

**⚠️ PERHATIAN:** Vercel limit 50MB. Pastikan `embedded_docs.json` < 40MB.

## 📊 Monitoring

### Endpoint Penting
- `/health` - Health check (untuk Render monitoring)
- `/status` - Rate limit & model info
- `/api/rag/status` - Status RAG (loaded docs, model)
- `/chat` - Main endpoint

### Logs yang Perlu Diperhatikan
- `✅ RAG Fallback success` - RAG bekerja
- `⚠️ All Gemini models failed` - Semua model gagal (normal, RAG akan handle)
- `❌ RAG Error` - Ada masalah dengan RAG (perlu investigasi)

## 🎯 Hasil yang Diharapkan

### Sebelum Update
- ❌ Fallback hanya keyword matching sederhana
- ❌ Pesan "AI sedang sibuk" muncul
- ❌ Embedding terlalu banyak (>1000 dokumen)
- ❌ Tidak ada aturan bahasa ketat

### Setelah Update
- ✅ Fallback multi-layer (Gemini → RAG Semantik → Keyword → Generic)
- ✅ Pesan manusiawi dan profesional
- ✅ Embedding optimal (≤400 dokumen, < 50MB)
- ✅ Jawaban SELALU Bahasa Indonesia (meski input Jawa)
- ✅ Siap production (Render/Vercel compatible)

## 📝 Catatan Penting

1. **Jangan lupa build RAG index** sebelum deploy:
   ```bash
   npm run rag:index
   ```

2. **File penting untuk deploy:**
   - `data/embedded_docs.json` (hasil indexing)
   - `data/train_optimized.json` (data training)
   - `.env` (GEMINI_API_KEY)

3. **Vercel deployment:** Jika `embedded_docs.json` terlalu besar, gunakan Render atau external storage.

4. **Rate limiting:** API Gemini Free tier: 15 req/min. Server sudah handle otomatis.

## 🔗 Dokumentasi Tambahan

- `PRODUCTION_READY.md` - Panduan deployment lengkap
- `RAG_SETUP.md` - Dokumentasi RAG (jika ada)
- `DEPLOYMENT_GUIDE.md` - Guide deployment umum

---

**Status:** ✅ READY FOR PRODUCTION  
**Last Updated:** November 9, 2025  
**Next Steps:** Build RAG index → Test → Deploy → Monitor
