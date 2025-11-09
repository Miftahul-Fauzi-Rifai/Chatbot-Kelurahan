# Quick Start Script untuk Windows PowerShell
# Chatbot Kelurahan - Production Ready

Write-Host "🚀 Chatbot Kelurahan - Quick Start" -ForegroundColor Cyan
Write-Host "=================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "✓ Checking Node.js..." -ForegroundColor Yellow
node --version
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Node.js tidak ditemukan! Install dari https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Check npm
Write-Host "✓ Checking npm..." -ForegroundColor Yellow
npm --version

# Install dependencies
Write-Host ""
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
npm install

# Check .env file
Write-Host ""
Write-Host "✓ Checking .env file..." -ForegroundColor Yellow
if (-Not (Test-Path ".env")) {
    Write-Host "⚠️  .env file tidak ditemukan!" -ForegroundColor Red
    Write-Host "   Copy .env.example ke .env dan isi GEMINI_API_KEY" -ForegroundColor Yellow
    Copy-Item ".env.example" -Destination ".env"
    Write-Host "   ✓ File .env dibuat dari .env.example" -ForegroundColor Green
    Write-Host "   ⚠️  EDIT .env dan isi GEMINI_API_KEY sebelum lanjut!" -ForegroundColor Red
    Write-Host ""
    Read-Host "Tekan Enter setelah edit .env"
}

# Build RAG Index
Write-Host ""
Write-Host "🔨 Building RAG Index..." -ForegroundColor Yellow
Write-Host "   (Ini akan memakan waktu 2-5 menit tergantung jumlah data)" -ForegroundColor Gray
npm run rag:index

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ RAG Index build gagal!" -ForegroundColor Red
    Write-Host "   Pastikan GEMINI_API_KEY valid di .env" -ForegroundColor Yellow
    exit 1
}

# Check embedded_docs.json
Write-Host ""
Write-Host "✓ Checking embedded_docs.json..." -ForegroundColor Yellow
if (Test-Path "data\embedded_docs.json") {
    $fileSize = (Get-Item "data\embedded_docs.json").Length / 1MB
    Write-Host "   ✓ File size: $([math]::Round($fileSize, 2)) MB" -ForegroundColor Green
    
    if ($fileSize -gt 50) {
        Write-Host "   ⚠️  Warning: File > 50MB, mungkin terlalu besar untuk Vercel" -ForegroundColor Yellow
        Write-Host "   Pertimbangkan kurangi data di rag_index.js (batasi < 300 docs)" -ForegroundColor Yellow
    }
} else {
    Write-Host "   ❌ embedded_docs.json tidak ditemukan!" -ForegroundColor Red
    exit 1
}

# Ready!
Write-Host ""
Write-Host "=================================" -ForegroundColor Green
Write-Host "✅ SETUP SELESAI!" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Next steps:" -ForegroundColor Cyan
Write-Host "   1. Test lokal:  npm start" -ForegroundColor White
Write-Host "   2. Test dev:    npm run dev" -ForegroundColor White
Write-Host "   3. Deploy:      git push origin main (lalu deploy di Render)" -ForegroundColor White
Write-Host ""
Write-Host "🌐 Endpoints:" -ForegroundColor Cyan
Write-Host "   - http://localhost:3000/health" -ForegroundColor White
Write-Host "   - http://localhost:3000/status" -ForegroundColor White
Write-Host "   - http://localhost:3000/api/rag/status" -ForegroundColor White
Write-Host "   - POST http://localhost:3000/chat" -ForegroundColor White
Write-Host ""

# Ask to start server
$answer = Read-Host "Jalankan server sekarang? (y/n)"
if ($answer -eq "y" -or $answer -eq "Y") {
    Write-Host ""
    Write-Host "🚀 Starting server..." -ForegroundColor Green
    npm start
}
