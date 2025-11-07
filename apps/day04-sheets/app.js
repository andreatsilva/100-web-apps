/* app.js — Fixed & patched MiniSheet
   Key points:
   - Safe DOM init after DOMContentLoaded
   - safeGet helper prevents null/style errors
   - Toolbar (TextButtons) injected and initialized
   - Row resize + double-click auto-fit (mouse only)
   - Per-cell formatting persists
*/

(() => {
  "use strict";

  /* ---------- Helpers & state ---------- */
  const WORKBOOK_KEY = 'minisheet_workbook_v1';
  const A_CHAR = 'A'.charCodeAt(0);
  const WRAP_DEFAULT = false;

  const uid = (p='id')=> `${p}_${Math.random().toString(36).slice(2,9)}`;
  const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
  const colToName = i => String.fromCharCode(A_CHAR + i);
  const nameToCol = n => n.charCodeAt(0) - A_CHAR;
  const parseCellId = id => { const m = id && id.match(/^([A-Z]+)(\d+)$/); if(!m) return null; return [m[1], parseInt(m[2],10)]; };

  // safe DOM getter
  function safeGet(sel) {
    const el = document.querySelector(sel) || document.getElementById(sel.replace(/^#/, ''));
    return el || null;
  }

  // DOM elements will be obtained after DOMContentLoaded

  /* ---------- App data ---------- */
  let workbook = null;
  let undoStack = [], redoStack = [];
  let focusedCell = null;
  let selectionSet = new Set();
  let lastClickedCell = null;

  function createBlankSheet(name='Sheet', cols=15, rows=40){
    return { id:uid('s'), name, COLS:cols, ROWS:rows, data:{}, colWidths:{}, rowHeights:{} };
  }
  function createWorkbook(name='Workbook'){ return { id:uid('wb'), name, sheets:[ createBlankSheet('Sheet1',15,40) ], active:0 }; }

  function saveWorkbook(){ try { localStorage.setItem(WORKBOOK_KEY, JSON.stringify(workbook)); } catch(e){} }
  function loadWorkbook(){ const raw = localStorage.getItem(WORKBOOK_KEY); if(!raw){ workbook = createWorkbook(); return; } try { workbook = JSON.parse(raw); if(!workbook.sheets || !workbook.sheets.length) workbook.sheets = [createBlankSheet()]; } catch(e){ workbook = createWorkbook(); } }

  /* ---------- UI references (populated later) ---------- */
  let sheetsListEl, addSheetBtn, exportWorkbookBtn, importWorkbookInput, importWorkbookBtn;
  let sheetTable, gridViewport, formulaEl, colCountEl, rowCountEl, resizeBtn, undoBtn, redoBtn, saveBtn;
  let csvFile, importCsvBtn, exportCsvBtn, cellFormatSel, toggleThemeBtn;

  /* ---------- Utilities ---------- */
  function escapeHtml(s=''){ return String(s).replace(/[&<>"'`=\/]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;","/":"&#x2F;","`":"&#x60;","=":"&#x3D;" })[c]); }

  /* ---------- Init toolbar (text buttons) ---------- */
  function createToolbar(containerEl){
    if (!containerEl) return;
    // remove existing children safely
    containerEl.innerHTML = '';

    const buttons = [];

    const alignBtn = document.createElement('button'); alignBtn.className='toolbar-btn'; alignBtn.textContent='Align ▼';
    const wrapBtn = document.createElement('button'); wrapBtn.className='toolbar-btn'; wrapBtn.textContent='Wrap ▼';
    const boldBtn = document.createElement('button'); boldBtn.className='toolbar-btn'; boldBtn.textContent='B';
    const italicBtn = document.createElement('button'); italicBtn.className='toolbar-btn'; italicBtn.textContent='I';
    const underlineBtn = document.createElement('button'); underlineBtn.className='toolbar-btn'; underlineBtn.textContent='U';

    buttons.push(alignBtn, wrapBtn, boldBtn, italicBtn, underlineBtn);
    buttons.forEach(b => containerEl.appendChild(b));

    // alignment menu
    alignBtn.addEventListener('click', (e) => {
      const menu = document.createElement('div'); menu.className='panel'; menu.style.position='absolute';
      menu.style.left = (alignBtn.getBoundingClientRect().left) + 'px';
      menu.style.top = (alignBtn.getBoundingClientRect().bottom + 6) + 'px';
      menu.innerHTML = `<div style="padding:6px;cursor:pointer">Left</div><div style="padding:6px;cursor:pointer">Center</div><div style="padding:6px;cursor:pointer">Right</div>`;
      document.body.appendChild(menu);
      menu.addEventListener('click', (ev)=> {
        ev.stopPropagation();
        const v = ev.target.textContent.trim().toLowerCase();
        if (['left','center','right'].includes(v)) applyAlignmentToSelection(v);
        document.body.removeChild(menu);
      });
      setTimeout(()=> document.addEventListener('click', ()=> { if(document.body.contains(menu)) document.body.removeChild(menu); }, { once:true }));
    });

    // wrap menu
    wrapBtn.addEventListener('click', (e) => {
      const menu = document.createElement('div'); menu.className='panel'; menu.style.position='absolute';
      menu.style.left = (wrapBtn.getBoundingClientRect().left) + 'px';
      menu.style.top = (wrapBtn.getBoundingClientRect().bottom + 6) + 'px';
      menu.innerHTML = `<div style="padding:6px;cursor:pointer">Wrap On</div><div style="padding:6px;cursor:pointer">Wrap Off</div>`;
      document.body.appendChild(menu);
      menu.addEventListener('click', (ev)=> {
        ev.stopPropagation();
        const t = ev.target.textContent.trim();
        if (t === 'Wrap On') applyWrapToSelection(true);
        if (t === 'Wrap Off') applyWrapToSelection(false);
        document.body.removeChild(menu);
      });
      setTimeout(()=> document.addEventListener('click', ()=> { if(document.body.contains(menu)) document.body.removeChild(menu); }, { once:true }));
    });

    boldBtn.addEventListener('click', ()=> toggleStyleForSelection('bold'));
    italicBtn.addEventListener('click', ()=> toggleStyleForSelection('italic'));
    underlineBtn.addEventListener('click', ()=> toggleStyleForSelection('underline'));

    // keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 'b') { e.preventDefault(); toggleStyleForSelection('bold'); }
      if (e.key.toLowerCase() === 'i') { e.preventDefault(); toggleStyleForSelection('italic'); }
      if (e.key.toLowerCase() === 'u') { e.preventDefault(); toggleStyleForSelection('underline'); }
    });
  }

  /* ---------- Render sheets list ---------- */
  function renderSheetsList(){
    if (!sheetsListEl) return;
    sheetsListEl.innerHTML = '';
    workbook.sheets.forEach((s, idx) => {
      const div = document.createElement('div'); div.className = 'panel flex items-center justify-between p-2';
      div.innerHTML = `<div style="flex:1">${escapeHtml(s.name)}</div><div class="flex gap-2"><button class="smallmuted rename">✎</button><button class="smallmuted dup">⧉</button><button class="smallmuted del">🗑</button></div>`;
      div.addEventListener('click', (e)=> {
        if (e.target.closest('button')) return;
        workbook.active = idx; clearSelection(); persistAndRender();
      });
      sheetsListEl.appendChild(div);

      // attach actions
      div.querySelector('.rename').addEventListener('click', (ev)=> {
        ev.stopPropagation(); const name = prompt('Rename sheet', s.name); if (name) { s.name = name; persistAndRender(); }
      });
      div.querySelector('.dup').addEventListener('click', (ev)=> {
        ev.stopPropagation(); const copy = JSON.parse(JSON.stringify(s)); copy.id = uid('s'); copy.name = s.name + ' copy'; workbook.sheets.splice(idx+1,0,copy); workbook.active = idx+1; persistAndRender();
      });
      div.querySelector('.del').addEventListener('click', (ev)=> {
        ev.stopPropagation(); if (workbook.sheets.length === 1) return alert('Need at least one sheet'); if (!confirm(`Delete ${s.name}?`)) return; workbook.sheets.splice(idx,1); if (workbook.active >= workbook.sheets.length) workbook.active = workbook.sheets.length -1; persistAndRender();
      });
    });
  }

  /* ---------- Build grid ---------- */
  let VISIBLE_START_ROW = 1;
  let VISIBLE_ROW_COUNT = 60;

  function buildGrid(){
    if (!sheetTable || !gridViewport) return;
    const sheet = workbook.sheets[workbook.active || 0];
    colCountEl.value = sheet.COLS; rowCountEl.value = sheet.ROWS;

    sheetTable.innerHTML = '';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const corner = document.createElement('th'); corner.className='row-header'; corner.textContent=''; headerRow.appendChild(corner);

    for (let c=0;c<sheet.COLS;c++){
      const th = document.createElement('th'); th.className='sheet-header'; th.dataset.col=c;
      if (sheet.colWidths && sheet.colWidths[c]) th.style.width = sheet.colWidths[c] + 'px';
      th.style.fontSize = '13px'; th.style.fontWeight='500';
      th.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:6px"><div>${colToName(c)}</div><div class="col-resizer" data-col="${c}"></div></div>`;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    sheetTable.appendChild(thead);

    // compute visible rows by viewport
    const viewportH = gridViewport.clientHeight || 600;
    const approx = 32;
    VISIBLE_ROW_COUNT = Math.max(12, Math.min(200, Math.floor(viewportH/approx) + 5));
    VISIBLE_START_ROW = clamp(VISIBLE_START_ROW, 1, Math.max(1, sheet.ROWS - VISIBLE_ROW_COUNT + 1));
    const tbody = document.createElement('tbody');

    const start = VISIBLE_START_ROW;
    const end = Math.min(sheet.ROWS, VISIBLE_START_ROW + VISIBLE_ROW_COUNT - 1);
    for (let r = start; r <= end; r++){
      const tr = document.createElement('tr');
      const rowHead = document.createElement('th'); rowHead.className='row-header row-handle'; rowHead.textContent = r;
      rowHead.style.position='relative';
      const rowResizer = document.createElement('div'); rowResizer.style.position='absolute'; rowResizer.style.left='0'; rowResizer.style.right='0'; rowResizer.style.bottom='0'; rowResizer.style.height='6px'; rowResizer.style.cursor='row-resize';
      rowResizer.dataset.row = r;
      rowResizer.onmousedown = (e)=> startRowResize(e, r);
      rowResizer.ondblclick = (e)=> autoFitRow(r);
      rowHead.appendChild(rowResizer);
      tr.appendChild(rowHead);

      for (let c=0;c<sheet.COLS;c++){
        const td = document.createElement('td'); td.dataset.row = r; td.dataset.col = c;
        if (sheet.colWidths && sheet.colWidths[c]) td.style.width = sheet.colWidths[c] + 'px';
        const id = `${colToName(c)}${r}`; td.dataset.cell = id;
        const div = document.createElement('div'); div.className='cell'; div.contentEditable = true; div.spellcheck=false; div.dataset.cell = id;
        div.style.padding='6px 8px'; div.style.minHeight='22px';
        const cellObj = sheet.data[id];
        div.textContent = cellObj ? displayValue(cellObj) : '';
        applyStyleToCellDiv(div, cellObj, sheet, r);
        div.addEventListener('focus', (e)=> onCellFocus(e.target));
        div.addEventListener('blur', (e)=> onCellBlur(e.target));
        div.addEventListener('keydown', onCellKeyDown);
        div.addEventListener('input', ()=> onCellInput(div));
        div.addEventListener('click', (ev)=> handleCellClick(ev, id));
        td.appendChild(div);
        // persisted row height
        if (sheet.rowHeights && sheet.rowHeights[r]) td.style.height = sheet.rowHeights[r] + 'px';
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    sheetTable.appendChild(tbody);
    attachResizers();
    applyFreezeSticky();
    refreshSelectionVisuals();
  }

  /* ---------- displayValue & style application ---------- */
  function displayValue(cellObj){
    if (!cellObj) return '';
    if (cellObj.expr && cellObj.expr.startsWith('=')) return (cellObj.value === null || cellObj.value === undefined) ? '' : String(cellObj.value);
    return String(cellObj.value !== undefined ? cellObj.value : (cellObj.expr !== undefined ? cellObj.expr : ''));
  }

  function applyStyleToCellDiv(div, cellObj, sheet, rowNumber){
    const style = cellObj && cellObj.style ? cellObj.style : null;
    const align = style && style.align ? style.align : 'left';
    const wrap = style && typeof style.wrap === 'boolean' ? style.wrap : WRAP_DEFAULT;
    div.style.textAlign = align;
    div.style.whiteSpace = wrap ? 'normal' : 'nowrap';
    div.style.fontWeight = (style && style.bold) ? '700' : '400';
    div.style.fontStyle = (style && style.italic) ? 'italic' : 'normal';
    div.style.textDecoration = (style && style.underline) ? 'underline' : 'none';
    if (sheet.rowHeights && sheet.rowHeights[rowNumber]) div.parentElement.style.height = sheet.rowHeights[rowNumber] + 'px';
  }

  /* ---------- Resizers (cols) ---------- */
  function attachResizers(){
    Array.from(document.querySelectorAll('.col-resizer')).forEach(r => {
      r.onmousedown = (e) => {
        e.preventDefault();
        const th = r.closest('th');
        const col = +r.dataset.col;
        const startX = e.clientX;
        const startW = th.getBoundingClientRect().width || 80;
        function onMove(ev){ const nw = Math.max(36, startW + (ev.clientX - startX)); th.style.width = nw + 'px'; }
        function onUp(){ const final = Math.max(36, Math.round(th.getBoundingClientRect().width)); const s = workbook.sheets[workbook.active]; s.colWidths = s.colWidths || {}; s.colWidths[col] = final; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); saveWorkbook(); }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      };
    });
  }

  /* ---------- Row resize (mouse only) ---------- */
  let activeRowResize = null;
  function startRowResize(e, row){
    e.preventDefault();
    const sheet = workbook.sheets[workbook.active];
    const startY = e.clientY;
    const sample = sheetTable.querySelector(`td[data-row="${row}"]`);
    const startH = sample ? Math.round(sample.getBoundingClientRect().height) : 28;
    activeRowResize = { row, startY, startH };
    function onMove(ev){
      const dy = Math.round(ev.clientY - startY);
      const newH = Math.max(18, startH + dy);
      const tds = sheetTable.querySelectorAll(`td[data-row="${row}"]`);
      tds.forEach(td => td.style.height = newH + 'px');
    }
    function onUp(ev){
      const dy = Math.round(ev.clientY - startY);
      const final = Math.max(18, startH + dy);
      sheet.rowHeights = sheet.rowHeights || {}; sheet.rowHeights[row] = final;
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      activeRowResize = null; saveWorkbook();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function autoFitRow(row){
    const sheet = workbook.sheets[workbook.active];
    const tmp = document.createElement('div'); tmp.style.position='absolute'; tmp.style.left='-9999px'; tmp.style.top='-9999px'; tmp.style.whiteSpace='normal'; tmp.style.padding='6px 8px'; tmp.style.visibility='hidden';
    document.body.appendChild(tmp);
    const sampleCols = Math.min(sheet.COLS, 80);
    let maxH = 18;
    for (let c=0;c<sampleCols;c++){
      const id = `${colToName(c)}${row}`; const cell = sheet.data[id];
      const txt = cell ? (cell.expr && cell.expr.startsWith('=') ? String(cell.value || '') : String(cell.expr || cell.value || '')) : '';
      if (!txt) continue;
      tmp.style.width = ((sheet.colWidths && sheet.colWidths[c]) ? sheet.colWidths[c] : 120) - 12 + 'px';
      tmp.textContent = txt;
      const h = Math.ceil(tmp.getBoundingClientRect().height + 8);
      if (h > maxH) maxH = h;
    }
    document.body.removeChild(tmp);
    sheet.rowHeights = sheet.rowHeights || {}; sheet.rowHeights[row] = Math.min(Math.max(18, Math.round(maxH)), 2000);
    saveWorkbook(); buildGrid(); refreshGrid();
  }

  /* ---------- Selection ---------- */
  function clearSelection(){ selectionSet.clear(); lastClickedCell = null; focusedCell = null; refreshSelectionVisuals(); }
  function handleCellClick(ev, id){
    const isMeta = ev.ctrlKey || ev.metaKey;
    const isShift = ev.shiftKey;
    if (isShift && lastClickedCell){
      const p1 = parseCellId(lastClickedCell), p2 = parseCellId(id);
      if (!p1 || !p2) { selectionSet.add(id); lastClickedCell = id; refreshSelectionVisuals(); return; }
      const c1 = nameToCol(p1[0]), r1 = p1[1], c2 = nameToCol(p2[0]), r2 = p2[1];
      const minC = Math.min(c1,c2), maxC = Math.max(c1,c2), minR = Math.min(r1,r2), maxR = Math.max(r1,r2);
      selectionSet.clear();
      for (let rr=minR; rr<=maxR; rr++) for (let cc=minC; cc<=maxC; cc++) selectionSet.add(`${colToName(cc)}${rr}`);
      focusedCell = id; refreshSelectionVisuals(); return;
    }
    if (isMeta){
      if (selectionSet.has(id)) selectionSet.delete(id); else selectionSet.add(id);
      lastClickedCell = id; focusedCell = id; refreshSelectionVisuals(); return;
    }
    selectionSet.clear(); selectionSet.add(id); lastClickedCell = id; focusedCell = id; refreshSelectionVisuals();
  }

  function refreshSelectionVisuals(){
    sheetTable.querySelectorAll('.cell').forEach(d => { d.classList.remove('selected'); });
    selectionSet.forEach(id => {
      const el = sheetTable.querySelector(`.cell[data-cell="${id}"]`);
      if (el) el.classList.add('selected');
    });
    // update formula bar
    if (focusedCell) {
      const sheet = workbook.sheets[workbook.active];
      const c = sheet.data[focusedCell];
      formulaEl.value = c ? (c.expr !== undefined ? c.expr : (c.value !== undefined ? String(c.value) : '')) : '';
      cellFormatSel.value = (c && c.format) ? c.format : 'auto';
    } else {
      formulaEl.value = '';
    }
  }

  /* ---------- Formatting applyers ---------- */
  function applyAlignmentToSelection(align){
    const sheet = workbook.sheets[workbook.active];
    if (selectionSet.size){
      selectionSet.forEach(id => {
        const cell = sheet.data[id] || { expr:'', value:'' };
        cell.style = cell.style || { wrap: WRAP_DEFAULT, align:'left' };
        cell.style.align = align; sheet.data[id] = cell;
      });
    } else if (focusedCell){
      const cell = sheet.data[focusedCell] || { expr:'', value:'' };
      cell.style = cell.style || { wrap: WRAP_DEFAULT, align:'left' };
      cell.style.align = align; sheet.data[focusedCell] = cell;
    }
    saveWorkbook(); refreshGrid();
  }

  function applyWrapToSelection(wrap){
    const sheet = workbook.sheets[workbook.active];
    if (selectionSet.size){
      selectionSet.forEach(id => { const cell = sheet.data[id] || { expr:'', value:'' }; cell.style = cell.style || { wrap: WRAP_DEFAULT, align:'left' }; cell.style.wrap = wrap; sheet.data[id] = cell; });
    } else if (focusedCell){
      const cell = sheet.data[focusedCell] || { expr:'', value:'' }; cell.style = cell.style || { wrap: WRAP_DEFAULT, align:'left' }; cell.style.wrap = wrap; sheet.data[focusedCell] = cell;
    }
    saveWorkbook(); refreshGrid();
  }

  function toggleStyleForSelection(prop){
    const sheet = workbook.sheets[workbook.active];
    if (selectionSet.size){
      selectionSet.forEach(id => { const cell = sheet.data[id] || { expr:'', value:'' }; cell.style = cell.style || { wrap: WRAP_DEFAULT, align:'left' }; cell.style[prop] = !cell.style[prop]; sheet.data[id] = cell; });
    } else if (focusedCell){
      const cell = sheet.data[focusedCell] || { expr:'', value:'' }; cell.style = cell.style || { wrap: WRAP_DEFAULT, align:'left' }; cell.style[prop] = !cell.style[prop]; sheet.data[focusedCell] = cell;
    }
    saveWorkbook(); refreshGrid();
  }

  /* ---------- Cell events ---------- */
  function onCellFocus(div){ focusedCell = div.dataset.cell; lastClickedCell = focusedCell; const sheet = workbook.sheets[workbook.active]; const c = sheet.data[focusedCell]; formulaEl.value = c ? (c.expr !== undefined ? c.expr : (c.value !== undefined ? String(c.value) : '')) : ''; cellFormatSel.value = (c && c.format) ? c.format : 'auto'; if (!selectionSet.has(focusedCell)) { selectionSet.clear(); selectionSet.add(focusedCell); } refreshSelectionVisuals(); }
  function onCellBlur(div){ commitCellEdit(div.dataset.cell, div.innerText); }
  function onCellInput(div){ /* lightweight */ }

  function onCellKeyDown(e){
    const div = e.target; const id = div.dataset.cell;
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); commitCellEdit(id, div.innerText); const p = parseCellId(id); if(!p) return; const [col,row]=p; const next = `${col}${row+1}`; const el = sheetTable.querySelector(`.cell[data-cell="${next}"]`); if (el) el.focus(); return; }
    if (e.key === 'Tab'){ e.preventDefault(); commitCellEdit(id, div.innerText); const p=parseCellId(id); if(!p) return; const [col,row]=p; const nextCol = nameToCol(col)+1; const next = `${colToName(clamp(nextCol,0, workbook.sheets[workbook.active].COLS-1))}${row}`; const el=sheetTable.querySelector(`.cell[data-cell="${next}"]`); if(el) el.focus(); return; }
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){ e.preventDefault(); commitCellEdit(id, div.innerText); const p = parseCellId(id); if(!p) return; let col=nameToCol(p[0]), row=p[1]; if (e.key==='ArrowUp') row = Math.max(1,row-1); if (e.key==='ArrowDown') row = Math.min(workbook.sheets[workbook.active].ROWS, row+1); if (e.key==='ArrowLeft') col = Math.max(0,col-1); if (e.key==='ArrowRight') col = Math.min(workbook.sheets[workbook.active].COLS-1, col+1); const next = `${colToName(col)}${row}`; const el = sheetTable.querySelector(`.cell[data-cell="${next}"]`); if (el) el.focus(); return; }
  }

  /* ---------- Commit edit ---------- */
  function commitCellEdit(id, raw){
    const sheet = workbook.sheets[workbook.active];
    const prev = sheet.data[id] ? JSON.parse(JSON.stringify(sheet.data[id])) : null;
    raw = raw.replace(/\r/g,'').replace(/\n+$/,'');
    if (raw === ''){
      if (prev){ delete sheet.data[id]; saveWorkbook(); refreshGrid(); }
      return;
    }
    const existingStyle = (sheet.data[id] && sheet.data[id].style) ? sheet.data[id].style : { wrap: WRAP_DEFAULT, align:'left' };
    let newCell;
    if (raw.startsWith('=')) newCell = { expr: raw, value: null, format:(sheet.data[id] && sheet.data[id].format) || 'auto', style: existingStyle };
    else { const n = parseFloat(raw); if (!isNaN(n) && String(n) === raw.trim()) newCell = { expr: raw, value: n, format:(sheet.data[id] && sheet.data[id].format) || 'number', style: existingStyle }; else newCell = { expr: raw, value: raw, format:(sheet.data[id] && sheet.data[id].format) || 'text', style: existingStyle }; }
    sheet.data[id] = newCell;
    saveWorkbook(); refreshGrid();
  }

  /* ---------- Recalc engine (minimal) ---------- */
  function recalcAll(sheet){
    const cache = {}, visiting = new Set();
    const evalCell = (id) => {
      if (cache.hasOwnProperty(id)) return cache[id];
      const c = sheet.data[id];
      if (!c || !c.expr || !c.expr.startsWith('=')) { const v = c ? c.value : ''; cache[id] = v; return v; }
      if (visiting.has(id)) { cache[id] = '#CYCLE'; return cache[id]; }
      visiting.add(id);
      try { const expr = c.expr.slice(1); const val = evalExpression(expr, sheet, evalCell); cache[id] = val; } catch(e){ cache[id] = '#ERR'; }
      visiting.delete(id); return cache[id];
    };
    Object.keys(sheet.data).forEach(id => { if (sheet.data[id].expr && sheet.data[id].expr.startsWith('=')) evalCell(id); });
    Object.keys(sheet.data).forEach(id => { const cc = sheet.data[id]; if (cc && cc.expr && cc.expr.startsWith('=')) cc.value = cache.hasOwnProperty(id) ? cache[id] : '#ERR'; });
  }

  function evalExpression(expr, sheet, resolveRef){
    // basic: support SUM/AVG/COUNT and direct cell refs; this is intentionally simple and sandboxed
    const withFuncs = expr.replace(/\bSUM\s*\(([^)]*)\)/ig, (m,a) => { const vals = parseArgsToValues(a,sheet,resolveRef); return String(vals.reduce((s,v)=>s + (isNaN(v)||v===''?0:parseFloat(v)),0)); });
    const replacedRefs = withFuncs.replace(/([A-Z]+[0-9]+)/g, (m) => { const v = resolveRef ? resolveRef(m) : (sheet.data[m] ? sheet.data[m].value : '0'); return (v===undefined||v===null||v==='') ? '0' : String(v); });
    try { return (new Function(`return (${replacedRefs});`))(); } catch(e) { return '#ERR'; }
  }
  function parseArgsToValues(argStr,sheet,resolveRef){ return argStr.split(',').map(s=>s.trim()).filter(Boolean).flatMap(p => { if (p.includes(':')) return (rangeToCells(p) || []).map(id => resolveRef ? resolveRef(id) : (sheet.data[id] ? sheet.data[id].value : '')); if (/^[A-Z]+[0-9]+$/.test(p)) return [ resolveRef ? resolveRef(p) : (sheet.data[p] ? sheet.data[p].value : '') ]; const n = parseFloat(p); return isNaN(n) ? [p] : [n]; }); }

  /* ---------- refresh grid ---------- */
  function refreshGrid(){
    const sheet = workbook.sheets[workbook.active];
    recalcAll(sheet);
    sheetTable.querySelectorAll('.cell').forEach(div => {
      const id = div.dataset.cell; const obj = sheet.data[id]; div.textContent = obj ? displayValue(obj) : ''; applyStyleToCellDiv(div, obj, sheet, parseCellId(id)[1]);
    });
    saveWorkbook();
    refreshSelectionVisuals();
  }

  /* ---------- CSV / import / export (minimal) ---------- */
  function exportCSV(){
    const sheet = workbook.sheets[workbook.active]; const rows = [];
    for (let r=1;r<=sheet.ROWS;r++){ const cols = []; for (let c=0;c<sheet.COLS;c++){ const id = `${colToName(c)}${r}`; const cell = sheet.data[id]; const val = cell ? (cell.value !== undefined ? cell.value : (cell.expr !== undefined ? cell.expr : '')) : ''; const s = (val===null||val===undefined) ? '' : String(val); cols.push(s.includes(',')||s.includes('"')? `"${s.replace(/"/g,'""')}"` : s); } rows.push(cols.join(',')); } const blob = new Blob([rows.join('\n')], { type:'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${workbook.sheets[workbook.active].name}.csv`; a.click();
  }
  function importCSVFile(file){
    const r = new FileReader(); r.onload = (e) => { parseCSVToData(e.target.result); }; r.readAsText(file);
  }
  function parseCSVToData(text){
    const lines = text.split(/\r?\n/); const sheet = workbook.sheets[workbook.active];
    sheet.COLS = Math.max(sheet.COLS, Math.max(...lines.map(l=>l.split(',').length))); sheet.ROWS = Math.max(sheet.ROWS, lines.length);
    for (let r=0;r<lines.length;r++){ const parts = parseCSVLine(lines[r]); for (let c=0;c<parts.length;c++){ const id = `${colToName(c)}${r+1}`; const txt = parts[c]; if (txt && txt.startsWith('=')) sheet.data[id] = { expr: txt, value:null, style:{wrap:WRAP_DEFAULT, align:'left'} }; else { const n = parseFloat(txt); if (!isNaN(n) && String(n) === txt.trim()) sheet.data[id] = { expr: txt, value:n, format:'number', style:{wrap:WRAP_DEFAULT, align:'left'} }; else sheet.data[id] = { expr: txt, value: txt, format:'text', style:{wrap:WRAP_DEFAULT, align:'left'} }; } } }
    buildGrid(); refreshGrid();
  }
  function parseCSVLine(line){
    const res = []; let cur='', inQuotes=false;
    for (let i=0;i<line.length;i++){ const ch=line[i]; if (ch==='"'){ if (inQuotes && line[i+1]==='"'){ cur+='"'; i++; continue; } inQuotes=!inQuotes; continue; } if (ch===',' && !inQuotes){ res.push(cur); cur=''; continue; } cur += ch; }
    res.push(cur); return res;
  }

  /* ---------- Freeze/sticky (first column) ---------- */
  function applyFreezeSticky(){
    sheetTable.querySelectorAll('td').forEach(td => td.classList.remove('sticky-col'));
    sheetTable.querySelectorAll('td[data-col="0"]').forEach(td => td.classList.add('sticky-col'));
  }

  /* ---------- Toolbar helpers (apply alignment/wrap/style) ---------- */
  function applyAlignmentToSelection(align){
    const sheet = workbook.sheets[workbook.active];
    if (selectionSet.size){
      selectionSet.forEach(id => { const cell = sheet.data[id] || { expr:'', value:'' }; cell.style = cell.style || {wrap:WRAP_DEFAULT, align:'left'}; cell.style.align = align; sheet.data[id] = cell; });
    } else if (focusedCell){
      const cell = sheet.data[focusedCell] || { expr:'', value:'' }; cell.style = cell.style || {wrap:WRAP_DEFAULT, align:'left'}; cell.style.align = align; sheet.data[focusedCell] = cell;
    }
    saveWorkbook(); refreshGrid();
  }
  function applyWrapToSelection(wrap){ const sheet = workbook.sheets[workbook.active]; if (selectionSet.size){ selectionSet.forEach(id => { const cell = sheet.data[id] || { expr:'', value:'' }; cell.style = cell.style || {wrap:WRAP_DEFAULT, align:'left'}; cell.style.wrap = wrap; sheet.data[id] = cell; }); } else if (focusedCell){ const cell = sheet.data[focusedCell] || { expr:'', value:'' }; cell.style = cell.style || {wrap:WRAP_DEFAULT, align:'left'}; cell.style.wrap = wrap; sheet.data[focusedCell] = cell; } saveWorkbook(); refreshGrid(); }
  function toggleStyleForSelection(prop){ const sheet = workbook.sheets[workbook.active]; if (selectionSet.size){ selectionSet.forEach(id => { const cell = sheet.data[id] || { expr:'', value:'' }; cell.style = cell.style || {wrap:WRAP_DEFAULT, align:'left'}; cell.style[prop] = !cell.style[prop]; sheet.data[id] = cell; }); } else if (focusedCell){ const cell = sheet.data[focusedCell] || { expr:'', value:'' }; cell.style = cell.style || {wrap:WRAP_DEFAULT, align:'left'}; cell.style[prop] = !cell.style[prop]; sheet.data[focusedCell] = cell; } saveWorkbook(); refreshGrid(); }

  /* ---------- Reorder columns (preserve data) ---------- */
  function reorderColumns(from, to){
    if (from === to) return;
    const sheet = workbook.sheets[workbook.active];
    const ccount = sheet.COLS;
    const newData = {};
    for (let r=1;r<=sheet.ROWS;r++){
      for (let c=0;c<ccount;c++){
        const src = `${colToName(c)}${r}`;
        let destIndex = c;
        if (c === from) destIndex = to;
        else if (from < to && c>from && c<=to) destIndex = c-1;
        else if (from > to && c>=to && c<from) destIndex = c+1;
        const dest = `${colToName(destIndex)}${r}`;
        if (sheet.data[src]) newData[dest] = sheet.data[src];
      }
    }
    const newWidths = {};
    for (let c=0;c<ccount;c++){
      let srcIndex = c;
      if (c === from) srcIndex = to;
      else if (from < to && c>from && c<=to) srcIndex = c-1;
      else if (from > to && c>=to && c<from) srcIndex = c+1;
      if (sheet.colWidths && sheet.colWidths[srcIndex]) newWidths[c] = sheet.colWidths[srcIndex];
    }
    sheet.colWidths = newWidths; sheet.data = newData;
    buildGrid(); refreshGrid();
  }

  /* ---------- Init wiring & buttons ---------- */
  function wireUI(){
    // menu buttons
    addSheetBtn.addEventListener('click', ()=> { const sname = prompt('Sheet name', 'Sheet' + (workbook.sheets.length+1)); const s = createBlankSheet(sname || ('Sheet' + (workbook.sheets.length+1)), 15, 40); workbook.sheets.push(s); workbook.active = workbook.sheets.length-1; clearSelection(); persistAndRender(); });
    exportWorkbookBtn && exportWorkbookBtn.addEventListener && exportWorkbookBtn.addEventListener('click', ()=> exportWorkbook());
    importWorkbookBtn && importWorkbookBtn.addEventListener && importWorkbookBtn.addEventListener('click', ()=> importWorkbookInput.click());
    importWorkbookInput && (importWorkbookInput.onchange = (e) => { const f = e.target.files[0]; e.target.value=null; if (f) importWorkbook(f); });

    undoBtn.addEventListener('click', ()=> undo());
    redoBtn.addEventListener('click', ()=> redo());
    saveBtn.addEventListener('click', ()=> { saveWorkbook(); alert('Saved to localStorage'); });

    importCsvBtn && importCsvBtn.addEventListener && importCsvBtn.addEventListener('click', ()=> csvFile.click());
    csvFile && (csvFile.onchange = (e) => { const f = e.target.files[0]; e.target.value=null; if (f) importCSVFile(f); });
    exportCsvBtn.addEventListener('click', ()=> exportCSV());

    resizeBtn.addEventListener('click', () => {
      const sheet = workbook.sheets[workbook.active];
      const newCols = clamp(parseInt(colCountEl.value,10) || sheet.COLS, 1, 52);
      const newRows = clamp(parseInt(rowCountEl.value,10) || sheet.ROWS, 1, 2000);
      const toDelete = [];
      Object.keys(sheet.data).forEach(k => { const p = parseCellId(k); if (!p) return; const ci = nameToCol(p[0]), ri = p[1]; if (ci >= newCols || ri > newRows) toDelete.push(k); });
      if (toDelete.length > 0){ if (!confirm(`Resizing to ${newCols} x ${newRows} will delete ${toDelete.length} saved cell(s). Proceed?`)) return; toDelete.forEach(k => delete sheet.data[k]); }
      const newW = {}; for (let c=0;c<newCols;c++) if (sheet.colWidths && sheet.colWidths[c]) newW[c] = sheet.colWidths[c];
      sheet.colWidths = newW; sheet.COLS = newCols; sheet.ROWS = newRows; saveWorkbook(); buildGrid(); refreshGrid();
    });

    cellFormatSel && (cellFormatSel.onchange = ()=> { if (!focusedCell) return; const sheet = workbook.sheets[workbook.active]; const c = sheet.data[focusedCell] || {}; c.format = cellFormatSel.value; sheet.data[focusedCell] = c; refreshGrid(); });

    // formula bar enter to set cell
    formulaEl && (formulaEl.addEventListener('keydown', (e)=> {
      if (e.key === 'Enter') { e.preventDefault(); if (!focusedCell) return; const txt = formulaEl.value; const cellEl = sheetTable.querySelector(`.cell[data-cell="${focusedCell}"]`); if (cellEl){ cellEl.textContent = txt; commitCellEdit(focusedCell, txt); cellEl.focus(); } }
    }));

    // theme toggle
    toggleThemeBtn && (toggleThemeBtn.addEventListener('click', ()=> {
      document.documentElement.classList.toggle('light'); localStorage.setItem('minisheet_theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
    }));
    if (localStorage.getItem('minisheet_theme') === 'light') document.documentElement.classList.add('light');
  }

  /* ---------- Undo/redo minimal ---------- */
  function pushUndo(item){ undoStack.push(item); if (undoStack.length>500) undoStack.shift(); redoStack=[]; updateUndoRedoUI(); }
  function undo(){ const it = undoStack.pop(); if (!it) return; const s = workbook.sheets.find(ss=>ss.id===it.sheetId); if (!s) return; if (!it.prev) delete s.data[it.id]; else s.data[it.id] = it.prev; redoStack.push(it); refreshGrid(); updateUndoRedoUI(); }
  function redo(){ const it = redoStack.pop(); if (!it) return; const s = workbook.sheets.find(ss=>ss.id===it.sheetId); if (!s) return; if (!it.next) delete s.data[it.id]; else s.data[it.id] = it.next; undoStack.push(it); refreshGrid(); updateUndoRedoUI(); }
  function updateUndoRedoUI(){ undoBtn.disabled = !undoStack.length; redoBtn.disabled = !redoStack.length; }

  /* ---------- Export / import workbook ---------- */
  function exportWorkbook(){
    const payload = { exportedAt: new Date().toISOString(), workbook };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${workbook.name || 'workbook'}.json`; a.click();
  }
  function importWorkbook(file){
    const r = new FileReader(); r.onload = (e)=> { try { const obj = JSON.parse(e.target.result); if (obj && obj.workbook) workbook = obj.workbook; else if (obj.sheets) workbook = obj; else workbook = { id: uid('wb'), name: obj.name||'Imported', sheets: obj.sheets||[createBlankSheet()], active: 0 }; persistAndRender(); alert('Imported'); } catch(err){ alert('Import failed: ' + err.message); } }; r.readAsText(file);
  }

  /* ---------- Init & render ---------- */
  function persistAndRender(){ saveWorkbook(); renderEverything(); }
  function renderEverything(){ renderSheetsList(); buildGrid(); refreshGrid(); }

  /* ---------- Apply freeze/ sticky ---------- */
  function applyFreezeSticky(){ sheetTable.querySelectorAll('td').forEach(td => td.classList.remove('sticky-col')); sheetTable.querySelectorAll('td[data-col="0"]').forEach(td => td.classList.add('sticky-col')); }

  /* ---------- Init DOM after ready ---------- */
  document.addEventListener('DOMContentLoaded', ()=> {
    // populate DOM references via safeGet
    sheetsListEl = safeGet('#sheetsList'); addSheetBtn = safeGet('#addSheetBtn'); exportWorkbookBtn = safeGet('#exportWorkbookBtn');
    importWorkbookInput = safeGet('#importWorkbookInput'); importWorkbookBtn = safeGet('#importWorkbookBtn');
    sheetTable = safeGet('#sheet'); gridViewport = safeGet('#gridViewport'); formulaEl = safeGet('#formula');
    colCountEl = safeGet('#colCount'); rowCountEl = safeGet('#rowCount'); resizeBtn = safeGet('#resizeBtn');
    undoBtn = safeGet('#undoBtn'); redoBtn = safeGet('#redoBtn'); saveBtn = safeGet('#saveBtn');
    csvFile = safeGet('#csvFile'); importCsvBtn = safeGet('#importCsvBtn'); exportCsvBtn = safeGet('#exportCsvBtn'); cellFormatSel = safeGet('#cellFormat'); toggleThemeBtn = safeGet('#toggleTheme');

    // load data
    loadWorkbook();
    // create toolbar in container
    const toolbarContainer = safeGet('#toolbarContainer');
    createToolbar(toolbarContainer);

    // wire UI
    wireUI();

    // final render
    persistAndRender();

    // ensure grid viewport top spacing matches toolbar height (prevent visual overlap)
    const adjustTop = () => {
      const toolbar = toolbarContainer;
      if (!toolbar || !gridViewport) return;
      const rect = toolbar.getBoundingClientRect();
      // not absolute positioned; small safety: ensure gridViewport visible space
      // no CSS change required here since layout flow handles it; but we make sure it doesn't overlap
      // (this is a no-op but kept for future adjustments)
    };
    window.addEventListener('resize', adjustTop);
    adjustTop();
  });

  /* expose (debug) */
  window.MINISHEET = { get workbook(){ return workbook; }, saveWorkbook, loadWorkbook, refreshGrid };
})();
