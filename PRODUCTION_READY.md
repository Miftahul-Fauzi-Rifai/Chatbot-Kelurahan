# 🚀 Panduan Deployment Chatbot Kelurahan

## ✅ Checklist Sebelum Deploy

- [x] RAG semantik diaktifkan di `server_production.js`
- [x] System instruction menggunakan versi final (jawaban wajib Bahasa Indonesia)
- [x] Pesan fallback sudah manusiawi (tidak menyebut "AI sibuk" atau "data lokal")
- [x] Embedding sudah dioptimasi (maksimal 400 dokumen)
- [x] Package.json sudah benar (`start: server_production.js`)
- [x] File `.env` berisi `GEMINI_API_KEY`

## 📦 Persiapan

### 1. Build RAG Index
```bash
npm install
npm run rag:index
```

Pastikan file `data/embedded_docs.json` terbuat dan ukurannya wajar (< 50MB).

### 2. Test Lokal
```bash
npm run dev
# atau
npm start
```

Uji pertanyaan:
- Bahasa Jawa: "Opo kuwi SKCK?" → Jawaban Bahasa Indonesia ✓
- Di luar topik: "Resep nasi goreng" → Penolakan sopan ✓
- Tidak lengkap: "cara membuat?" → Minta klarifikasi ✓

## 🌐 Deploy ke Render

### 1. Push ke GitHub
```bash
git add .
git commit -m "Production ready: RAG aktif + optimasi"
git push origin main
```

### 2. Buat Web Service di Render
- Login ke [render.com](https://render.com)
- New → Web Service
- Connect repository: `Chatbot-Kelurahan`
- Settings:
  - **Name**: `chatbot-kelurahan`
  - **Environment**: `Node`
  - **Build Command**: `npm install && npm run rag:index`
  - **Start Command**: `npm start`
  - **Instance Type**: Free (atau Starter jika butuh performa)

### 3. Environment Variables
Tambahkan di Render Dashboard:
```
GEMINI_API_KEY=your_api_key_here
NODE_ENV=production
PORT=3000
```

### 4. Deploy
- Klik "Create Web Service"
- Tunggu build selesai (~5-10 menit untuk pertama kali)
- Render akan memberikan URL: `https://chatbot-kelurahan-xxxx.onrender.com`

### 5. Verifikasi
```bash
curl https://chatbot-kelurahan-xxxx.onrender.com/health
curl https://chatbot-kelurahan-xxxx.onrender.com/api/rag/status
```

## 🔷 Deploy ke Vercel (Opsional)

### 1. Install Vercel CLI
```bash
npm i -g vercel
```

### 2. Deploy
```bash
vercel
```

### 3. Environment Variables
```bash
vercel env add GEMINI_API_KEY
```

**⚠️ CATATAN PENTING untuk Vercel:**
- Vercel memiliki limit ukuran deployment (50MB)
- File `embedded_docs.json` harus < 40MB
- Jika lebih besar, gunakan Render atau simpan embedding di database eksternal

## 🧪 Testing Production

### Test Endpoint Chat
```bash
curl -X POST https://your-app.onrender.com/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Opo kuwi SKCK?"}'
```

Expected: Jawaban dalam Bahasa Indonesia.

### Test RAG Status
```bash
curl https://your-app.onrender.com/api/rag/status
```

Expected:
```json
{
  "ok": true,
  "rag": {
    "available": true,
    "totalDocs": 350,
    "embeddingModel": "text-embedding-004",
    "generationModel": "gemini-2.0-flash-exp"
  }
}
```

## 📊 Monitoring

### Render Logs
- Dashboard → Your Service → Logs
- Monitor error dan performance

### Health Check
Render akan ping `/health` secara otomatis. Pastikan endpoint ini return 200.

## 🔧 Troubleshooting

### Build Gagal di Render
- Cek logs: apakah `npm run rag:index` sukses?
- Pastikan `GEMINI_API_KEY` sudah di-set
- Pastikan file `data/train.json` dan `data/kosakata_jawa.json` ada di repo

### RAG Tidak Aktif
- Cek `/api/rag/status`: `available: true`?
- Jika `false`, cek file `data/embedded_docs.json` ada dan valid

### Performa Lambat
- Upgrade instance di Render (Free → Starter)
- Kurangi jumlah embedding (edit `rag_index.js`, batasi < 300 docs)

## 🎯 Next Steps

1. ✅ Deploy berhasil
2. ✅ Test semua endpoint
3. ✅ Monitoring logs 24 jam pertama
4. 📱 Integrasikan frontend (React/Vue/HTML)
5. 🔒 Tambah autentikasi jika diperlukan
6. 📈 Setup analytics (Google Analytics, Mixpanel, dll)

---

**Dibuat:** November 2025  
**Maintainer:** Kelurahan Marga Sari, Balikpapan
