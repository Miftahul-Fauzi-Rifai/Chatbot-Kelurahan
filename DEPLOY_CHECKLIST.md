# ✅ CHECKLIST DEPLOY VERCEL DENGAN CACHE SYSTEM

## 📋 Status Pembaruan

### ✅ Yang Sudah Dikerjakan:

1. **✅ Cache System Terintegrasi**
   - File `utils/cache.js` dibuat (support Redis + in-memory)
   - `server_production.js` diupdate (cache-first strategy)
   - Endpoint `/api/cache/status` untuk monitoring

2. **✅ Upstash Redis Support**
   - Dependency `@upstash/redis` terinstall
   - Auto-detect: pakai Redis jika env tersedia, fallback ke memory
   - TTL 6 jam (configurable via env)

3. **✅ Environment Variables**
   - `.env.example` diupdate dengan cache config
   - Ready untuk Upstash credentials

4. **✅ Dokumentasi Lengkap**
   - `UPSTASH_REDIS_SETUP.md` - Setup Redis step-by-step
   - `VERCEL_DEPLOYMENT.md` - Deploy Vercel lengkap
   - `CHECKLIST_UPDATE.md` - Checklist pembaruan fitur

---

## 🚀 Langkah Deploy (Ringkas)

### **Persiapan (Lokal)**

```bash
# 1. Masuk folder project
cd "d:\Develop Web Laravel\Chatbot-gemini\kelurahan-chatbot-gemini"

# 2. Install dependency
npm install

# 3. Build RAG index (WAJIB!)
npm run rag:index

# 4. Test lokal
npm start
# Buka: http://localhost:3000/health
```

---

### **Setup Upstash Redis (Gratis)**

1. Buka: https://console.upstash.com
2. Sign up dengan GitHub
3. Create Database:
   - Name: `chatbot-kelurahan-cache`
   - Type: **Regional**
   - Region: **US East** atau **Singapore**
4. Copy credentials:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

---

### **Deploy ke Vercel**

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Login
vercel login

# 3. Deploy
vercel

# Jawab:
# ? Project name: chatbot-kelurahan
# ? Directory: ./

# 4. Set environment variables (via Dashboard)
# Buka: https://vercel.com/dashboard → chatbot-kelurahan → Settings → Environment Variables
# Tambah:
# - GEMINI_API_KEY
# - UPSTASH_REDIS_REST_URL
# - UPSTASH_REDIS_REST_TOKEN
# - NODE_ENV=production
# - CACHE_TTL_SEC=21600
# - CACHE_PREFIX=v1

# 5. Redeploy
vercel --prod
```

---

## ✅ Verifikasi Deploy Berhasil

### 1. Health Check
```bash
curl https://your-app.vercel.app/health
```
Expected: `"status": "healthy"`

### 2. Cache Status (PENTING!)
```bash
curl https://your-app.vercel.app/api/cache/status
```
Expected: `"mode": "redis"` ← Harus Redis!

### 3. Test Chat
```bash
curl -X POST https://your-app.vercel.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Opo kuwi SKCK?"}'
```
Expected: Jawaban Bahasa Indonesia

### 4. Test Cache Hit
Jalankan command #3 lagi (5 detik kemudian)

Expected: `"cached": true` (tidak pakai kuota Gemini!)

---

## 📊 Benefit Cache System

| Aspek | Tanpa Cache | Dengan Cache |
|-------|-------------|--------------|
| **Response Time** | ~2-3 detik | ~200-500ms (4-6x lebih cepat) |
| **Kuota Gemini** | 1 req/pertanyaan | 0 req untuk cache hit |
| **Biaya** | Max limit cepat habis | Hemat 50-70% |
| **User Experience** | Lambat | Sangat responsif |

---

## 🎯 Fitur Cache

### ✅ Auto Cache Response
- Setiap pertanyaan → jawaban di-cache 6 jam
- Pertanyaan sama → langsung dari cache (tidak call Gemini)
- Normalisasi otomatis (lowercase, trim spasi)

### ✅ Smart Cache Key
- SHA-1 hash untuk key konsisten
- Support cache busting via `CACHE_PREFIX`

### ✅ Dual Mode
- **Production (Vercel):** Redis (persisten, shared)
- **Development (Lokal):** In-memory (simple, cepat)

### ✅ Monitoring
- Endpoint `/api/cache/status`
- Upstash dashboard (metrics, hit rate)
- Vercel logs (cache hit/miss)

---

## 📁 File Structure Update

```
kelurahan-chatbot-gemini/
├── utils/
│   └── cache.js                    ← BARU! Cache utility
├── server_production.js            ← UPDATED! Cache integration
├── package.json                    ← UPDATED! + @upstash/redis
├── .env.example                    ← UPDATED! Cache env vars
├── UPSTASH_REDIS_SETUP.md         ← BARU! Setup Redis guide
├── VERCEL_DEPLOYMENT.md           ← BARU! Deploy Vercel guide
└── DEPLOY_CHECKLIST.md            ← File ini
```

---

## 🐛 Troubleshooting Cepat

### Cache tidak aktif (mode: "memory" di Vercel)
**Fix:** Set `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN` di Vercel env → Redeploy

### Build failed: embedded_docs.json not found
**Fix:** `npm run rag:index` → commit file → redeploy

### Error 500: GEMINI_API_KEY not configured
**Fix:** Set `GEMINI_API_KEY` di Vercel env → Redeploy

### Timeout (10s limit)
**Fix:** Upgrade Vercel Pro ($20/bulan) atau gunakan Render

---

## 💡 Tips Production

1. **Monitor cache hit rate**
   - Target: >50% hit rate
   - Cek Upstash metrics weekly

2. **Update cache version saat deploy**
   - Update `CACHE_PREFIX=v2` jika logic/data berubah
   - Bust cache otomatis

3. **Set alert Upstash**
   - Email alert jika mendekati 10K req/day limit
   - Upgrade plan jika perlu

4. **Custom domain**
   - `api.chatbot-kelurahan.com`
   - Lebih profesional

---

## 📞 Support & Docs

- **Vercel Docs:** https://vercel.com/docs
- **Upstash Docs:** https://docs.upstash.com
- **Gemini API Docs:** https://ai.google.dev/docs

---

**Status:** ✅ **READY TO DEPLOY**

**Next:** Jalankan `vercel --prod` dan set environment variables!

---

**Dibuat:** November 9, 2025  
**Last Update:** Cache system integrated
