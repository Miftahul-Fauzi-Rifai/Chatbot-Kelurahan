# 🚀 Setup Upstash Redis untuk Vercel (Cache System)

## Kenapa Butuh Redis di Vercel?

Vercel menggunakan serverless functions yang bisa running di multiple regions/instances. In-memory cache tidak persisten antar instance, jadi cache tidak efektif.

**Solusi:** Upstash Redis (gratis 10,000 requests/day)

---

## 📋 Langkah Setup Upstash Redis

### 1. Daftar Upstash (Gratis)

1. Buka: https://console.upstash.com
2. Sign up dengan GitHub (gratis)
3. Confirm email

### 2. Buat Redis Database

1. Dashboard → **Create Database**
2. Settings:
   - **Name**: `chatbot-kelurahan-cache`
   - **Type**: **Regional** (lebih cepat untuk Vercel)
   - **Region**: Pilih yang terdekat dengan Vercel region Anda
     - Jika Vercel auto: pilih **US East (Virginia)** atau **Singapore**
   - **Eviction**: **No Eviction** (cache akan expired otomatis berdasarkan TTL)
3. Click **Create**

### 3. Copy Credentials

Setelah database dibuat:

1. Tab **Details** → scroll ke **REST API**
2. Copy dua value ini:
   ```
   UPSTASH_REDIS_REST_URL=https://your-region.upstash.io
   UPSTASH_REDIS_REST_TOKEN=AXXXXxxxxxxx...
   ```

---

## 🔧 Konfigurasi di Vercel

### Opsi 1: Via Dashboard (Recommended)

1. Login ke [Vercel Dashboard](https://vercel.com/dashboard)
2. Pilih project: `chatbot-kelurahan`
3. Settings → **Environment Variables**
4. Add berikut (satu per satu):

| Name | Value | Environment |
|------|-------|-------------|
| `UPSTASH_REDIS_REST_URL` | `https://xxx.upstash.io` | Production, Preview |
| `UPSTASH_REDIS_REST_TOKEN` | `AXXXXxxxxxxx...` | Production, Preview |
| `CACHE_TTL_SEC` | `21600` | Production, Preview |
| `CACHE_PREFIX` | `v1` | Production, Preview |

5. Save
6. **Redeploy** project (Settings → Deployments → Redeploy)

### Opsi 2: Via CLI

```bash
vercel env add UPSTASH_REDIS_REST_URL
# Paste value: https://xxx.upstash.io

vercel env add UPSTASH_REDIS_REST_TOKEN
# Paste value: AXXXXxxxxxxx...

vercel env add CACHE_TTL_SEC
# Value: 21600

vercel env add CACHE_PREFIX
# Value: v1
```

---

## ✅ Verifikasi Setup

### 1. Lokal (Tanpa Redis - in-memory cache)

```bash
npm start
curl http://localhost:3000/api/cache/status
```

Expected:
```json
{
  "ok": true,
  "cache": {
    "mode": "memory",
    "size": 0,
    "ttlSec": 21600,
    "maxItems": 500,
    "prefix": "v1",
    "ttlHuman": "6h 0m"
  }
}
```

### 2. Production Vercel (Dengan Redis)

Deploy dulu:
```bash
vercel --prod
```

Test:
```bash
curl https://your-app.vercel.app/api/cache/status
```

Expected:
```json
{
  "ok": true,
  "cache": {
    "mode": "redis",
    "size": "N/A (Redis)",
    "ttlSec": 21600,
    "maxItems": 500,
    "prefix": "v1",
    "ttlHuman": "6h 0m"
  }
}
```

**✅ Jika `mode: "redis"` → Setup berhasil!**

---

## 🧪 Test Cache Berfungsi

### Test 1: Cache Miss (Pertanyaan Pertama)
```bash
curl -X POST https://your-app.vercel.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Opo kuwi SKCK?"}'
```

Response:
```json
{
  "ok": true,
  "model": "gemini-2.0-flash-exp",
  "output": { ... },
  "cached": false  // ← Tidak ada field ini = fresh dari Gemini
}
```

### Test 2: Cache Hit (Pertanyaan Sama - 5 detik kemudian)
```bash
curl -X POST https://your-app.vercel.app/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Opo kuwi SKCK?"}'
```

Response:
```json
{
  "ok": true,
  "model": "gemini-2.0-flash-exp",
  "output": { ... },
  "cached": true  // ← Dari cache! Tidak pakai kuota Gemini
}
```

**✅ Jika `cached: true` → Cache berfungsi!**

---

## 📊 Monitor Penggunaan Cache

### Via Upstash Dashboard
1. Login ke Upstash Console
2. Pilih database `chatbot-kelurahan-cache`
3. Tab **Metrics**:
   - Total Commands (requests)
   - Storage Used
   - Hit Rate

### Via API
```bash
curl https://your-app.vercel.app/api/cache/status
```

---

## 💰 Biaya & Limits (Free Tier)

| Metric | Free Tier | Pro ($10/month) |
|--------|-----------|-----------------|
| **Daily Requests** | 10,000 | 100,000 |
| **Max Storage** | 256 MB | 1 GB |
| **Max Connections** | 1,000 | 10,000 |
| **Data Size per Request** | 1 MB | 1 MB |

**Estimasi untuk chatbot:**
- 1 pertanyaan = 2 requests (1 get, 1 set)
- Free tier = ~5,000 pertanyaan/hari
- Jika cache hit rate 50% = ~10,000 pertanyaan/hari support

---

## 🔄 Update Cache Version (Bust Cache)

Jika Anda update data training atau logic:

1. Update `CACHE_PREFIX` di Vercel:
   ```
   CACHE_PREFIX=v2
   ```
2. Redeploy
3. Semua cache lama otomatis ignored (pakai prefix baru)

Atau, hapus manual via Upstash Console:
- Data Browser → Filter: `v1:*` → Delete All

---

## 🐛 Troubleshooting

### Cache tidak aktif (mode: "memory" di production)

**Penyebab:**
- Env variables tidak di-set di Vercel
- Salah copy URL/Token (ada spasi/enter)

**Solusi:**
1. Cek Vercel Settings → Environment Variables
2. Pastikan `UPSTASH_REDIS_REST_URL` dan `UPSTASH_REDIS_REST_TOKEN` ada
3. Redeploy: Settings → Deployments → Redeploy

### Error: "Redis connection failed"

**Penyebab:**
- Database Upstash belum dibuat
- Region mismatch (pilih regional, bukan global)

**Solusi:**
1. Cek Upstash Console → Database masih active?
2. Test manual:
   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" \
        https://YOUR_URL.upstash.io/ping
   ```
   Expected: `{"result":"PONG"}`

### Cache tidak pernah hit

**Penyebab:**
- Pertanyaan sedikit berbeda (spasi, kapitalisasi)
- TTL terlalu pendek

**Solusi:**
1. Cek normalisasi: `normalizeMessage()` sudah lowercase + trim
2. Naikkan TTL: `CACHE_TTL_SEC=43200` (12 jam)

---

## 🎯 Best Practices

1. **Gunakan Regional Database** (bukan Global)
   - Lebih cepat untuk Vercel serverless
   - Pilih region terdekat dengan mayoritas user

2. **Set TTL yang wajar**
   - Default: 6 jam (21600s)
   - Jika data jarang update: 24 jam (86400s)
   - Jika data sering update: 1 jam (3600s)

3. **Monitor usage**
   - Cek Upstash dashboard weekly
   - Jika mendekati limit → upgrade atau optimalkan query

4. **Version prefix**
   - Selalu gunakan `CACHE_PREFIX` (v1, v2, v3)
   - Mudah untuk bust cache saat update logic

---

**Setup selesai!** 🎉

Cache system Anda sekarang:
- ✅ Hemat kuota Gemini (hit rate ~50-70%)
- ✅ Response lebih cepat (cache: ~50ms vs API: ~2000ms)
- ✅ Skalabel (persisten di semua Vercel instances)
