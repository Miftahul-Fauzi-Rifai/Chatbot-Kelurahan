# 🔐 Environment Variables untuk Vercel

Setelah deploy ke Vercel, tambahkan environment variables berikut di Vercel Dashboard:

## ✅ WAJIB (Required)

### 1. GEMINI_API_KEY
**Nilai:** API Key dari Google AI Studio  
**Cara dapat:**
1. Buka https://aistudio.google.com/apikey
2. Login dengan Google Account
3. Klik "Create API Key"
4. Copy API key yang dihasilkan

**Contoh:**
```
AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 🔧 OPSIONAL (Recommended untuk Production)

### 2. UPSTASH_REDIS_REST_URL
**Nilai:** URL endpoint Redis dari Upstash  
**Fungsi:** Cache untuk hemat quota Gemini API  
**Cara dapat:**
1. Buka https://console.upstash.com
2. Sign up/Login (gratis)
3. Klik "Create Database"
4. Pilih region terdekat (Singapore recommended untuk Indonesia)
5. Copy nilai `UPSTASH_REDIS_REST_URL`

**Contoh:**
```
https://xxxxx-xxxx-xxxxx.upstash.io
```

### 3. UPSTASH_REDIS_REST_TOKEN
**Nilai:** Token autentikasi Redis dari Upstash  
**Fungsi:** Auth untuk koneksi ke Redis  
**Cara dapat:** Dari halaman yang sama dengan `UPSTASH_REDIS_REST_URL`

**Contoh:**
```
AXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4. CACHE_TTL_SEC
**Nilai:** `21600` (6 jam)  
**Fungsi:** Durasi cache disimpan (dalam detik)  
**Default:** 21600 jika tidak diisi

### 5. CACHE_PREFIX
**Nilai:** `v1`  
**Fungsi:** Prefix untuk cache key (untuk versioning)  
**Default:** `v1` jika tidak diisi

### 6. NODE_ENV
**Nilai:** `production`  
**Fungsi:** Menandakan environment production  
**Default:** Otomatis `production` di Vercel

---

## 📝 Cara Setting di Vercel Dashboard

### Via Web Dashboard (Recommended):
1. Buka https://vercel.com/dashboard
2. Pilih project **Chatbot-Kelurahan**
3. Klik tab **Settings**
4. Klik **Environment Variables** di sidebar
5. Tambahkan satu per satu:
   - **Key:** `GEMINI_API_KEY`
   - **Value:** Paste API key Anda
   - **Environment:** Pilih `Production`, `Preview`, `Development` (pilih semua)
6. Klik **Save**
7. Ulangi untuk variable lainnya

### Via Vercel CLI:
```bash
vercel env add GEMINI_API_KEY
# Paste value saat diminta

vercel env add UPSTASH_REDIS_REST_URL
# Paste value

vercel env add UPSTASH_REDIS_REST_TOKEN
# Paste value
```

---

## 🚀 Deploy Steps

1. **Login ke Vercel:**
   - Via Dashboard: https://vercel.com/login
   - Via CLI: `vercel login`

2. **Import Repository:**
   - Klik **"Add New Project"**
   - Pilih **"Import Git Repository"**
   - Cari repo: `Miftahul-Fauzi-Rifai/Chatbot-Kelurahan`
   - Klik **Import**

3. **Configure Project:**
   - Framework Preset: **Other**
   - Build Command: (kosongkan)
   - Output Directory: (kosongkan)
   - Install Command: `npm install`

4. **Add Environment Variables:**
   - Minimal: `GEMINI_API_KEY` (WAJIB)
   - Recommended: Tambah juga Redis credentials

5. **Deploy:**
   - Klik **Deploy**
   - Tunggu ~2-3 menit
   - Done! ✅

---

## ✅ Verifikasi Setelah Deploy

1. **Test Health Endpoint:**
   ```bash
   curl https://your-project.vercel.app/health
   ```
   
   Response yang benar:
   ```json
   {
     "status": "healthy",
     "checks": {
       "api_key": "OK",
       "training_data": "OK (150 items)",
       "memory": "45MB"
     }
   }
   ```

2. **Test Cache Status:**
   ```bash
   curl https://your-project.vercel.app/api/cache/status
   ```
   
   Jika Redis configured:
   ```json
   {
     "ok": true,
     "cache": {
       "mode": "redis",
       "connected": true
     }
   }
   ```

3. **Test Chat:**
   ```bash
   curl -X POST https://your-project.vercel.app/chat \
     -H "Content-Type: application/json" \
     -d '{"message": "cara buat KTP?"}'
   ```

---

## 🔍 Troubleshooting

### ❌ Error: "GEMINI_API_KEY not configured"
**Solusi:** Environment variable `GEMINI_API_KEY` belum di-set di Vercel

### ❌ Cache mode: "memory" (harusnya "redis")
**Solusi:** `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN` belum di-set

### ❌ Error 500 saat deploy
**Solusi:** Cek Vercel logs di Dashboard → Deployments → Klik deployment → Function Logs

---

## 📊 Monitoring

- **Vercel Dashboard:** https://vercel.com/dashboard
  - Lihat deployment status
  - Cek function logs
  - Monitor bandwidth usage

- **Upstash Dashboard:** https://console.upstash.com
  - Lihat cache hit rate
  - Monitor Redis memory usage
  - Cek request count

---

## 💰 Biaya

- **Vercel Free Tier:**
  - 100GB bandwidth/bulan
  - Unlimited deployments
  - Serverless functions

- **Upstash Free Tier:**
  - 10,000 commands/hari
  - 256MB storage
  - Cukup untuk ~1000 chat/hari

- **Google Gemini API Free Tier:**
  - 15 requests/menit
  - 1500 requests/hari
  - **DENGAN CACHE = hemat ~70% quota!**

---

**Good luck! 🚀**
