/* app.js
   - EQ + visualizer (safe stop)
   - Playlist minimal UI (P1)
   - A2: Auto-fallback scraping via CORS proxies (allorigins & r.jina.ai)
   - Minimal status box (S1)
   - Export/import .eqpl (metadata-only, password auto-generated & embedded)
*/

/* ------------------- Audio EQ (existing) ------------------- */
let audioCtx;
let audioBuffer;
let source = null;
let analyser;
let dataArray;
let bufferLength;
let eqNodes = [];
const eqFrequencies = [60, 170, 350, 1000, 3500];

const audioFileInput = document.getElementById('audioFile');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');
const eqStatus = document.getElementById('eqStatus');

/* ----- SAFE STOP ----- */
function stopSource() {
  if (source) {
    try {
      source.stop();
    } catch (err) {
      // ignore
    }
    source = null;
  }
}

/* ----- setupAudioGraph ----- */
function setupAudioGraph() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;

  eqNodes = eqFrequencies.map(freq => {
    const f = audioCtx.createBiquadFilter();
    f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = 1;
    f.gain.value = 0;
    return f;
  });

  source.connect(eqNodes[0]);
  for (let i = 0; i < eqNodes.length - 1; i++) eqNodes[i].connect(eqNodes[i+1]);

  analyser = audioCtx.createAnalyser();
  eqNodes[eqNodes.length - 1].connect(analyser);
  analyser.connect(audioCtx.destination);
  analyser.fftSize = 256;
  bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);

  eqNodes.forEach((node, i) => {
    const slider = document.getElementById(`eq${i}`);
    if (slider) slider.oninput = () => {
      node.gain.value = parseFloat(slider.value);
      eqStatus.textContent = `EQ: ${eqFrequencies.map((f,i)=>`${f}Hz:${Math.round(eqNodes[i].gain.value)}dB`).join(' | ')}`;
    };
  });
}

/* ----- PLAY / PAUSE ----- */
playBtn.addEventListener('click', () => {
  if (!audioBuffer) {
    alert('No audio loaded. Upload a local file or select a playable track from the playlist.');
    return;
  }
  stopSource();
  setupAudioGraph();
  source.start();
  drawVisualizer();
});

pauseBtn.addEventListener('click', () => {
  stopSource();
});

/* ----- LOAD local file for immediate play & session storage ----- */
let lastUploadedBlob = null;
audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const ab = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(ab);
  lastUploadedBlob = file;
  eqStatus.textContent = `Loaded local: ${file.name}`;
});

/* ----- VISUALIZER ----- */
let raf = null;
function drawVisualizer() {
  if (!analyser) return;
  if (raf) cancelAnimationFrame(raf);
  function loop() {
    raf = requestAnimationFrame(loop);
    analyser.getByteFrequencyData(dataArray);
    ctx.fillStyle = '#121212';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    if (!bufferLength) return;
    const barWidth = (canvas.width / bufferLength) * 2.5;
    let x = 0;
    for (let i=0;i<bufferLength;i++){
      const h = dataArray[i];
      ctx.fillStyle = `rgb(${Math.min(h+100,255)}, ${200 + Math.floor(h/6)}, 200)`;
      ctx.fillRect(x, canvas.height - h, barWidth, h);
      x += barWidth + 1;
    }
  }
  loop();
}

/* ------------------- Playlist (P1 minimal) ------------------- */
const PL_KEY = 'day02_eq_playlist_v1';
let playlist = []; // {id, type:'local'|'youtube'|'fetched', title, filename, url, fetchedFrom, addedAt}
const inMemoryLocalBlobs = new Map(); // id -> Blob

// DOM
const ytUrlEl = document.getElementById('ytUrl');
const convertAddBtn = document.getElementById('convertAddBtn');
const addMetaBtn = document.getElementById('addMetaBtn');
const addLocalToListBtn = document.getElementById('addLocalToListBtn');
const playlistEl = document.getElementById('playlist');
const plStatus = document.getElementById('plStatus');
const ytStatus = document.getElementById('ytStatus');
const exportPlBtn = document.getElementById('exportPlBtn');
const importPlInput = document.getElementById('importPlInput');

function uid(prefix='id'){ return `${prefix}_${Math.random().toString(36).slice(2,9)}`; }
function nowISO(){ return new Date().toISOString(); }

function loadPlaylist(){
  try{
    const raw = localStorage.getItem(PL_KEY);
    playlist = raw ? JSON.parse(raw) : [];
  }catch(e){ playlist = []; console.error(e); }
}
function savePlaylist(){ localStorage.setItem(PL_KEY, JSON.stringify(playlist)); }

/* ------------------- A2 Auto-fallback scrapers + proxies ------------------- */
/* We use two CORS proxies (allorigins and r.jina.ai/http://) and a list of converter endpoints.
   For each converter+proxy pair we fetch raw HTML/text and attempt to extract .mp3 URLs using heuristics.
*/

const PROXIES = [
  (u)=>`https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u)=>`https://r.jina.ai/http://${u.replace(/^https?:\/\//,'')}`
];

// Converter target builders (common converters). These may change; fallbacks exist.
const CONVERTER_PAGE_BUILDERS = [
  { name:'y2mate_ajax', build: (yt)=>`https://www.y2mate.com/en68/analyze/ajax?url=${encodeURIComponent(yt)}` },
  { name:'ytmp3_convert', build: (yt)=>`https://ytmp3.cc/en13/convert/?url=${encodeURIComponent(yt)}` },
  { name:'loader_to_api', build: (yt)=>`https://loader.to/api/convert?url=${encodeURIComponent(yt)}&format=mp3` },
  { name:'mp3fy', build: (yt)=>`https://mp3fy.com/?url=${encodeURIComponent(yt)}` },
  { name:'savemp3', build: (yt)=>`https://savemp3.org/?url=${encodeURIComponent(yt)}` }
];

// parse heuristics (same as earlier)
function parseMp3FromHtml(html) {
  if (!html) return null;
  const re = /(?:href|src)=["']([^"']+?\.mp3(?:\?[^"']*)?)["']/ig;
  let m;
  while((m = re.exec(html))!==null) return m[1];
  const re2 = /(https?:\/\/[^\s"'<>]+?\.mp3(?:\?[^"'\s<>]*)?)/ig;
  const m2 = re2.exec(html);
  if (m2) return m2[1];
  const re3 = /href=["']([^"']+?(?:download)[^"']*)["']/ig;
  const m3 = re3.exec(html);
  if (m3) return m3[1];
  const re4 = /data-(?:href|download)=["']([^"']+)["']/ig;
  const m4 = re4.exec(html);
  if (m4) return m4[1];
  return null;
}
function parseTitleFromHtml(html) {
  if (!html) return null;
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (m) return decodeEntities(m[1].trim());
  const m2 = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) || html.match(/<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i);
  if (m2) return decodeEntities(m2[1].trim());
  return null;
}
function decodeEntities(s){ return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"); }

// Try converters with proxies
async function tryConvertYouTubeToMp3(youtubeUrl, updateStatus) {
  updateStatus = updateStatus || (()=>{});
  for (const conv of CONVERTER_PAGE_BUILDERS) {
    for (const proxy of PROXIES) {
      try {
        updateStatus(`Fetching ${conv.name} via proxy...`);
        const pageUrl = conv.build(youtubeUrl);
        const proxied = proxy(pageUrl);
        // We cannot set restricted headers like User-Agent in browsers, so use allowed headers only.
        const resp = await fetch(proxied, { method:'GET', headers:{ 'Accept-Language':'en-US,en;q=0.9','Referer':'https://www.google.com/' } });
        if (!resp.ok) {
          updateStatus(`${conv.name} proxy returned ${resp.status} — trying next`);
          continue;
        }
        const text = await resp.text();
        // try JSON first
        try {
          const j = JSON.parse(text);
          const candidate = j.mp3 || j.download || j.url || j.result || j.link || null;
          if (candidate && candidate.match(/\.mp3($|\?)/i)) return { mp3Url: candidate, title: j.title || j.name || null, source: conv.name };
          // deep search in JSON
          const found = findMp3InJson(j);
          if (found) return { mp3Url: found, title: j.title || null, source: conv.name };
        } catch(_) {}
        // HTML parse heuristics
        const mp3 = parseMp3FromHtml(text);
        if (mp3) {
          const title = parseTitleFromHtml(text) || youtubeUrl;
          // resolve relative links
          const resolved = resolveUrl(mp3, pageUrl);
          return { mp3Url: resolved, title, source: conv.name };
        }
        // last resort: any audio-like URL
        const anyAudio = text.match(/https?:\/\/[^\s"'<>]+(?:\.mp3|audio|download)[^\s"'<>]*/i);
        if (anyAudio) {
          const resolved = resolveUrl(anyAudio[0], pageUrl);
          return { mp3Url: resolved, title: parseTitleFromHtml(text) || youtubeUrl, source: conv.name };
        }
        updateStatus(`${conv.name} yielded no mp3 — continue`);
      } catch (err) {
        console.warn('converter/proxy error', conv.name, err);
        updateStatus(`${conv.name} error: ${err.message}. Trying next.`);
        continue;
      }
    }
  }
  throw new Error('All converters failed or returned no accessible mp3 (CORS or changed pages).');
}

// resolve relative URLs from converter page
function resolveUrl(candidate, base) {
  try {
    return new URL(candidate, base).href;
  } catch (e) {
    return candidate;
  }
}
function findMp3InJson(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') {
    const m = obj.match(/https?:\/\/[^\s"'<>]+?\.mp3(\?[^"']*)?/i);
    return m ? m[0] : null;
  }
  if (Array.isArray(obj)) {
    for (const it of obj) {
      const f = findMp3InJson(it);
      if (f) return f;
    }
  } else if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const f = findMp3InJson(obj[k]);
      if (f) return f;
    }
  }
  return null;
}

// fetch mp3 blob (may fail on CORS)
async function fetchMp3Blob(mp3Url) {
  const r = await fetch(mp3Url);
  if (!r.ok) throw new Error('MP3 fetch failed: ' + r.status);
  return await r.blob();
}

// Top-level: convert & add
async function convertAndAddYouTube(youtubeUrl) {
  setYtStatus('Trying converters (this may take a few seconds)...');
  try {
    const result = await tryConvertYouTubeToMp3(youtubeUrl, setYtStatus);
    setYtStatus(`Converter responded from ${result.source}. Fetching MP3...`);
    const blob = await fetchMp3Blob(result.mp3Url);
    const id = uid('fetched');
    const title = result.title || youtubeUrl;
    const track = { id, type:'fetched', title, url: youtubeUrl, fetchedFrom: result.source, addedAt: nowISO() };
    playlist.unshift(track);
    inMemoryLocalBlobs.set(id, blob);
    savePlaylist();
    renderPlaylist();
    setYtStatus(`Success: added ${title}`);
    plStatus.textContent = `Fetched: ${title}`;
    plStatus.style.color = '#9bdedb';
  } catch (err) {
    console.error('convert failed', err);
    setYtStatus('Conversion failed: ' + (err.message || err));
    plStatus.textContent = 'Conversion failed';
    plStatus.style.color = '#ffb86b';
    throw err;
  }
}

/* ------------------- Playlist helpers ------------------- */
function addYouTubeMetadata(yurl){
  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(yurl)) {
    ytStatus.textContent = 'Invalid YouTube URL';
    ytStatus.style.color = '#ffb86b';
    return;
  }
  const id = uid('yt');
  const track = { id, type:'youtube', title: yurl, url: yurl, addedAt: nowISO() };
  playlist.unshift(track);
  savePlaylist();
  renderPlaylist();
  ytStatus.textContent = 'Added metadata-only entry';
  ytStatus.style.color = '#9bdedb';
}

function addLastUploadedToPlaylist(){
  if (!lastUploadedBlob){
    plStatus.textContent = 'No uploaded file in session';
    plStatus.style.color = '#ffb86b';
    return;
  }
  const id = uid('loc');
  const track = { id, type:'local', title: lastUploadedBlob.name, filename: lastUploadedBlob.name, addedAt: nowISO() };
  playlist.unshift(track);
  inMemoryLocalBlobs.set(id, lastUploadedBlob.slice(0, lastUploadedBlob.size, lastUploadedBlob.type));
  savePlaylist();
  renderPlaylist();
  plStatus.textContent = 'Local file added to playlist (session only)';
  plStatus.style.color = '#9bdedb';
}

function renderPlaylist(){
  playlistEl.innerHTML = '';
  if (!playlist.length){
    playlistEl.innerHTML = '<div class="text-gray-400 text-sm">Playlist is empty — add YouTube links or local files.</div>';
    return;
  }
  for (let i=0;i<playlist.length;i++){
    const t = playlist[i];
    const row = document.createElement('div');
    row.className = 'p-2 rounded flex items-center justify-between';
    row.innerHTML = `<div class="text-sm">${escapeHtml(t.title)}</div>
                     <div class="text-xs text-gray-400">${t.type === 'youtube' ? t.url : (t.filename || t.fetchedFrom || '')}</div>
                     <div></div>`;
    const controls = document.createElement('div');
    controls.className = 'flex items-center gap-2';
    const playBtn = document.createElement('button');
    playBtn.className = 'px-2 py-1 bg-indigo-500 text-black rounded text-xs';
    playBtn.textContent = 'Play';
    playBtn.onclick = ()=> playPlaylistTrack(t.id);
    const remBtn = document.createElement('button');
    remBtn.className = 'px-2 py-1 bg-red-600 text-black rounded text-xs';
    remBtn.textContent = 'Remove';
    remBtn.onclick = ()=> { if(confirm('Remove track?')) removeTrack(t.id); };
    controls.appendChild(playBtn);
    controls.appendChild(remBtn);
    row.appendChild(controls);
    playlistEl.appendChild(row);
  }
}

function removeTrack(id){
  playlist = playlist.filter(x=>x.id!==id);
  inMemoryLocalBlobs.delete(id);
  savePlaylist();
  renderPlaylist();
  plStatus.textContent = 'Removed track';
  plStatus.style.color = '#9bdedb';
}

async function playPlaylistTrack(id){
  const t = playlist.find(x=>x.id===id);
  if (!t){ plStatus.textContent = 'Track not found'; plStatus.style.color = '#ffb86b'; return; }
  if (t.type === 'youtube') {
    alert('Playback for YouTube metadata-only entries is not available in client-only mode.');
    return;
  }
  const blob = inMemoryLocalBlobs.get(id);
  if (!blob){ alert('Audio not present in session for this track. Re-add or re-convert.'); return; }
  try{
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ab = await blob.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(ab);
    stopSource();
    setupAudioGraph();
    source.start();
    drawVisualizer();
    eqStatus.textContent = `Playing: ${t.title}`;
  }catch(e){
    console.error('play error', e);
    alert('Failed to play: ' + e.message);
  }
}

/* ------------------- Export / Import .eqpl (metadata-only, embedded password) ------------------- */
function generatePassword(len=12){
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i=0;i<len;i++) out += chars[Math.floor(Math.random()*chars.length)];
  return out;
}
function exportPlaylistEqpl(){
  if (!playlist.length){ alert('Playlist empty'); return; }
  const password = generatePassword(14);
  const payload = { format:'day02-eqpl', version:1, exportedAt: nowISO(), passwordEmbedded: password, tracks: playlist.map(t=>({ id:t.id, type:t.type, title:t.title, filename:t.filename||null, url:t.url||null, fetchedFrom:t.fetchedFrom||null, addedAt:t.addedAt }))};
  const blob = new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `playlist-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.eqpl`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  plStatus.textContent = 'Exported .eqpl (password embedded)';
  plStatus.style.color = '#9bdedb';
}
async function importEqplFile(file){
  if (!file) return;
  try{
    const txt = await file.text();
    const obj = JSON.parse(txt);
    if (!obj || obj.format !== 'day02-eqpl'){ alert('Invalid .eqpl'); return; }
    const imported = Array.isArray(obj.tracks) ? obj.tracks : [];
    const existing = new Set(playlist.map(t=>t.id));
    let added = 0;
    for (const t of imported){
      if (!existing.has(t.id)){
        playlist.push({ id:t.id, type:t.type, title:t.title, filename:t.filename, url:t.url, fetchedFrom:t.fetchedFrom, addedAt:t.addedAt });
        added++;
      }
    }
    savePlaylist();
    renderPlaylist();
    plStatus.textContent = `Import: ${added} tracks added (audio blobs not included).`;
    plStatus.style.color = '#9bdedb';
  }catch(e){
    console.error('import failed', e);
    alert('Import failed: ' + e.message);
  }
}

/* ------------------- Helpers & Wiring ------------------- */
function escapeHtml(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function setYtStatus(s){ ytStatus.textContent = s; ytStatus.style.color = '#bfcbd6'; }

// UI handlers
convertAddBtn.onclick = async () => {
  const url = ytUrlEl.value.trim();
  if (!url) { setYtStatus('Paste a YouTube URL first'); return; }
  convertAddBtn.disabled = true;
  try {
    await convertAndAddYouTube(url);
    ytUrlEl.value = '';
  } catch (e) {
    if (confirm('Conversion failed. Add URL as metadata-only instead?')) addYouTubeMetadata(url);
  } finally {
    convertAddBtn.disabled = false;
  }
};
addMetaBtn.onclick = () => {
  const url = ytUrlEl.value.trim();
  if (!url) { setYtStatus('Paste a YouTube URL first'); return; }
  addYouTubeMetadata(url);
  ytUrlEl.value = '';
};
addLocalToListBtn.onclick = addLastUploadedToPlaylist;
exportPlBtn.onclick = exportPlaylistEqpl;
importPlInput.onchange = async (ev) => { const f = ev.target.files[0]; ev.target.value = null; if (f) await importEqplFile(f); };

window.addEventListener('load', () => { loadPlaylist(); renderPlaylist(); setYtStatus('Ready (minimal status box)'); plStatus.textContent = 'Playlist ready'; plStatus.style.color = '#9bdedb'; });
