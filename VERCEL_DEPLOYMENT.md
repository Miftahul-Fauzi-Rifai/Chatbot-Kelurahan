# 🚀 Deploy ke Vercel - Panduan Lengkap

## ✅ Persiapan Sebelum Deploy

### 1. Checklist File

Pastikan file-file ini ada:
- [x] `server_production.js` (dengan cache system)
- [x] `utils/cache.js` (cache utility)
- [x] `api/index.js` (Vercel wrapper)
- [x] `vercel.json` (config Vercel)
- [x] `data/embedded_docs.json` (hasil RAG index)
- [x] `package.json` (dengan @upstash/redis)

### 2. Build RAG Index (WAJIB!)

```bash
npm run rag:index
```

Tunggu sampai selesai (~2-5 menit). File `data/embedded_docs.json` harus terbuat.

### 3. Test Lokal Dulu

```bash
npm start
```

Test endpoints:
```bash
# Health check
curl http://localhost:3000/health

# Cache status
curl http://localhost:3000/api/cache/status

# Chat test
curl -X POST http://localhost:3000/chat -H "Content-Type: application/json" -d "{\"message\":\"Opo kuwi SKCK?\"}"
```

Expected: Server berjalan tanpa error.

---

## 📦 Deploy ke Vercel

### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

### Step 2: Login

```bash
vercel login
```

Browser akan terbuka untuk login dengan GitHub.

### Step 3: Setup Upstash Redis (untuk cache)

**PENTING!** Tanpa Redis, cache tidak efektif di Vercel (serverless).

1. Buka: https://console.upstash.com
2. Sign up gratis dengan GitHub
3. Create Database:
   - Name: `chatbot-kelurahan-cache`
   - Type: **Regional**
   - Region: **US East (Virginia)** atau **Singapore**
   - Click Create

4. Copy credentials di tab **Details → REST API**:
   ```
   UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN=AXXXXxxxxxxxx
   ```

Simpan dulu, akan dipakai nanti.

### Step 4: Deploy

Di folder project:

```bash
cd "d:\Develop Web Laravel\Chatbot-gemini\kelurahan-chatbot-gemini"
vercel
```

Jawab pertanyaan:
```
? Set up and deploy "kelurahan-chatbot-gemini"? Y
? Which scope? (pilih account Anda)
? Link to existing project? N
? What's your project's name? chatbot-kelurahan
? In which directory is your code located? ./
```

Vercel akan:
1. Upload files
2. Build project (`npm install && npm run rag:index`)
3. Deploy

Tunggu sampai selesai (~3-5 menit).

Output:
```
✅ Production: https://chatbot-kelurahan-xxxxx.vercel.app
```

### Step 5: Set Environment Variables

**Opsi A: Via Dashboard (Recommended)**

1. Buka: https://vercel.com/dashboard
2. Pilih project: `chatbot-kelurahan`
3. Settings → Environment Variables
4. Add satu per satu:

| Name | Value | Environments |
|------|-------|--------------|
| `GEMINI_API_KEY` | `AIzaSy...` (API key Anda) | Production, Preview |
| `UPSTASH_REDIS_REST_URL` | `https://xxxxx.upstash.io` | Production, Preview |
| `UPSTASH_REDIS_REST_TOKEN` | `AXXXXxxxxxxxx` | Production, Preview |
| `NODE_ENV` | `production` | Production |
| `CACHE_TTL_SEC` | `21600` | Production, Preview |
| `CACHE_PREFIX` | `v1` | Production, Preview |

5. Save
6. **Redeploy**: Settings → Deployments → ... (kebab menu) → Redeploy

**Opsi B: Via CLI**

```bash
vercel env add GEMINI_API_KEY
# Paste API key: AIzaSy...

vercel env add UPSTASH_REDIS_REST_URL
# Paste: https://xxxxx.upstash.io

vercel env add UPSTASH_REDIS_REST_TOKEN
# Paste: AXXXXxxxxxxxx

vercel env add NODE_ENV
# Value: production

vercel env add CACHE_TTL_SEC
# Value: 21600

vercel env add CACHE_PREFIX
# Value: v1
```

Lalu redeploy:
```bash
vercel --prod
```

---

## ✅ Verifikasi Deployment

### 1. Health Check

```bash
curl https://chatbot-kelurahan-xxxxx.vercel.app/health
```

Expected:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-09T...",
  "checks": {
    "api_key": "OK",
    "training_data": "OK (150 items)",
    "memory": "52MB"
  }
}
```

### 2. Cache Status (PENTING!)

```bash
curl https://chatbot-kelurahan-xxxxx.vercel.app/api/cache/status
```

Expected:
```json
{
  "ok": true,
  "cache": {
    "mode": "redis",  // ← HARUS "redis", bukan "memory"
    "size": "N/A (Redis)",
    "ttlSec": 21600,
    "ttlHuman": "6h 0m"
  }
}
```

**✅ Jika `mode: "redis"` → Setup berhasil!**  
**❌ Jika `mode: "memory"` → Redis env belum di-set, ulangi Step 5**

### 3. Test Chat

```bash
curl -X POST https://chatbot-kelurahan-xxxxx.vercel.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Opo kuwi SKCK?"}'
```

Expected: Jawaban dalam Bahasa Indonesia.

### 4. Test Cache Hit

Jalankan command yang sama lagi (5 detik kemudian):

```bash
curl -X POST https://chatbot-kelurahan-xxxxx.vercel.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Opo kuwi SKCK?"}'
```

Expected: Response dengan field `"cached": true` (lebih cepat, tidak pakai kuota Gemini).

---

## 📊 Monitoring

### Vercel Logs

1. Dashboard → chatbot-kelurahan → Deployments
2. Click deployment terakhir → **Logs**
3. Monitor:
   - `✅ [CACHE HIT]` → Cache berfungsi
   - `💾 [CACHE SET]` → Data di-cache
   - `✅ Success with model` → Gemini API OK

### Upstash Metrics

1. Login: https://console.upstash.com
2. Pilih database: `chatbot-kelurahan-cache`
3. Tab **Metrics**:
   - Total Commands/day
   - Storage Used
   - Hit Rate

### Cache Performance

```bash
# Cek berapa kali cache hit vs miss
curl https://chatbot-kelurahan-xxxxx.vercel.app/api/cache/status
```

Pantau `size` (jika pakai memory) atau check Upstash dashboard.

---

## 🔧 Troubleshooting

### Build Failed: "embedded_docs.json not found"

**Penyebab:** RAG index belum dibuild atau tidak di-commit.

**Solusi:**
```bash
npm run rag:index
git add data/embedded_docs.json
git commit -m "Add embedded docs"
git push origin main
```

Lalu redeploy di Vercel.

### Cache tidak aktif (mode: "memory")

**Penyebab:** Upstash Redis env tidak di-set.

**Solusi:**
1. Cek Vercel Settings → Environment Variables
2. Pastikan `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN` ada
3. Redeploy

### Error 500: "GEMINI_API_KEY not configured"

**Penyebab:** API key belum di-set di Vercel.

**Solusi:**
1. Vercel Settings → Environment Variables
2. Add `GEMINI_API_KEY` dengan value API key Anda
3. Redeploy

### Timeout Error (Function Execution)

**Penyebab:** Vercel free tier limit 10s execution time.

**Solusi:**
1. Upgrade ke Vercel Pro ($20/bulan) → 60s limit
2. Atau gunakan Render (unlimited execution time)

### File size > 50MB

**Penyebab:** `embedded_docs.json` terlalu besar.

**Solusi:**
1. Edit `rag_index.js`, kurangi max docs jadi 300:
   ```javascript
   if (allData.length > 300) {
     allData = allData.slice(0, 300);
   }
   ```
2. Rebuild: `npm run rag:index`
3. Redeploy

---

## 🎯 Next Steps

### 1. Custom Domain (Opsional)

1. Vercel Dashboard → chatbot-kelurahan → Settings → Domains
2. Add domain: `chat.yourdomain.com`
3. Update DNS sesuai instruksi Vercel
4. Tunggu DNS propagation (~5-10 menit)

### 2. Analytics (Opsional)

Tambah analytics di frontend:
- Google Analytics
- Vercel Analytics (built-in)
- Mixpanel

### 3. Rate Limiting (Production)

Tambah rate limit untuk prevent abuse:
- Vercel Edge Middleware
- Upstash Rate Limit (gratis)

### 4. Monitoring Alert

Setup alert untuk:
- Upstash quota mendekati limit
- Gemini quota habis
- Error rate tinggi

---

## 💰 Estimasi Biaya

### Gratis (Free Tier)

| Service | Limit | Cost |
|---------|-------|------|
| Vercel | 100GB bandwidth/month | $0 |
| Upstash Redis | 10,000 req/day | $0 |
| Gemini API | 15 req/min, 1,500 req/day | $0 |

**Total: $0/bulan** untuk ~5,000 pertanyaan/hari (dengan cache hit rate 50%)

### Upgrade (Jika Traffic Tinggi)

| Service | Plan | Cost |
|---------|------|------|
| Vercel | Pro | $20/bulan |
| Upstash Redis | Pay as you go | ~$10/bulan (100K req/day) |
| Gemini API | Free tier cukup | $0 |

**Total: ~$30/bulan** untuk ~50,000 pertanyaan/hari

---

## 📚 Dokumentasi Lengkap

- `PRODUCTION_READY.md` - Panduan deployment umum
- `UPSTASH_REDIS_SETUP.md` - Setup cache Redis detail
- `CHECKLIST_UPDATE.md` - Checklist pembaruan fitur

---

**Deploy selesai!** 🎉

URL Production: `https://chatbot-kelurahan-xxxxx.vercel.app`

Test sekarang:
```bash
curl https://chatbot-kelurahan-xxxxx.vercel.app/health
```
