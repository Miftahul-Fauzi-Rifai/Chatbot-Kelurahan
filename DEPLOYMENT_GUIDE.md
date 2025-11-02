# 🚀 Panduan Deployment Chatbot Kelurahan

Dokumentasi lengkap untuk deployment backend ke Render dan integrasi frontend ke web utama kelurahan.

---

## 📋 Arsitektur Sistem

```
┌─────────────────────────────────────┐
│  WEB UTAMA KELURAHAN (Laravel)      │
│  - Frontend Voice UI                │
│  - Web Speech API (Browser)         │
│  - Speech Recognition               │
│  - Text-to-Speech                   │
└──────────────┬──────────────────────┘
               │
               │ HTTPS Request
               │ POST /chat
               │
┌──────────────▼──────────────────────┐
│  BACKEND API (Render)               │
│  - Node.js + Express                │
│  - Gemini AI Integration            │
│  - RAG System (Semantic Search)     │
│  - Training Data (150 items)        │
└─────────────────────────────────────┘
```

---

## 🎯 BAGIAN 1: DEPLOYMENT BACKEND KE RENDER

### Step 1: Persiapan File

1. **Gunakan data yang sudah dioptimasi:**
   ```bash
   # Di folder kelurahan-chatbot-gemini
   cp data/train_optimized.json data/train.json
   ```

2. **Buat file `.gitignore` (jika belum ada):**
   ```
   node_modules/
   .env
   uploads/*
   !uploads/.gitkeep
   data/train_backup.json
   ```

3. **Update `package.json`:**
   ```json
   {
     "name": "chatbot-kelurahan-api",
     "version": "2.0.0",
     "description": "Backend API for Chatbot Kelurahan",
     "type": "module",
     "main": "server_production.js",
     "scripts": {
       "start": "node server_production.js",
       "dev": "node server_production.js"
     },
     "dependencies": {
       "@google/generative-ai": "^0.21.0",
       "axios": "^1.4.0",
       "dotenv": "^17.2.3",
       "express": "^4.18.2"
     },
     "engines": {
       "node": ">=18.0.0"
     }
   }
   ```

### Step 2: Setup Git Repository

```bash
cd kelurahan-chatbot-gemini

# Initialize git (jika belum)
git init

# Add semua file
git add .

# Commit
git commit -m "Initial commit - Production ready backend"

# Push ke GitHub (buat repository baru dulu di GitHub)
git remote add origin https://github.com/YOUR_USERNAME/chatbot-kelurahan-api.git
git branch -M main
git push -u origin main
```

### Step 3: Deploy ke Render

1. **Buka [Render Dashboard](https://dashboard.render.com/)**

2. **Create New Web Service:**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Pilih repository `chatbot-kelurahan-api`

3. **Configure Service:**
   ```
   Name: chatbot-kelurahan-api
   Region: Singapore (closest to Indonesia)
   Branch: main
   Runtime: Node
   Build Command: npm install
   Start Command: npm start
   Instance Type: Free
   ```

4. **Environment Variables:**
   Add the following environment variables:
   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.0-flash-exp
   PORT=3000
   NODE_ENV=production
   TRAIN_DATA_FILE=./data/train.json
   ```

5. **Deploy:**
   - Click "Create Web Service"
   - Wait ~5-10 minutes for deployment
   - You'll get URL: `https://chatbot-kelurahan-api.onrender.com`

### Step 4: Verify Deployment

Test endpoints:

```bash
# Health check
curl https://chatbot-kelurahan-api.onrender.com/health

# Status
curl https://chatbot-kelurahan-api.onrender.com/status

# Test chat
curl -X POST https://chatbot-kelurahan-api.onrender.com/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Bagaimana cara membuat KTP?"}'
```

---

## 🌐 BAGIAN 2: INTEGRASI FRONTEND KE WEB UTAMA KELURAHAN

### Option A: Integrasi ke Laravel (Recommended)

#### 1. Copy Frontend Files

Copy file `frontend/voice-ui.html` dan `frontend/voice-chatbot.js` ke folder Laravel:

```bash
# Ke Laravel project
cp kelurahan-chatbot-gemini/frontend/voice-ui.html public/chatbot.html
cp kelurahan-chatbot-gemini/frontend/voice-chatbot.js public/js/voice-chatbot.js
```

#### 2. Update API URL di `voice-chatbot.js`

Ubah line 7-8:

```javascript
const CONFIG = {
  apiUrl: localStorage.getItem('chatbot_api_url') || 'https://chatbot-kelurahan-api.onrender.com/chat',
  // ... rest of config
};
```

#### 3. Buat Laravel Route (Optional - jika ingin lewat route)

Di `routes/web.php`:

```php
Route::get('/chatbot', function () {
    return view('chatbot.voice-ui');
});
```

Lalu buat Blade view `resources/views/chatbot/voice-ui.blade.php`:

```blade
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="csrf-token" content="{{ csrf_token() }}">
  <title>Chatbot Kelurahan Marga Sari - Voice Assistant</title>
  
  <!-- Include CSS inline atau external -->
  <link rel="stylesheet" href="{{ asset('css/voice-chatbot.css') }}">
</head>
<body>
  <!-- Copy HTML content dari voice-ui.html -->
  <div class="container">
    <!-- ... content ... -->
  </div>
  
  <script src="{{ asset('js/voice-chatbot.js') }}"></script>
</body>
</html>
```

#### 4. Add Navigation Link

Di navbar Laravel, tambahkan link:

```blade
<a href="{{ url('/chatbot') }}" class="nav-link">
  🤖 Voice Chatbot
</a>
```

### Option B: Standalone HTML (Simple)

Jika ingin lebih simple, langsung akses:
```
https://yourdomain.com/chatbot.html
```

---

## 🔧 BAGIAN 3: KONFIGURASI & TESTING

### Konfigurasi Frontend

User bisa mengatur backend API URL di halaman chatbot:

1. Klik tombol "⚙️ Pengaturan"
2. Ubah "Backend API URL" menjadi: `https://chatbot-kelurahan-api.onrender.com/chat`
3. Pilih suara TTS yang diinginkan
4. Atur kecepatan bicara

Pengaturan akan tersimpan di `localStorage` browser.

### Testing Checklist

#### Backend Testing:

- [ ] Health endpoint: `GET /health` → status 200
- [ ] Status endpoint: `GET /status` → menampilkan info rate limit
- [ ] Chat endpoint: `POST /chat` → mengembalikan jawaban
- [ ] CORS working: Request dari domain lain berhasil
- [ ] Rate limiting: Max 10 request/minute
- [ ] Fallback model: Jika primary model gagal, gunakan fallback
- [ ] Local RAG: Jika semua model gagal, gunakan data lokal

#### Frontend Testing:

- [ ] Voice recognition berfungsi (Chrome/Edge/Safari)
- [ ] Speech synthesis berfungsi (membacakan jawaban)
- [ ] Komunikasi ke backend API berhasil
- [ ] Error handling proper (jika backend down)
- [ ] Settings tersimpan di localStorage
- [ ] Responsive di mobile

---

## 📊 MONITORING & MAINTENANCE

### Monitoring di Render

1. **Logs:** Dashboard → Your Service → Logs
2. **Metrics:** Dashboard → Your Service → Metrics
3. **Health Check:** Render otomatis ping `/health` tiap 5 menit

### Free Tier Limitations (Render)

⚠️ **PENTING - Render Free Tier:**
- Service akan **sleep** setelah 15 menit tidak ada request
- Cold start: ~30-60 detik untuk bangun dari sleep
- 750 hours/month free (cukup untuk 1 service 24/7)

**Solusi Cold Start:**
1. Setup cron job untuk ping `/health` tiap 10 menit:
   ```bash
   # Crontab di server lain atau gunakan service seperti cron-job.org
   */10 * * * * curl https://chatbot-kelurahan-api.onrender.com/health
   ```

2. Atau gunakan UptimeRobot (free) untuk monitoring + keep-alive

### Rate Limit Management

Backend sudah dilindungi rate limiter:
- **10 request/minute** (untuk protect Gemini API quota)
- Jika exceed, akan auto wait
- Monitor via `/status` endpoint

### Data Update

Jika ingin update training data:

1. Edit `data/train.json` di local
2. Commit & push ke GitHub:
   ```bash
   git add data/train.json
   git commit -m "Update training data"
   git push
   ```
3. Render akan auto-deploy (jika auto-deploy enabled)
4. Atau manual deploy di Render Dashboard → Deploy → "Deploy latest commit"

---

## 🔐 KEAMANAN

### Environment Variables (PENTING!)

**JANGAN COMMIT `.env` FILE KE GIT!**

Pastikan `.gitignore` contains:
```
.env
*.env
.env.*
```

### CORS Policy

Backend sudah set `Access-Control-Allow-Origin: *` untuk kemudahan.

Jika ingin restrict hanya ke domain tertentu, update di `server_production.js`:

```javascript
// Ganti baris ini:
res.setHeader('Access-Control-Allow-Origin', '*');

// Dengan:
const allowedOrigins = ['https://yourdomain.com', 'https://www.yourdomain.com'];
const origin = req.headers.origin;
if (allowedOrigins.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
}
```

### API Key Protection

- API Key hanya di backend (aman)
- Frontend tidak butuh API Key
- Semua request ke Gemini melalui backend

---

## 🐛 TROUBLESHOOTING

### Backend Issues

**Problem:** Service sleep di Render
**Solution:** Setup keep-alive ping (lihat Monitoring section)

**Problem:** CORS error di frontend
**Solution:** Pastikan backend URL benar dan CORS header sudah set

**Problem:** Quota exceeded error
**Solution:** Rate limiter akan auto handle, atau upgrade Gemini API tier

### Frontend Issues

**Problem:** Speech recognition tidak jalan
**Solution:** 
- Gunakan Chrome/Edge/Safari (Firefox not fully supported)
- Pastikan HTTPS (mic access requires HTTPS)
- Check browser permissions

**Problem:** Text-to-speech tidak ada suara
**Solution:**
- Check volume browser/device
- Pilih voice lain di settings
- Pastikan browser support TTS

**Problem:** Backend unreachable
**Solution:**
- Check backend URL di settings
- Pastikan backend masih running di Render
- Check network/firewall

---

## 📞 SUPPORT & RESOURCES

### Useful Links

- **Render Docs:** https://render.com/docs
- **Gemini API Docs:** https://ai.google.dev/docs
- **Web Speech API:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API

### Upgrade Path

Untuk production dengan traffic tinggi:

1. **Render Paid Plan** ($7/month):
   - No sleep
   - Faster cold starts
   - More resources

2. **Gemini API Paid Tier**:
   - Higher quota
   - Faster response
   - Priority access

3. **Database Integration**:
   - MongoDB/PostgreSQL untuk chat logs
   - Redis untuk caching

---

## 🎉 KESIMPULAN

Sistem chatbot sudah siap untuk production:

✅ Backend terpisah di Render (scalable)
✅ Frontend ringan di web utama (Voice UI)
✅ Data optimized (150 items, 77% reduction)
✅ Multi-model fallback (3 layers + local RAG)
✅ CORS-friendly (bisa diakses dari domain manapun)
✅ Production-ready dengan monitoring

**Total Setup Time:** ~30 menit
**Cost:** $0 (menggunakan free tier)

Selamat menggunakan! 🚀
