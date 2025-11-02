/**
 * [PENYEMPURNAAN]
 * Variabel untuk menyimpan riwayat percakapan (format API Gemini)
 */
let chatHistory = [];

/**
 * [PENYEMPURNAAN]
 * Fungsi append sekarang bisa menerima ID unik untuk elemen
 */
async function append(who, txt, id = null){
  const d = document.createElement('div');
  d.className='msg';
  if (id) d.id = id; // Tambahkan ID jika ada

  // Membersihkan HTML (basic security)
  const safeTxt = txt.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  d.innerHTML = `<div class="meta">${who}</div><div>${
    // Jika dari bot, render sebagai pre-wrap. Jika 'sedang berpikir', biarkan HTML
    (who === 'Bot' && txt.startsWith('<i>')) ? txt : `<pre style="white-space:pre-wrap;">${safeTxt}</pre>`
  }</div>`;

  document.getElementById('chat').appendChild(d);
  document.getElementById('chat').scrollTop = document.getElementById('chat').scrollHeight;
}

document.getElementById('f').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const m = document.getElementById('m').value;
  if(!m) return;

  append('Anda', m);
  document.getElementById('m').value='';

  const thinkingId = 'msg-' + Date.now();
  append('Bot', '<i>Sedang berpikir...</i>', thinkingId); // Perbaiki variabel id

  chatHistory.push({
    role: "user",
    parts: [{ text: m }]
  });

  // --- [AWAL BLOK YANG DIGANTI] ---
  try { // Tambahkan try...catch di sini
    const res = await fetch('/api/chat', {
      method:'POST', 
      headers:{'Content-Type':'application/json'}, 
      body: JSON.stringify({ message: m, history: chatHistory }) 
    });

    const thinkingMsg = document.getElementById(thinkingId);
    if (thinkingMsg) thinkingMsg.remove();

    const j = await res.json();
    let botResponse = '';

    // --- [LOGGING DIAGNOSTIK] ---
    console.log("Menerima dari server:", JSON.stringify(j, null, 2)); 
    // -----------------------------

    // --- [PENANGANAN ERROR LEBIH BAIK] ---
    if(j.ok && j.output && j.output.candidates && j.output.candidates.length > 0 && j.output.candidates[0].content && j.output.candidates[0].content.parts && j.output.candidates[0].content.parts.length > 0) {
      // Jawaban normal
      botResponse = j.output.candidates[0].content.parts[0].text;
      append('Bot', botResponse);
    } else {
      // Kemungkinan diblokir atau error lain
      console.error("Gagal parse jawaban bot atau Gemini mengembalikan error/blok.");
      if (j.ok && j.output && j.output.candidates && j.output.candidates.length > 0 && j.output.candidates[0].finishReason === 'SAFETY') {
         // Secara spesifik diblokir karena SAFETY
         const blockReason = j.output.promptFeedback?.blockReason || 'Tidak diketahui (cek safety setting)';
         botResponse = `Maaf, respons diblokir karena alasan keamanan: ${blockReason}`;
         console.error("Detail respons Gemini:", JSON.stringify(j.output, null, 2));
      } else if (!j.ok) {
         // Error dari catch block di server.js
         botResponse = 'Error Server: ' + (j.error || JSON.stringify(j.detail || 'Error server tidak diketahui'));
      } else {
         // Struktur respons tidak terduga
         botResponse = 'Error: Respons tidak terduga dari server.';
         console.error("Struktur respons server tidak terduga:", JSON.stringify(j, null, 2));
      }
      append('Bot', botResponse); // Tampilkan pesan error spesifik
    }
    // --- [AKHIR PENANGANAN ERROR] ---

    chatHistory.push({
      role: "model",
      parts: [{ text: botResponse }]
    });

  } catch (fetchError) { // Tangani jika fetch itu sendiri gagal
    console.error("Fetch error:", fetchError);
    const thinkingMsg = document.getElementById(thinkingId);
    if (thinkingMsg) thinkingMsg.remove();
    append('Bot', `Error koneksi ke server: ${fetchError.message}`);
  }
  // --- [AKHIR BLOK YANG DIGANTI] ---
});


document.getElementById('up').addEventListener('click', async ()=>{
  const f = document.getElementById('file').files[0];
  if(!f) return alert('Pilih file JSON');
  const form = new FormData();
  form.append('file', f);
  const res = await fetch('/api/train', { method:'POST', body: form });
  const j = await res.json();
  alert(JSON.stringify(j));
});

/**
 * [PENYEMPURNAAN]
 * Tombol untuk membersihkan chat
 */
document.getElementById('clear').addEventListener('click', () => {
  document.getElementById('chat').innerHTML = '';
  chatHistory = [];
  append('Bot', 'Riwayat percakapan telah dibersihkan.');
});