/* app.js — Excel-Pro client-side spreadsheet
   - Single-file implementation (vanilla JS + DOM)
   - Persisted to localStorage as 'minisheet_v4'
   - Filter UI F1 implemented (checklist + search)
   - Column/Row resizing with guides and double-click auto-fit
   - Excel-Exact Insert Table with style preview dropdown
   - Excel-Exact Borders menu (All, Outside, Inside, etc.)
*/

(() => {
  "use strict";

  const STORAGE_KEY = 'minisheet_v4';
  const A_CHAR = 'A'.charCodeAt(0);

  /* ---------- helpers ---------- */
  const uid = (p='id') => `${p}_${Math.random().toString(36).slice(2,8)}`;
  const colName = i => String.fromCharCode(A_CHAR + i);
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const parseCell = id => {
    const m = id.match(/^([A-Z]+)(\d+)$/); if (!m) return null;
    return [m[1], parseInt(m[2],10)];
  };
  const escapeHtml = s => String(s || '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));

  /* ---------- state ---------- */
  let workbook = null;
  let activeSheetIndex = 0;
  let selection = { cells: new Set(), anchor: null };
  let focused = null;
  let templates = [];
  let isDraggingCol = false, dragColInfo = null;
  let isDraggingRow = false, dragRowInfo = null;

  /* ---------- DOM refs ---------- */
  const refs = {};
  function $id(n){ return document.getElementById(n); }

  /* ---------- default workbook ---------- */
  function createSheet(name='Sheet1', cols=10, rows=40){
    return {
      id: uid('s'),
      name,
      COLS: cols,
      ROWS: rows,
      data: {},
      colWidths: {},
      rowHeights: {},
      tables: [],
      filters: {},
      rowFills: {},
    };
  }
  function createWorkbook(){ return { name:'Workbook', sheets:[ createSheet('Sheet1') ], active:0 }; }

  /* ---------- storage ---------- */
  function save(){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(workbook)); } catch(e) { console.error('save failed', e); } }
  function load(){
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw){ workbook = createWorkbook(); save(); return; }
    try { workbook = JSON.parse(raw); if (!workbook.sheets || !workbook.sheets.length) workbook = createWorkbook(); } catch(e){ workbook = createWorkbook(); }
  }

  /* ---------- UI init ---------- */
  function initDOM(){
    ['sheetTable','viewport','guideV','guideH','filterModal','contextMenu','workbookName','sheetList','addSheet','exportWB','importWB','colCount','rowCount','resizeGrid','saveWB','undo','redo','insertTable','filterToggle','alignBtn','wrapBtn','boldBtn','italicBtn','underlineBtn','borderBtn','fillBtn','themeToggle','formulaInput','formatSel','exportCSV','fileImport','insertTableDropdown','borderDropdown'].forEach(id=>{
      refs[id] = $id(id);
    });
  }

  /* ---------- render sheet list & grid ---------- */
  function renderSheetList(){
    refs.sheetList.innerHTML = '';
    workbook.sheets.forEach((s,idx)=>{
      const b = document.createElement('div');
      b.className = 'rbtn';
      b.style.display='flex'; b.style.justifyContent='space-between'; b.style.alignItems='center';
      const left = document.createElement('div'); left.textContent = s.name; left.style.fontWeight='700';
      const right = document.createElement('div');
      const edit = document.createElement('button'); edit.className='rbtn'; edit.style.padding='4px 6px'; edit.textContent='Edit';
      const del = document.createElement('button'); del.className='rbtn'; del.style.padding='4px 6px'; del.textContent='Delete';
      right.appendChild(edit); right.appendChild(del);
      b.appendChild(left); b.appendChild(right);
      b.onclick = (e)=> { 
        if (e.target===edit){ 
          const newName = prompt('Sheet name', s.name); 
          if (newName) s.name = newName; 
          save(); renderSheetList(); renderGrid(); 
        } else if (e.target===del) {
          if (workbook.sheets.length===1){ alert('Need at least one sheet'); return; } 
          if (confirm(`Delete ${s.name}?`)){ workbook.sheets.splice(idx,1); workbook.active = Math.max(0, workbook.active-1); save(); renderSheetList(); renderGrid(); }
        } else {
          workbook.active = idx; save(); renderGrid(); 
        }
      };
      refs.sheetList.appendChild(b);
    });
  }

  function buildEmptyTableHeader(sheet){
    const tr = document.createElement('tr');
    const corner = document.createElement('th'); corner.className='rowHead'; corner.textContent = ''; tr.appendChild(corner);
    for (let c=0;c<sheet.COLS;c++){
      const th = document.createElement('th'); th.className='header'; th.dataset.col = c;
      th.style.position='relative';
      const inner = document.createElement('div'); inner.style.display='flex'; inner.style.alignItems='center'; inner.style.justifyContent='center';
      inner.innerHTML = `<span style="font-weight:700">${colName(c)}</span>`;
      const ficon = document.createElement('span'); ficon.className='filter-icon'; ficon.textContent='Filter'; ficon.dataset.col = c;
      inner.appendChild(ficon);
      th.appendChild(inner);
      // resizer
      const resize = document.createElement('div'); resize.className='resize-handle'; resize.dataset.col = c;
      th.appendChild(resize);
      // apply saved width
      if(sheet.colWidths[c]) th.style.width = sheet.colWidths[c] + 'px';
      tr.appendChild(th);
    }
    return tr;
  }

  function renderGrid(){
    const sheet = workbook.sheets[workbook.active];
    refs.workbookName.value = workbook.name || '';
    refs.colCount.value = sheet.COLS; refs.rowCount.value = sheet.ROWS;

    refs.sheetTable.innerHTML = '';

    // header
    const thead = document.createElement('thead');
    thead.appendChild(buildEmptyTableHeader(sheet));
    refs.sheetTable.appendChild(thead);

    // body
    const tbody = document.createElement('tbody');
    for (let r=1; r<=sheet.ROWS; r++){
      const tr = document.createElement('tr');
      const rh = document.createElement('th'); rh.className='rowHead'; rh.textContent = r; rh.style.position='relative';
      const rrHandle = document.createElement('div'); rrHandle.className='row-resize-handle'; rrHandle.dataset.row = r;
      rh.appendChild(rrHandle);
      tr.appendChild(rh);

      for (let c=0; c<sheet.COLS; c++){
        const td = document.createElement('td'); td.className='cell'; td.dataset.row=r; td.dataset.col=c; 
        const id = `${colName(c)}${r}`;
        const cellObj = sheet.data[id];
        const txt = cellObj ? (cellObj.expr || cellObj.value || '') : '';

        const div = document.createElement('div');
        div.contentEditable = true;
        div.className = 'cell-div';
        div.dataset.cell = id;
        div.style.padding = '6px 8px';
        div.style.minHeight = '20px';
        div.textContent = txt;

        // Apply styles (ENHANCED FOR BORDERS)
        if (cellObj && cellObj.style){
          if (cellObj.style.bold) div.style.fontWeight='700';
          if (cellObj.style.italic) div.style.fontStyle='italic';
          if (cellObj.style.underline) div.style.textDecoration='underline';
          if (cellObj.style.align) div.style.textAlign = cellObj.style.align;
          if (cellObj.style.wrap) div.style.whiteSpace='normal'; else div.style.whiteSpace='nowrap';
          if(cellObj.style.fill) div.style.background = cellObj.style.fill;
          // Border styles
          if(cellObj.style.border) div.style.border = cellObj.style.border;
          if(cellObj.style.borderTop) div.style.borderTop = cellObj.style.borderTop;
          if(cellObj.style.borderBottom) div.style.borderBottom = cellObj.style.borderBottom;
          if(cellObj.style.borderLeft) div.style.borderLeft = cellObj.style.borderLeft;
          if(cellObj.style.borderRight) div.style.borderRight = cellObj.style.borderRight;
        } else {
          div.style.whiteSpace='nowrap';
        }
        if (sheet.rowFills[r]) div.style.background = sheet.rowFills[r];

        // Apply saved width/height
        if (sheet.colWidths[c]) td.style.width = sheet.colWidths[c] + 'px';
        if (sheet.rowHeights[r]) td.style.height = sheet.rowHeights[r] + 'px';

        // Append first, then attach listeners
        td.appendChild(div);

        // Now safely attach event listeners
        div.addEventListener('focus', () => {
          focused = id;
          selection.cells.clear();
          selection.cells.add(id);
          updateFormula();
          refreshSelection();
        });

        div.addEventListener('blur', () => {
          commitEdit(id, div.innerText);
          save();
        });

        div.addEventListener('keydown', (e) => handleCellKeyDown(e, id));

        div.addEventListener('contextmenu', (ev) => {
          ev.preventDefault();
          openContextMenu(ev, r, c);
        });

        tr.appendChild(td);
      }

      // zebra
      if (sheet.tables.some(t => r >= t.startR && r <= t.endR && t.zebra)) {
        tr.classList.add('zebra');
      } else if (r % 2 === 0) {
        tr.classList.add('zebra');
      }
      tbody.appendChild(tr);
    }
    refs.sheetTable.appendChild(tbody);

    attachColumnResizers();
    attachRowResizers();
    attachFilterIcons();
    outlineTables();
    refreshSelection();
    applyAllFiltersIfAny();
  }

  /* ---------- attach resizers ---------- */
  function attachColumnResizers(){
    refs.sheetTable.querySelectorAll('.resize-handle').forEach(h=>{
      h.onmousedown = (e)=> { e.preventDefault(); startColumnDrag(e, +h.dataset.col); };
      h.ondblclick = (e)=> { autoFitColumn(+h.dataset.col); };
    });
  }
  function attachRowResizers(){
    refs.sheetTable.querySelectorAll('.row-resize-handle').forEach(h=>{
      h.onmousedown = (e)=> { e.preventDefault(); startRowDrag(e, +h.dataset.row); };
      h.ondblclick = (e)=> { autoFitRow(+h.dataset.row); };
    });
  }
  function attachFilterIcons() {
    if (!refs.sheetTable) return;
    refs.sheetTable.querySelectorAll('.filter-icon').forEach(icon => {
      icon.onclick = e => {
        e.stopPropagation();
        const col = +icon.dataset.col;
        showFilterModal(col);
      };
    });
  }
  function showFilterModal(col) {
    const sheet = workbook.sheets[workbook.active];
    const values = new Set();
    for (let r=1; r<=sheet.ROWS; r++) {
      const id = `${colName(col)}${r}`;
      const cell = sheet.data[id];
      if (cell && cell.value) values.add(String(cell.value));
    }
    const modal = refs.filterModal;
    modal.innerHTML = '';
    const title = document.createElement('h3');
    title.textContent = `Filter ${colName(col)}`;
    modal.appendChild(title);

    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Search…';
    search.className = 'rinput';
    modal.appendChild(search);

    const list = document.createElement('div');
    list.style.maxHeight = '200px';
    list.style.overflowY = 'auto';
    modal.appendChild(list);

    const all = new Set(values);
    function render() {
      list.innerHTML = '';
      const term = search.value.toLowerCase();
      all.forEach(v => {
        if (term && !v.toLowerCase().includes(term)) return;
        const lbl = document.createElement('label');
        lbl.style.display = 'block';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        const active = sheet.filters[col] && sheet.filters[col].has(v);
        chk.checked = active !== false;
        chk.onchange = () => {
          if (!sheet.filters[col]) sheet.filters[col] = new Set();
          if (chk.checked) sheet.filters[col].add(v);
          else sheet.filters[col].delete(v);
          if (sheet.filters[col].size === 0) delete sheet.filters[col];
          save(); applyAllFiltersIfAny();
        };
        lbl.appendChild(chk);
        lbl.appendChild(document.createTextNode(' ' + v));
        list.appendChild(lbl);
      });
    }
    search.oninput = render;
    render();

    const btns = document.createElement('div');
    btns.style.marginTop = '8px';
    const ok = document.createElement('button');
    ok.textContent = 'OK';
    ok.className = 'rbtn';
    ok.onclick = () => { modal.style.display='none'; };
    btns.appendChild(ok);
    const clear = document.createElement('button');
    clear.textContent = 'Clear';
    clear.className = 'rbtn';
    clear.onclick = () => {
      delete sheet.filters[col];
      save(); applyAllFiltersIfAny(); render();
    };
    btns.appendChild(clear);
    modal.appendChild(btns);

    modal.style.display = 'block';
    modal.style.left = '50%';
    modal.style.top = '50%';
    modal.style.transform = 'translate(-50%, -50%)';
  }

  function applyAllFiltersIfAny() {
    const sheet = workbook.sheets[workbook.active];
    const filters = Object.entries(sheet.filters || {});
    if (!filters.length || !refs.sheetTable) {
      refs.sheetTable?.querySelectorAll('tr').forEach(tr=>tr.style.display='');
      return;
    }

    for (let r=1; r<=sheet.ROWS; r++) {
      const tr = refs.sheetTable.querySelector(`tbody tr:nth-child(${r})`);
      if (!tr) continue;
      let show = true;
      filters.forEach(([colStr, set]) => {
        const col = +colStr;
        const id = `${colName(col)}${r}`;
        const cell = sheet.data[id];
        const val = cell ? String(cell.value) : '';
        if (!set.has(val)) show = false;
      });
      tr.style.display = show ? '' : 'none';
    }
  }

  function outlineTables() {
    if (!refs.sheetTable) return;
    const sheet = workbook.sheets[workbook.active];
    sheet.tables.forEach(t => {
      for (let r=t.startR; r<=t.endR; r++) {
        for (let c=t.startC; c<=t.endC; c++) {
          const div = refs.sheetTable.querySelector(`[data-cell="${colName(c)}${r}"]`);
          if (div) div.parentElement.classList.add('table-outline');
        }
      }
    });
  }

  /* ---------- column drag handlers ---------- */
  function startColumnDrag(e, colIndex){
    const sheet = workbook.sheets[workbook.active];
    isDraggingCol = true;
    const th = e.target.closest('th');
    const startX = e.clientX;
    const startW = th ? th.getBoundingClientRect().width : 100;

    refs.guideV.style.display = 'block';
    refs.guideV.style.left = th.getBoundingClientRect().right + 'px';

    dragColInfo = { colIndex, startX, startW };

    function onMove(ev){ refs.guideV.style.left = ev.clientX + 'px'; }

    function onUp(ev){
      const delta = ev.clientX - dragColInfo.startX;
      const newW = Math.max(36, Math.round(dragColInfo.startW + delta));

      sheet.colWidths[dragColInfo.colIndex] = newW;

      refs.guideV.style.display='none';
      isDraggingCol = false;
      dragColInfo = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      save(); renderGrid();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /* ---------- row drag ---------- */
  function startRowDrag(e, rowIndex){
    const sheet = workbook.sheets[workbook.active];
    isDraggingRow = true;
    const startY = e.clientY;
    const startH = sheet.rowHeights[rowIndex] || 24;

    refs.guideH.style.display='block';
    refs.guideH.style.top = e.clientY + 'px';

    dragRowInfo = { rowIndex, startY, startH };

    function onMove(ev){ refs.guideH.style.top = ev.clientY + 'px'; }
    function onUp(ev){
      const delta = ev.clientY - dragRowInfo.startY;
      const newH = Math.max(18, Math.round(dragRowInfo.startH + delta));
      sheet.rowHeights[dragRowInfo.rowIndex] = newH;
      refs.guideH.style.display='none';
      isDraggingRow = false;
      dragRowInfo = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      save(); renderGrid();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /* ---------- auto-fit utilities ---------- */
  function autoFitColumn(colIndex){
    const sheet = workbook.sheets[workbook.active];
    const div = document.createElement('div'); div.style.position='absolute'; div.style.left='-9999px'; div.style.top='-9999px'; div.style.whiteSpace='nowrap'; div.style.padding='6px 8px';
    document.body.appendChild(div);
    let maxW = 36;
    div.textContent = colName(colIndex);
    maxW = Math.max(maxW, div.getBoundingClientRect().width + 22);
    const sample = Math.min(sheet.ROWS, 200);
    for (let r=1; r<=sample; r++){
      const id = `${colName(colIndex)}${r}`;
      const c = sheet.data[id];
      const txt = c ? (c.expr || c.value || '') : '';
      if (!txt) continue;
      div.textContent = String(txt);
      maxW = Math.max(maxW, div.getBoundingClientRect().width + 18);
    }
    document.body.removeChild(div);
    sheet.colWidths[colIndex] = Math.min(Math.max(36, Math.round(maxW)), 2000);
    save(); renderGrid();
  }

  function autoFitRow(rowIndex){
    const sheet = workbook.sheets[workbook.active];
    const div = document.createElement('div'); div.style.position='absolute'; div.style.left='-9999px'; div.style.top='-9999px'; div.style.width='200px'; div.style.whiteSpace='normal'; div.style.padding='6px 8px';
    document.body.appendChild(div);
    let maxH = 18;
    for (let c=0; c<sheet.COLS; c++){
      const id = `${colName(c)}${rowIndex}`;
      const cell = sheet.data[id];
      const txt = cell ? (cell.expr || cell.value || '') : '';
      div.style.width = (sheet.colWidths[c] ? sheet.colWidths[c] : 120) - 12 + 'px';
      div.textContent = txt || '';
      const h = Math.ceil(div.getBoundingClientRect().height + 8);
      maxH = Math.max(maxH, h);
    }
    document.body.removeChild(div);
    sheet.rowHeights[rowIndex] = Math.min(Math.max(18, Math.round(maxH)), 2000);
    save(); renderGrid();
  }

  /* ---------- selection ---------- */
  function refreshSelection() {
    if (!refs.sheetTable) return;
    refs.sheetTable.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    refs.sheetTable.querySelectorAll('.anchor').forEach(el => el.classList.remove('anchor'));
    selection.cells.forEach(id => {
      const div = refs.sheetTable.querySelector(`[data-cell="${id}"]`);
      if (div) div.classList.add('selected');
    });
    if (selection.anchor) {
      const div = refs.sheetTable.querySelector(`[data-cell="${selection.anchor}"]`);
      if (div) div.classList.add('anchor');
    }
  }

  /* ---------- formula bar ---------- */
  function updateFormula() {
    if (!focused || !refs.formulaInput) {
      if (refs.formulaInput) refs.formulaInput.value = '';
      return;
    }
    const sheet = workbook.sheets[workbook.active];
    const cell = sheet.data[focused];
    const txt = cell ? (cell.expr || cell.value || '') : '';
    refs.formulaInput.value = txt.startsWith('=') ? txt : `=${txt}`;
  }

  function commitEdit(id, raw, isExpr = false) {
    const sheet = workbook.sheets[workbook.active];
    const old = sheet.data[id];
    if (!raw) {
      delete sheet.data[id];
    } else {
      const val = isExpr ? evaluateExpr(raw, sheet) : raw;
      sheet.data[id] = { value: val, expr: isExpr ? raw : undefined };
    }
    renderCell(id);
    if (old || sheet.data[id]) pushUndo();
  }

  function evaluateExpr(expr, sheet) {
    try {
      const tokens = expr.replace(/([A-Z]+\d+)/g, m => {
        const cell = sheet.data[m];
        return cell && cell.value != null ? cell.value : 0;
      });
      // eslint-disable-next-line no-eval
      return eval(tokens);
    } catch (e) {
      return '#ERR';
    }
  }

  function renderCell(id) {
    const div = refs.sheetTable?.querySelector(`[data-cell="${id}"]`);
    if (!div) return;
    const sheet = workbook.sheets[workbook.active];
    const cell = sheet.data[id];
    const txt = cell ? (cell.expr || cell.value || '') : '';
    div.textContent = txt;
  }

  /* ---------- toolbar actions (ENHANCED WITH DROPDOWNS) ---------- */
  function setupToolbar() {
    const actions = {
      boldBtn: () => toggleStyle('bold'),
      italicBtn: () => toggleStyle('italic'),
      underlineBtn: () => toggleStyle('underline'),
      alignBtn: () => cycleAlign(),
      wrapBtn: () => toggleStyle('wrap'),
      fillBtn: () => applyFill(prompt('CSS color', '#ffff00') || ''),
      themeToggle: () => document.documentElement.classList.toggle('light'),
      exportCSV: () => {
        const sheet = workbook.sheets[workbook.active];
        let csv = '';
        for (let r=1; r<=sheet.ROWS; r++) {
          const row = [];
          for (let c=0; c<sheet.COLS; c++) {
            const id = `${colName(c)}${r}`;
            const cell = sheet.data[id];
            const val = cell ? (cell.expr || cell.value || '') : '';
            row.push(`"${String(val).replace(/"/g,'""')}"`);
          }
          csv += row.join(',') + '\n';
        }
        const blob = new Blob([csv], {type:'text/csv'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${sheet.name}.csv`;
        a.click();
      },
    };

    Object.entries(actions).forEach(([id, fn]) => {
      if (refs[id]) refs[id].onclick = fn;
    });

    // === INSERT TABLE DROPDOWN ===
    const insertTableBtn = refs.insertTable;
    const dropdown = refs.insertTableDropdown;
    const styleGrid = $id('tableStyleGrid');

    const tableStyles = [
      { name: "Blue Header", header: "#4472c4", body: "#d0e2ff" },
      { name: "Green Header", header: "#70ad47", body: "#e2f0d9" },
      { name: "Orange Header", header: "#ed7d31", body: "#fce4d6" },
      { name: "Gray Header", header: "#5b9bd5", body: "#d9e2f3" },
      { name: "Purple Header", header: "#7030a0", body: "#e3d9f3" },
      { name: "Red Header", header: "#c00000", body: "#f4cccc" },
    ];

    tableStyles.forEach(style => {
      const div = document.createElement('div');
      div.className = 'table-preview';
      div.innerHTML = `
        <table>
          <tr><th style="background:${style.header}">A1</th><th style="background:${style.header}">B1</th></tr>
          <tr><td style="background:${style.body}">Data</td><td style="background:${style.body}">Data</td></tr>
        </table>
        <div style="text-align:center; margin-top:4px; font-size:11px;">${style.name}</div>
      `;
      div.onclick = () => {
        insertFormattedTable(style);
        closeAllDropdowns();
      };
      styleGrid.appendChild(div);
    });

    insertTableBtn.onclick = (e) => {
      e.stopPropagation();
      closeAllDropdowns();
      const rect = insertTableBtn.getBoundingClientRect();
      dropdown.style.left = `${rect.left}px`;
      dropdown.style.top = `${rect.bottom + 4}px`;
      dropdown.style.display = 'block';
    };

    // === BORDERS DROPDOWN ===
    const borderBtn = refs.borderBtn;
    const borderDropdown = refs.borderDropdown;

    borderDropdown.querySelectorAll('.border-item').forEach(item => {
      item.onclick = () => {
        applyBorderType(item.dataset.type);
        closeAllDropdowns();
      };
    });

    borderBtn.onclick = (e) => {
      e.stopPropagation();
      closeAllDropdowns();
      const rect = borderBtn.getBoundingClientRect();
      borderDropdown.style.left = `${rect.left}px`;
      borderDropdown.style.top = `${rect.bottom + 4}px`;
      borderDropdown.style.display = 'block';
    };

    // === GLOBAL CLOSE ===
    document.addEventListener('click', closeAllDropdowns);

    function closeAllDropdowns() {
      dropdown.style.display = 'none';
      borderDropdown.style.display = 'none';
    }

    // === INSERT FORMATTED TABLE ===
    function insertFormattedTable(style) {
      if (!selection.cells.size) return alert('Select a range first');
      const cells = Array.from(selection.cells);
      const rows = new Set(), cols = new Set();
      cells.forEach(id => {
        const [c, r] = parseCell(id);
        cols.add(c); rows.add(r);
      });
      const startC = Math.min(...cols), endC = Math.max(...cols);
      const startR = Math.min(...rows), endR = Math.max(...rows);

      const sheet = workbook.sheets[workbook.active];
      const table = {
        id: uid('t'),
        startC, startR, endC, endR,
        headerColor: style.header,
        bodyColor: style.body,
        zebra: true
      };
      sheet.tables.push(table);

      // Apply header fill
      for (let c = startC; c <= endC; c++) {
        const id = `${colName(c)}${startR}`;
        const cell = sheet.data[id] || (sheet.data[id] = {});
        cell.style = cell.style || {};
        cell.style.fill = style.header;
        cell.style.bold = true;
      }

      save();
      renderGrid();
    }

    // === APPLY BORDERS ===
    function applyBorderType(type) {
      selection.cells.forEach(id => {
        const div = refs.sheetTable?.querySelector(`[data-cell="${id}"]`);
        if (!div) return;
        const cell = workbook.sheets[workbook.active].data[id] || (workbook.sheets[workbook.active].data[id] = {});
        cell.style = cell.style || {};

        // Reset all
        div.style.border = '';
        div.style.borderTop = '';
        div.style.borderBottom = '';
        div.style.borderLeft = '';
        div.style.borderRight = '';

        if (type === 'none') return;

        const border = '1px solid #000';

        if (type === 'all') {
          div.style.border = border;
        } else if (type === 'outside') {
          const [c, r] = parseCell(id);
          const isEdge = c === getMinCol() || c === getMaxCol() || r === getMinRow() || r === getMaxRow();
          if (isEdge) div.style.border = border;
        } else if (type === 'inside') {
          const [c, r] = parseCell(id);
          const notEdge = c !== getMinCol() && c !== getMaxCol() && r !== getMinRow() && r !== getMaxRow();
          if (notEdge) div.style.border = border;
        } else {
          div.style[`border${type.charAt(0).toUpperCase() + type.slice(1)}`] = border;
        }
      });
      save(); renderGrid();
    }

    function getMinCol() { return Math.min(...Array.from(selection.cells).map(id => parseCell(id)[0])); }
    function getMaxCol() { return Math.max(...Array.from(selection.cells).map(id => parseCell(id)[0])); }
    function getMinRow() { return Math.min(...Array.from(selection.cells).map(id => parseCell(id)[1])); }
    function getMaxRow() { return Math.max(...Array.from(selection.cells).map(id => parseCell(id)[1])); }

    // === FORMULA & SELECTION ===
    if (refs.formulaInput) {
      refs.formulaInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const expr = refs.formulaInput.value;
          commitEdit(focused, expr.slice(1), expr.startsWith('='));
          refs.formulaInput.blur();
        }
      });
    }

    if (refs.sheetTable) {
      refs.sheetTable.addEventListener('mousedown', e => {
        const cellDiv = e.target.closest('.cell-div');
        if (!cellDiv) return;
        const id = cellDiv.dataset.cell;
        if (e.shiftKey && selection.anchor) {
          const [c1, r1] = parseCell(selection.anchor);
          const [c2, r2] = parseCell(id);
          const minC = Math.min(c1, c2), maxC = Math.max(c1, c2);
          const minR = Math.min(r1, r2), maxR = Math.max(r1, r2);
          selection.cells.clear();
          for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
              selection.cells.add(`${colName(c)}${r}`);
            }
          }
        } else if (e.ctrlKey || e.metaKey) {
          if (selection.cells.has(id)) selection.cells.delete(id);
          else selection.cells.add(id);
          selection.anchor = id;
        } else {
          selection.cells.clear();
          selection.cells.add(id);
          selection.anchor = id;
        }
        focused = id;
        updateFormula();
        refreshSelection();
      });
    }
  }

  function toggleStyle(prop) {
    selection.cells.forEach(id => {
      const sheet = workbook.sheets[workbook.active];
      const cell = sheet.data[id] || (sheet.data[id] = {});
      cell.style = cell.style || {};
      cell.style[prop] = !cell.style[prop];
    });
    save(); renderGrid();
  }

  function cycleAlign() {
    const aligns = ['left', 'center', 'right'];
    selection.cells.forEach(id => {
      const sheet = workbook.sheets[workbook.active];
      const cell = sheet.data[id] || (sheet.data[id] = {});
      cell.style = cell.style || {};
      const cur = cell.style.align || 'left';
      const idx = aligns.indexOf(cur);
      cell.style.align = aligns[(idx + 1) % aligns.length];
    });
    save(); renderGrid();
  }

  function applyFill(color) {
    selection.cells.forEach(id => {
      const sheet = workbook.sheets[workbook.active];
      const cell = sheet.data[id] || (sheet.data[id] = {});
      cell.style = cell.style || {};
      cell.style.fill = color;
    });
    save(); renderGrid();
  }

  /* ---------- undo / redo ---------- */
  const history = [];
  const historyMax = 20;
  function pushUndo() {
    history.push(JSON.stringify(workbook));
    if (history.length > historyMax) history.shift();
  }

  /* ---------- global wiring (safe) ---------- */
  function wireGlobalEvents() {
    if (refs.workbookName) refs.workbookName.onchange = () => { workbook.name = refs.workbookName.value; save(); };
    if (refs.addSheet) refs.addSheet.onclick = () => {
      const name = prompt('Sheet name', `Sheet${workbook.sheets.length+1}`);
      if (!name) return;
      workbook.sheets.push(createSheet(name));
      workbook.active = workbook.sheets.length-1;
      save(); renderSheetList(); renderGrid();
    };
    if (refs.colCount) refs.colCount.onchange = () => {
      const sheet = workbook.sheets[workbook.active];
      const newC = +refs.colCount.value;
      if (newC < 1 || newC > 26) return;
      sheet.COLS = newC;
      save(); renderGrid();
    };
    if (refs.rowCount) refs.rowCount.onchange = () => {
      const sheet = workbook.sheets[workbook.active];
      const newR = +refs.rowCount.value;
      if (newR < 1 || newR > 1000) return;
      sheet.ROWS = newR;
      save(); renderGrid();
    };
    if (refs.resizeGrid) refs.resizeGrid.onclick = () => {
      const c = prompt('Columns', workbook.sheets[workbook.active].COLS);
      const r = prompt('Rows', workbook.sheets[workbook.active].ROWS);
      if (c) workbook.sheets[workbook.active].COLS = +c;
      if (r) workbook.sheets[workbook.active].ROWS = +r;
      save(); renderGrid();
    };
    if (refs.saveWB) refs.saveWB.onclick = () => save();
    if (refs.exportWB) refs.exportWB.onclick = () => {
      const data = JSON.stringify(workbook, null, 2);
      const blob = new Blob([data], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${workbook.name || 'workbook'}.json`;
      a.click();
    };
    if (refs.importWB) refs.importWB.onclick = () => refs.fileImport?.click();
    if (refs.fileImport) {
      refs.fileImport.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          try { workbook = JSON.parse(ev.target.result); save(); renderGrid(); renderSheetList(); }
          catch (err) { alert('Invalid file'); }
        };
        reader.readAsText(file);
      };
    };
    if (refs.undo) refs.undo.onclick = () => {
      if (!history.length) return;
      const prev = history.pop();
      workbook = JSON.parse(prev);
      save(); renderGrid(); renderSheetList();
    };
  }

  function handleCellKeyDown(e, id) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const div = e.target;
      commitEdit(id, div.innerText);
      const [c, r] = parseCell(id);
      const nextId = `${colName(c)}${r + 1}`;
      const nextDiv = refs.sheetTable?.querySelector(`[data-cell="${nextId}"]`);
      if (nextDiv) {
        nextDiv.focus();
        selection.cells.clear();
        selection.cells.add(nextId);
        selection.anchor = nextId;
        focused = nextId;
        updateFormula();
        refreshSelection();
      }
    }
  }

  /* ---------- initial load ---------- */
  function boot(){
    initDOM();
    load();
    renderSheetList();
    renderGrid();
    setupToolbar();
    wireGlobalEvents();
  }

  boot();
})();