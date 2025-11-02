# 📝 QUICK START GUIDE

Panduan cepat untuk mulai menggunakan Chatbot Kelurahan Voice Assistant.

---

## ⚡ 5 Menit Setup

### Prerequisites
- Node.js v18+ installed
- Gemini API Key (free dari Google AI Studio)
- Browser modern (Chrome/Edge/Safari)

### Step 1: Clone & Install (2 menit)

```bash
cd kelurahan-chatbot-gemini
npm install
```

### Step 2: Configure (1 menit)

```bash
# Copy .env template
cp .env.example .env

# Edit .env dan isi API key
# Windows: notepad .env
# Linux/Mac: nano .env
```

Isi dengan:
```env
GEMINI_API_KEY=your_actual_api_key_here
GEMINI_MODEL=gemini-2.0-flash-exp
PORT=3000
NODE_ENV=development
TRAIN_DATA_FILE=./data/train.json
```

### Step 3: Start Backend (1 menit)

```bash
npm start
```

Output:
```
🚀 Chatbot Kelurahan API Server
📡 Server running on port 3000
📊 Training data: 150 items
🔑 API Key: Configured ✓
```

### Step 4: Test Frontend (1 menit)

Buka file `frontend/voice-ui.html` di browser atau:

```bash
# Windows
start frontend/voice-ui.html

# Linux
xdg-open frontend/voice-ui.html

# Mac
open frontend/voice-ui.html
```

### Step 5: Try Voice Chat! 🎤

1. Klik tombol mikrofon 🎤
2. Izinkan akses mikrofon
3. Bicara: **"Bagaimana cara membuat KTP?"**
4. Dengarkan jawabannya! 🔊

---

## 🎯 Testing Endpoints

### Test dengan PowerShell (Windows):

```powershell
# Health check
Invoke-RestMethod -Uri "http://localhost:3000/health"

# Status
Invoke-RestMethod -Uri "http://localhost:3000/status"

# Chat
$body = @{
    message = "Bagaimana cara membuat KTP?"
    history = @()
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/chat" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body
```

### Test dengan Curl (Linux/Mac):

```bash
# Health check
curl http://localhost:3000/health

# Status
curl http://localhost:3000/status

# Chat
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Bagaimana cara membuat KTP?"}'
```

---

## 🚀 Deploy to Production

### Backend → Render.com

1. **Create GitHub Repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/chatbot-kelurahan.git
   git push -u origin main
   ```

2. **Deploy di Render**
   - Go to https://dashboard.render.com
   - New → Web Service
   - Connect GitHub repo
   - Settings:
     ```
     Name: chatbot-kelurahan-api
     Runtime: Node
     Build Command: npm install
     Start Command: npm start
     ```
   - Environment Variables:
     ```
     GEMINI_API_KEY=your_api_key
     NODE_ENV=production
     TRAIN_DATA_FILE=./data/train.json
     ```
   - Deploy!

3. **Get Your API URL**
   ```
   https://chatbot-kelurahan-api.onrender.com
   ```

### Frontend → Laravel Web

1. **Copy Files**
   ```bash
   cp frontend/voice-ui.html public/chatbot.html
   cp frontend/voice-chatbot.js public/js/
   ```

2. **Update API URL**
   
   Edit `public/js/voice-chatbot.js` line 7:
   ```javascript
   apiUrl: 'https://chatbot-kelurahan-api.onrender.com/chat'
   ```

3. **Access**
   ```
   https://yourdomain.com/chatbot.html
   ```

---

## 🎨 Customization

### Ganti Warna Theme

Edit `frontend/voice-ui.html` CSS:

```css
/* Gradient background */
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);

/* Ubah jadi: */
background: linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%);
```

### Tambah Logo Kelurahan

Di `frontend/voice-ui.html` dalam `<div class="header">`:

```html
<img src="/images/logo-kelurahan.png" alt="Logo" style="width: 80px; margin-bottom: 10px;">
<h1>🏛️ Chatbot Kelurahan Marga Sari</h1>
```

### Ganti Voice (Suara)

Di halaman chatbot:
1. Klik ⚙️ Pengaturan
2. Pilih "Suara TTS" → pilih voice Indonesia
3. Atur kecepatan bicara sesuai selera

---

## 📊 Data Management

### Update Training Data

1. Edit `data/train.json`
2. Tambah entry baru:
   ```json
   {
     "id": "999",
     "text": "Pertanyaan baru?",
     "answer": "Jawaban baru...",
     "kategori_utama": "Kependudukan",
     "tags": ["keyword1", "keyword2"]
   }
   ```

3. Restart server
   ```bash
   # Stop: Ctrl+C
   npm start
   ```

### Re-optimize Data

Jika data sudah banyak:

```bash
node optimize_data.js
cp data/train_optimized.json data/train.json
```

---

## 🐛 Common Issues

### Issue: Mikrofon tidak jalan

**Solution:**
- Pastikan HTTPS (Chrome requires secure context)
- Check browser permissions
- Try Chrome/Edge (Firefox limited support)

### Issue: Backend error 500

**Solution:**
- Check `GEMINI_API_KEY` di `.env`
- Verify API key valid
- Check quota di https://aistudio.google.com

### Issue: CORS error

**Solution:**
- Backend sudah set `Access-Control-Allow-Origin: *`
- Pastikan URL backend benar di frontend
- Check network tab di browser DevTools

### Issue: Render service sleep

**Solution:**
- Free tier sleeps after 15 min idle
- Setup cron ping: https://cron-job.org
- Ping `/health` every 10 minutes

---

## 📱 Mobile Support

Voice UI sudah responsive! Test di:
- ✅ Android Chrome
- ✅ iPhone Safari
- ✅ Tablet

Note: Speech Recognition di mobile butuh internet connection.

---

## 🎓 Learn More

- **Full Documentation:** [README.md](./README.md)
- **Deployment Guide:** [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- **Gemini API Docs:** https://ai.google.dev/docs
- **Web Speech API:** https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API

---

## 💬 Support

Butuh bantuan? Contact:

- **GitHub Issues:** (create issue di repo)
- **Email:** support@kelurahanmargasari.go.id
- **Phone:** (0542) xxx-xxxx

---

## ✅ Checklist Deployment

- [ ] Backend tested locally (port 3000)
- [ ] Frontend tested locally
- [ ] Voice recognition works
- [ ] Text-to-speech works
- [ ] GitHub repo created
- [ ] Render deployment success
- [ ] Environment variables set
- [ ] API URL updated in frontend
- [ ] Frontend deployed to web kelurahan
- [ ] End-to-end test production

---

**Happy Coding! 🚀**

*Updated: November 2025*
