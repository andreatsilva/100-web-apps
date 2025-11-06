/* app.js — Full feature updates
   - Block editor (paragraph/heading/todo/divider/image/code)
   - Inline formatting toolbar (bold/italic)
   - Insert image by URL
   - Undo / Redo per-note
   - Animated transitions for block add/remove
   - Light / Dark theme toggle (Inter font & color fix)
   - Responsive mobile drawer and FAB
   - Export / Import JSON
*/

const STORAGE_KEY = 'day03_local_notes_v1';
const THEME_KEY = 'day03_theme_v1';

/* ---------- DOM ---------- */
const notesListEl = document.getElementById('notesList');
const notesListMobileEl = document.getElementById('notesListMobile');
const newNoteBtn = document.getElementById('newNoteBtn');
const newNoteBtnMobile = document.getElementById('newNoteBtnMobile');
const importAllInput = document.getElementById('importAllInput');
const importAllInputMobile = document.getElementById('importAllInputMobile');
const exportAllBtn = document.getElementById('exportAllBtn');

const noteTitleEl = document.getElementById('noteTitle');
const noteMetaEl = document.getElementById('noteMeta');
const blocksArea = document.getElementById('blocksArea');
const exportNoteBtn = document.getElementById('exportNoteBtn');
const deleteNoteBtn = document.getElementById('deleteNoteBtn');

const mobileToggle = document.getElementById('mobileToggle');
const mobileDrawer = document.getElementById('mobileDrawer');
const mobileClose = document.getElementById('mobileClose');
const fabNew = document.getElementById('fabNew');

const themeToggle = document.getElementById('themeToggle');
const formatToolbar = document.getElementById('formatToolbar');
const fmtBold = document.getElementById('fmtBold');
const fmtItalic = document.getElementById('fmtItalic');
const insertImageBtn = document.getElementById('insertImage');
const insertCodeBtn = document.getElementById('insertCode');

const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const plStatus = document.getElementById('plStatus');

let notes = [];
let selectedId = null;
let saveTimer = null;
let lastFocusedEditable = null;

/* ---------- History (undo/redo) ---------- */
const HISTORY_LIMIT = 60;
const historyMap = new Map(); // noteId -> { undo: [], redo: [] }

function pushHistory(note) {
  if (!note) return;
  if (!historyMap.has(note.id)) historyMap.set(note.id, { undo: [], redo: [] });
  const stack = historyMap.get(note.id);
  // snapshot minimal state (title + blocks deep copy)
  const snap = { title: note.title, blocks: JSON.parse(JSON.stringify(note.blocks)), ts: nowISO() };
  stack.undo.push(snap);
  if (stack.undo.length > HISTORY_LIMIT) stack.undo.shift();
  stack.redo = []; // clear redo on new action
  updateUndoRedoButtons();
}
function undo() {
  if (!selectedId) return;
  const stacks = historyMap.get(selectedId);
  if (!stacks || !stacks.undo.length) return;
  const current = { title: notes.find(n=>n.id===selectedId).title, blocks: JSON.parse(JSON.stringify(notes.find(n=>n.id===selectedId).blocks)) };
  stacks.redo.push(current);
  const snap = stacks.undo.pop();
  applySnapshotToNote(selectedId, snap);
  persistNotes();
  renderBlocks(notes.find(n=>n.id===selectedId));
  renderNotesList();
  updateUndoRedoButtons();
}
function redo() {
  if (!selectedId) return;
  const stacks = historyMap.get(selectedId);
  if (!stacks || !stacks.redo.length) return;
  const snap = stacks.redo.pop();
  // push current to undo
  const current = { title: notes.find(n=>n.id===selectedId).title, blocks: JSON.parse(JSON.stringify(notes.find(n=>n.id===selectedId).blocks)) };
  stacks.undo.push(current);
  applySnapshotToNote(selectedId, snap);
  persistNotes();
  renderBlocks(notes.find(n=>n.id===selectedId));
  renderNotesList();
  updateUndoRedoButtons();
}
function applySnapshotToNote(id, snap) {
  const note = notes.find(n=>n.id===id);
  if (!note) return;
  note.title = snap.title;
  note.blocks = JSON.parse(JSON.stringify(snap.blocks));
  note.updatedAt = nowISO();
}
function updateUndoRedoButtons() {
  const stacks = historyMap.get(selectedId);
  undoBtn.disabled = !stacks || !stacks.undo.length;
  redoBtn.disabled = !stacks || !stacks.redo.length;
}

/* ---------- Utils ---------- */
const uid = (p='n') => `${p}_${Math.random().toString(36).slice(2,9)}`;
const nowISO = () => new Date().toISOString();
function formatDate(iso){ return new Date(iso).toLocaleString(); }
function timeAgo(iso){ const d=new Date(iso); const diff=Date.now()-d.getTime(); const s=Math.floor(diff/1000); if (s<60) return `${s}s`; const m=Math.floor(s/60); if (m<60) return `${m}m`; const h=Math.floor(m/60); if (h<24) return `${h}h`; return `${Math.floor(h/24)}d`; }
function escapeHtml(s){ return (s||'').toString().replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }

/* ---------- Storage ---------- */
function loadNotes(){ try { const raw = localStorage.getItem(STORAGE_KEY); notes = raw ? JSON.parse(raw) : []; } catch(e){ notes=[]; console.error(e); } }
function persistNotes(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); }

/* ---------- Theme ---------- */
function getSavedTheme(){ return localStorage.getItem(THEME_KEY) || 'dark'; }
function applyTheme(t){
  if (t === 'light') document.documentElement.classList.add('light');
  else document.documentElement.classList.remove('light');
  localStorage.setItem(THEME_KEY, t);
}
themeToggle.onclick = () => {
  const cur = getSavedTheme();
  const nxt = cur === 'dark' ? 'light' : 'dark';
  applyTheme(nxt);
};
applyTheme(getSavedTheme());

/* ---------- Mobile drawer ---------- */
mobileToggle.onclick = () => mobileDrawer.classList.add('open');
mobileClose.onclick = () => mobileDrawer.classList.remove('open');
document.addEventListener('click', (e) => {
  if (!mobileDrawer.contains(e.target) && !mobileToggle.contains(e.target) && window.innerWidth < 1024) {
    mobileDrawer.classList.remove('open');
  }
});

/* ---------- Render notes list ---------- */
function renderNotesList(){
  notesListEl.innerHTML = '';
  notesListMobileEl.innerHTML = '';
  if (!notes.length){
    const empty = '<div class="text-gray-400">No notes yet. Click + New to create one.</div>';
    notesListEl.innerHTML = empty;
    notesListMobileEl.innerHTML = empty;
    return;
  }
  notes.forEach(n => {
    const item = document.createElement('div');
    item.className = `p-3 rounded mb-2 cursor-pointer ${n.id===selectedId ? 'bg-white/3 border border-white/6' : 'hover:bg-white/2'}`;
    item.innerHTML = `<div class="font-medium">${escapeHtml(n.title || 'Untitled')}</div>
                      <div class="text-xs smallmuted mt-1">Updated ${timeAgo(n.updatedAt)}</div>`;
    item.onclick = () => { selectNote(n.id); mobileDrawer.classList.remove('open'); };
    notesListEl.appendChild(item);

    const item2 = item.cloneNode(true);
    item2.onclick = () => { selectNote(n.id); mobileDrawer.classList.remove('open'); };
    notesListMobileEl.appendChild(item2);
  });
}

/* ---------- CRUD ---------- */
function createNote(){
  const id = uid('note');
  const note = { id, title: 'Untitled', blocks: [{ id: uid('b'), type:'paragraph', content:'' }], createdAt: nowISO(), updatedAt: nowISO() };
  notes.unshift(note);
  persistNotes();
  pushHistory(note); // initial snapshot
  selectNote(id);
}
function deleteNote(id){
  if (!confirm('Delete this note?')) return;
  notes = notes.filter(n=>n.id!==id);
  persistNotes();
  historyMap.delete(id);
  if (selectedId===id){
    if (notes.length) selectNote(notes[0].id);
    else clearEditor();
  } else renderNotesList();
}
function selectNote(id){
  selectedId = id;
  const note = notes.find(x=>x.id===id);
  if (!note) return clearEditor();
  noteTitleEl.value = note.title || '';
  noteMetaEl.textContent = `Created ${formatDate(note.createdAt)} • Updated ${formatDate(note.updatedAt)}`;
  renderBlocks(note);
  renderNotesList();
  updateUndoRedoButtons();
}
function clearEditor(){
  selectedId = null;
  noteTitleEl.value = '';
  noteMetaEl.textContent = '';
  blocksArea.innerHTML = '<div class="text-gray-400">Select or create a note.</div>';
  renderNotesList();
}

/* ---------- Blocks rendering ---------- */
function renderBlocks(note){
  // animate replace
  blocksArea.innerHTML = '';
  const list = document.createElement('div');
  list.id = 'blocksList';
  list.className = 'space-y-3';
  note.blocks.forEach((b, idx) => {
    const el = renderBlockElement(note, b, idx);
    el.classList.add('fade-in');
    list.appendChild(el);
  });
  blocksArea.appendChild(list);
}

function renderBlockElement(note, block, index){
  const wrapper = document.createElement('div');
  wrapper.className = 'flex items-start gap-3 p-2 rounded';
  wrapper.draggable = true;
  wrapper.dataset.blockId = block.id;

  const handle = document.createElement('div');
  handle.className = 'drag-handle smallmuted pt-1';
  handle.innerHTML = '&#x2630;';
  wrapper.appendChild(handle);

  const contentWrap = document.createElement('div');
  contentWrap.className = 'flex-1';

  if (block.type === 'divider'){
    const hr = document.createElement('div');
    hr.className = 'border-b border-gray-700 my-1';
    contentWrap.appendChild(hr);
  } else if (block.type === 'todo'){
    const row = document.createElement('div');
    row.className = 'flex items-center gap-2';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!block.checked;
    cb.className = 'todo-checkbox';
    cb.onchange = (e) => { block.checked = e.target.checked; scheduleSave(); };
    row.appendChild(cb);

    const ce = document.createElement('div');
    ce.className = 'block contenteditable text-sm';
    ce.contentEditable = true;
    ce.spellcheck = false;
    ce.innerText = block.content || '';
    ce.oninput = () => { block.content = ce.innerText; scheduleSave(); };
    ce.onkeydown = blockKeyHandler(note, block, ce);
    ce.onfocus = () => { lastFocusedEditable = ce; showFormatToolbarFor(ce); };
    ce.onblur = () => { lastFocusedEditable = null; hideFormatToolbar(); };
    row.appendChild(ce);
    contentWrap.appendChild(row);
  } else if (block.type === 'image'){
    // image block with optional caption (editable)
    const img = document.createElement('img');
    img.src = block.src || '';
    img.className = 'block-image';
    img.onerror = () => { img.style.opacity = .6; img.alt = 'Image failed to load'; };
    contentWrap.appendChild(img);

    const caption = document.createElement('div');
    caption.className = 'block contenteditable smallmuted';
    caption.contentEditable = true;
    caption.innerText = block.caption || '';
    caption.oninput = () => { block.caption = caption.innerText; scheduleSave(); };
    caption.onfocus = () => { lastFocusedEditable = caption; showFormatToolbarFor(caption); };
    caption.onblur = () => { lastFocusedEditable = null; hideFormatToolbar(); };
    contentWrap.appendChild(caption);
  } else if (block.type === 'code'){
    const pre = document.createElement('pre');
    pre.className = 'codeblock';
    pre.contentEditable = true;
    pre.spellcheck = false;
    pre.innerText = block.content || '';
    pre.oninput = () => { block.content = pre.innerText; scheduleSave(); };
    pre.onfocus = () => { lastFocusedEditable = pre; hideFormatToolbar(); }; // hide formatting for code
    contentWrap.appendChild(pre);
  } else {
    // paragraph or heading
    const ce = document.createElement('div');
    ce.className = block.type === 'heading' ? 'block text-xl font-semibold' : 'block text-sm';
    ce.contentEditable = true;
    ce.spellcheck = false;
    ce.innerText = block.content || '';
    ce.oninput = () => { block.content = ce.innerText; scheduleSave(); };
    ce.onkeydown = blockKeyHandler(note, block, ce);
    ce.onfocus = () => { lastFocusedEditable = ce; showFormatToolbarFor(ce); };
    ce.onblur = () => { lastFocusedEditable = null; hideFormatToolbar(); };
    contentWrap.appendChild(ce);
  }

  wrapper.appendChild(contentWrap);

  const controls = document.createElement('div');
  controls.className = 'flex flex-col gap-2 items-end';

  const addBtn = document.createElement('button');
  addBtn.className = 'smallmuted text-xs panel px-2 py-1 rounded';
  addBtn.textContent = '+';
  addBtn.title = 'Insert below';
  addBtn.onclick = () => {
    const nb = { id: uid('b'), type:'paragraph', content:'' };
    note.blocks.splice(index+1, 0, nb);
    pushHistory(note);
    scheduleSave(); renderBlocks(note); focusBlock(nb.id);
  };

  const menuBtn = document.createElement('button');
  menuBtn.className = 'smallmuted text-xs panel px-2 py-1 rounded';
  menuBtn.textContent = '⋯';
  menuBtn.onclick = (e) => openBlockMenu(e, note, block);

  const delBtn = document.createElement('button');
  delBtn.className = 'smallmuted text-xs text-red-400 panel px-2 py-1 rounded';
  delBtn.textContent = '✕';
  delBtn.onclick = () => {
    // animate out then remove
    wrapper.classList.add('fade-out');
    setTimeout(()=> {
      note.blocks = note.blocks.filter(x=>x.id!==block.id);
      pushHistory(note);
      scheduleSave();
      renderBlocks(note);
    }, 140);
  };

  controls.appendChild(addBtn);
  controls.appendChild(menuBtn);
  controls.appendChild(delBtn);
  wrapper.appendChild(controls);

  // drag events
  wrapper.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/block-id', block.id);
    wrapper.classList.add('opacity-60');
  });
  wrapper.addEventListener('dragend', (e) => wrapper.classList.remove('opacity-60'));
  wrapper.addEventListener('dragover', (e) => { e.preventDefault(); wrapper.classList.add('bg-white/3'); });
  wrapper.addEventListener('dragleave', (e) => wrapper.classList.remove('bg-white/3'));
  wrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    wrapper.classList.remove('bg-white/3');
    const draggedId = e.dataTransfer.getData('text/block-id');
    if (!draggedId || draggedId === block.id) return;
    const fromIdx = note.blocks.findIndex(b=>b.id===draggedId);
    const toIdx = note.blocks.findIndex(b=>b.id===block.id);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = note.blocks.splice(fromIdx,1);
    note.blocks.splice(toIdx,0,moved);
    pushHistory(note);
    scheduleSave(); renderBlocks(note);
  });

  return wrapper;
}

/* ---------- keyboard and slash commands ---------- */
function blockKeyHandler(note, block, ce){
  return function(e){
    if (e.key === 'Enter'){
      e.preventDefault();
      const idx = note.blocks.findIndex(b=>b.id===block.id);
      const nb = { id: uid('b'), type:'paragraph', content: '' };
      note.blocks.splice(idx+1,0,nb);
      pushHistory(note);
      scheduleSave(); renderBlocks(note); focusBlock(nb.id);
    }
    // slash commands at line start (space triggers)
    if (e.key === ' ' && ce.innerText.trim().startsWith('/')){
      const cmd = ce.innerText.trim();
      if (cmd === '/h' || cmd === '/heading'){ block.type='heading'; block.content=''; ce.innerText=''; pushHistory(note); scheduleSave(); renderBlocks(note); e.preventDefault(); }
      if (cmd === '/todo'){ block.type='todo'; block.content=''; block.checked=false; ce.innerText=''; pushHistory(note); scheduleSave(); renderBlocks(note); e.preventDefault(); }
      if (cmd === '/hr' || cmd === '/divider'){ const idx = note.blocks.findIndex(b=>b.id===block.id); note.blocks.splice(idx,1,{id:uid('b'),type:'divider'}); pushHistory(note); scheduleSave(); renderBlocks(note); e.preventDefault(); }
      if (cmd === '/img' || cmd === '/image'){ const url = prompt('Image URL'); if (url) { const idx = note.blocks.findIndex(b=>b.id===block.id); note.blocks.splice(idx+1,0,{id:uid('b'),type:'image', src:url, caption:''}); pushHistory(note); scheduleSave(); renderBlocks(note); } e.preventDefault(); }
      if (cmd === '/code'){ block.type='code'; block.content=''; ce.innerText=''; pushHistory(note); scheduleSave(); renderBlocks(note); e.preventDefault(); }
    }
  };
}

/* ---------- block menu ---------- */
function openBlockMenu(ev,note,block){
  const menu = document.createElement('div');
  menu.className = 'block-menu panel p-2';
  menu.style.left = (ev.clientX - 70) + 'px';
  menu.style.top = (ev.clientY + 8) + 'px';
  menu.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px;">
    <button data-type="paragraph" class="smallmuted">Paragraph</button>
    <button data-type="heading" class="smallmuted">Heading</button>
    <button data-type="todo" class="smallmuted">To-do</button>
    <button data-type="image" class="smallmuted">Image</button>
    <button data-type="code" class="smallmuted">Code</button>
    <button data-type="divider" class="smallmuted">Divider</button>
  </div>`;
  document.body.appendChild(menu);
  menu.querySelectorAll('button').forEach(b=>{
    b.onclick = () => {
      const t = b.dataset.type;
      if (t === 'divider'){ const idx = note.blocks.findIndex(x=>x.id===block.id); note.blocks.splice(idx,1,{id:uid('b'),type:'divider'}); }
      else if (t === 'image') {
        const url = prompt('Image URL');
        if (url) {
          const idx = note.blocks.findIndex(x=>x.id===block.id);
          note.blocks.splice(idx+1,0,{ id: uid('b'), type:'image', src: url, caption: ''});
        }
      } else if (t === 'code') {
        block.type = 'code'; block.content = block.content || '';
      } else block.type = t;
      pushHistory(note);
      scheduleSave(); renderBlocks(note); menu.remove();
    };
  });
  setTimeout(()=> window.addEventListener('click', ()=>menu.remove(), { once:true }), 10);
}

/* ---------- formatting toolbar ---------- */
function showFormatToolbarFor(el) {
  if (!el) return hideFormatToolbar();
  const rect = el.getBoundingClientRect();
  formatToolbar.style.display = 'flex';
  // position above element, but within viewport
  const left = Math.max(12, rect.left + window.scrollX);
  const top = Math.max(60, rect.top + window.scrollY - 50);
  formatToolbar.style.left = `${left}px`;
  formatToolbar.style.top = `${top}px`;
}
function hideFormatToolbar(){ formatToolbar.style.display = 'none'; }

fmtBold.onclick = () => { document.execCommand('bold'); scheduleSave(); };
fmtItalic.onclick = () => { document.execCommand('italic'); scheduleSave(); };

/* Insert image button (toolbar) */
insertImageBtn.onclick = async () => {
  const url = prompt('Image URL');
  if (!url) return;
  if (!selectedId) return alert('Select a note first');
  const note = notes.find(n=>n.id===selectedId);
  const idx = note.blocks.length; // append
  const block = { id: uid('b'), type: 'image', src: url, caption: '' };
  note.blocks.splice(idx, 0, block);
  pushHistory(note);
  scheduleSave(); renderBlocks(note);
};

/* Insert code block button */
insertCodeBtn.onclick = () => {
  if (!selectedId) return alert('Select a note first');
  const note = notes.find(n=>n.id===selectedId);
  const block = { id: uid('b'), type: 'code', content: '' };
  note.blocks.push(block);
  pushHistory(note);
  scheduleSave(); renderBlocks(note);
};

/* ---------- focusing ---------- */
function focusBlock(blockId){
  const el = blocksArea.querySelector(`[data-block-id="${blockId}"]`);
  if (!el) return;
  const ce = el.querySelector('[contenteditable="true"]');
  if (ce){ ce.focus(); document.execCommand('selectAll', false, null); document.getSelection().collapseToEnd(); showFormatToolbarFor(ce); }
}

/* ---------- save logic ---------- */
function scheduleSave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=> {
    if (!selectedId) return;
    const note = notes.find(n=>n.id===selectedId);
    if (!note) return;
    note.title = (noteTitleEl.value || 'Untitled').trim();
    note.updatedAt = nowISO();
    persistNotes();
    renderNotesList();
    noteMetaEl.textContent = `Created ${formatDate(note.createdAt)} • Updated ${formatDate(note.updatedAt)}`;
    updateUndoRedoButtons();
  }, 300);
}

/* ---------- Export / Import ---------- */
function exportNoteJSON(note){
  const payload = { exportedAt: nowISO(), note };
  const blob = new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(note.title||'note').slice(0,40).replace(/\s+/g,'_')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
}
function exportAllNotes(){
  const payload = { exportedAt: nowISO(), notes };
  const blob = new Blob([JSON.stringify(payload,null,2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `notes-export-${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
}
async function importNotesFile(file){
  try{
    const txt = await file.text();
    const obj = JSON.parse(txt);
    if (!obj) return alert('Invalid file');
    const incoming = obj.note ? [obj.note] : (Array.isArray(obj.notes) ? obj.notes : (Array.isArray(obj) ? obj : null));
    if (!incoming) return alert('No notes found');
    const map = new Map(notes.map(n=>[n.id,n]));
    incoming.forEach(n => {
      if (!n.id) n.id = uid('note');
      n.createdAt = n.createdAt || nowISO();
      n.updatedAt = n.updatedAt || nowISO();
      map.set(n.id, n);
      pushHistory(n);
    });
    notes = Array.from(map.values()).sort((a,b)=> new Date(b.updatedAt) - new Date(a.updatedAt));
    persistNotes(); renderNotesList(); alert('Import complete');
  }catch(e){ console.error(e); alert('Import failed: ' + e.message); }
}

/* ---------- Wiring ---------- */
newNoteBtn.onclick = createNote;
newNoteBtnMobile.onclick = createNote;
exportAllBtn.onclick = exportAllNotes;
importAllInput.onchange = async (e)=>{ const f = e.target.files[0]; e.target.value=null; if (f) await importNotesFile(f); };
importAllInputMobile.onchange = async (e)=>{ const f = e.target.files[0]; e.target.value=null; if (f) await importNotesFile(f); };

exportNoteBtn.onclick = ()=>{ if (!selectedId) return alert('No note selected'); const n = notes.find(x=>x.id===selectedId); if (n) exportNoteJSON(n); };
deleteNoteBtn.onclick = ()=>{ if (!selectedId) return; deleteNote(selectedId); };
noteTitleEl.addEventListener('input', ()=>{ if (!selectedId) return; pushHistory(notes.find(n=>n.id===selectedId)); scheduleSave(); });

undoBtn.onclick = () => undo();
redoBtn.onclick = () => redo();

/* formatting keyboard shortcuts */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
    if (e.key.toLowerCase() === 'b') { e.preventDefault(); document.execCommand('bold'); scheduleSave(); }
    if (e.key.toLowerCase() === 'i') { e.preventDefault(); document.execCommand('italic'); scheduleSave(); }
  }
});

/* formatting toolbar visibility: hide if clicking outside editable */
document.addEventListener('click', (e) => {
  if (!formatToolbar.contains(e.target) && !e.target.closest('[contenteditable="true"]')) {
    hideFormatToolbar();
  }
});

/* ---------- Init ---------- */
function startApp(){
  loadNotes();
  if (notes.length) selectNote(notes[0].id);
  else createNote();
  renderNotesList();
  plStatus.textContent = 'Ready';
  updateFabVisibility();
}
startApp();

/* ---------- FAB visibility ---------- */
function updateFabVisibility(){
  if (window.innerWidth < 768){
    fabNew.classList.remove('hidden');
    fabNew.onclick = createNote;
  } else {
    fabNew.classList.add('hidden');
  }
}
window.addEventListener('resize', updateFabVisibility);
updateFabVisibility();
