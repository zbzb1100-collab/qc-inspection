/* 報表：勾選條件查詢、匯出 Excel */
let reportRows = [];
let viewSt = null;   // 點上方統計方塊：只看某個狀態（在其他條件篩出來的結果裡再篩）
const shownRows = () => viewSt ? reportRows.filter(r => r.status === viewSt) : reportRows;
const RF = { zone: [], itype: [], bld: [], floor: [], unit: [], cat: [], status: [], fixv: [], respv: [] };   // 每個條件可複選，空的＝全部
const RF_ALL = { zone: '專有戶＋公設', itype: '全部檢查類型', bld: '全部棟別', floor: '全部樓層', unit: '全部戶別', cat: '全部工項', status: '全部狀態', fixv: '全部修繕廠商', respv: '全部責任廠商' };

// 複選下拉：按鈕顯示已選項目，點開是勾選清單
function multiSel(key, opts, onChange) {
  const box = $('f-' + key); box.innerHTML = ''; box.className = 'ms';
  const sel = RF[key] = RF[key].filter(v => opts.some(o => o.v === v));   // 拿掉已不在清單裡的
  const btn = el('button', 'ms-btn'); btn.type = 'button';
  const label = () => {
    const names = opts.filter(o => sel.includes(o.v)).map(o => o.t);
    btn.textContent = !names.length ? RF_ALL[key] : names.length <= 2 ? names.join('、') : `${names.slice(0, 2).join('、')} 等 ${names.length} 項`;
    btn.classList.toggle('on', !!names.length);
  };
  const pn = el('div', 'ms-panel'); pn.hidden = true;
  const tools = el('div', 'ms-tools');
  const all = el('button', 'iconbtn', '全選'); all.type = 'button';
  const none = el('button', 'iconbtn', '清除'); none.type = 'button';
  tools.append(all, none); pn.appendChild(tools);
  const cbs = opts.map(o => {
    const lb = el('label', 'ms-opt'); const cb = el('input'); cb.type = 'checkbox'; cb.value = o.v; cb.checked = sel.includes(o.v);
    cb.onchange = () => { const i = sel.indexOf(o.v); if (cb.checked && i < 0) sel.push(o.v); if (!cb.checked && i >= 0) sel.splice(i, 1); label(); onChange && onChange(); };
    lb.append(cb, document.createTextNode(o.t)); pn.appendChild(lb); return cb;
  });
  if (!opts.length) pn.appendChild(el('div', 'hint', '（沒有選項）'));
  const setAll = on => { sel.length = 0; if (on) opts.forEach(o => sel.push(o.v)); cbs.forEach(c => { c.checked = on; }); label(); onChange && onChange(); };
  all.onclick = () => setAll(true); none.onclick = () => setAll(false);
  btn.onclick = () => { const open = pn.hidden; document.querySelectorAll('.ms-panel').forEach(p => { p.hidden = true; }); pn.hidden = !open; };
  box.append(btn, pn); label();
}
document.addEventListener('click', e => { if (!e.target.closest('.ms')) document.querySelectorAll('.ms-panel').forEach(p => { p.hidden = true; }); });

const idOpts = rows => rows.map(r => ({ v: r.id, t: r.name }));
let closedFloors = [];
function initReportFilters() {
  const zones = M.list('zones');
  $('f-zone').hidden = zones.length <= 1;
  multiSel('zone', idOpts(zones), drawZoneFilters);
  drawZoneFilters();
  multiSel('status', Object.keys(STATUS).map(k => ({ v: k, t: k === 'fixed' ? '待複驗' : STATUS[k] })));
  multiSel('fixv', idOpts(M.list('vendors')));
  multiSel('respv', idOpts(M.list('vendors')));
  // 已從樓層清單拿掉、但還有缺失紀錄的樓層，也要能篩選
  sb.from('defects').select('building_id,floor').limit(5000).then(({ data }) => { if (!data) return; closedFloors = data; drawPlaceFilters(); });
}
const zoneBlds = () => M.buildingsOf(S.sel.siteId).filter(b => !RF.zone.length || RF.zone.includes(M.bldZone(b)));
const inZoneF = u => !RF.zone.length || RF.zone.includes(M.unitZone(u));
// 兩區有同名的棟（例：專有戶、公設都有 A棟）時，清單上加註區分
const bldOpts = blds => blds.map(b => ({ v: b.id, t: M.bldLabel(b, blds) }));
function drawZoneFilters() {    // 檢查類型、棟別、工項跟著選的專有戶／公設走
  const inZ = r => !RF.zone.length || RF.zone.some(z => M.inZone(r, z));
  multiSel('itype', idOpts(M.list('inspect_types').filter(inZ)));
  multiSel('bld', bldOpts(zoneBlds()), drawPlaceFilters);
  drawPlaceFilters();
  multiSel('cat', idOpts(M.list('categories').filter(inZ)));
}
function drawPlaceFilters() {   // 樓層、戶別跟著選的棟別走
  const blds = RF.bld.length ? RF.bld.map(id => M.get('buildings', id)).filter(Boolean) : zoneBlds();
  const floors = [...new Set(blds.flatMap(b => b.floors))];
  const ids = blds.map(b => b.id), extra = [...new Set(closedFloors.filter(d => ids.includes(d.building_id)).map(d => d.floor))].filter(f => !floors.includes(f));
  multiSel('floor', floors.map(f => ({ v: f, t: f })).concat(extra.map(f => ({ v: f, t: f + '（已關閉）' }))));
  multiSel('unit', blds.flatMap(b => M.unitsOf(b.id).filter(inZoneF).map(u => ({ v: u.id, t: u.code }))));
}
$('f-clear').onclick = () => { viewSt = null; Object.keys(RF).forEach(k => { RF[k] = []; }); initReportFilters(); runReport(); };
$('f-go').onclick = e => guard(e.currentTarget, runReport);

async function runReport() {
  const col = { itype: 'inspect_type_id', bld: 'building_id', floor: 'floor', unit: 'unit_id', cat: 'category_id', status: 'status', fixv: 'fix_vendor_id', respv: 'resp_vendor_id' };
  const mk = () => {
    let q = sb.from('defects').select('*').order('id', { ascending: false });
    Object.keys(col).forEach(k => { if (RF[k].length) q = q.in(col[k], RF[k]); });
    if (RF.zone.length && !RF.unit.length) q = q.in('unit_id', S.m.units.filter(inZoneF).map(u => u.id).concat(-1));   // 同一棟可能兩區都有，用戶別分
    return q;
  };
  reportRows = await fetchAll(mk);
  drawReport();
}
const SHOW_MAX = 300;
function drawReport() {
  $('st-all').textContent = reportRows.length;
  ['todo', 'fixed', 'signing', 'closed'].forEach(k => { $('st-' + k).textContent = reportRows.filter(r => r.status === k).length; });   // 每筆同時只在一個狀態，四格加起來＝總數
  document.querySelectorAll('.stat > div').forEach(d => d.classList.toggle('on', (d.dataset.st || null) === viewSt));
  const rows = shownRows();
  const tb = $('rtable'); tb.innerHTML = '';
  rows.slice(0, SHOW_MAX).forEach(d => {
    const tr = el('tr'); tr.style.cursor = 'pointer';
    [`${M.name('buildings', d.building_id)} ${d.floor} ${M.unitCode(d.unit_id)}\n${M.name('inspect_types', d.inspect_type_id) || ''}`, M.name('spaces', d.space_id),
      `${M.name('categories', d.category_id)}\n${M.name('items', d.item_id)}`,
      `${M.name('vendors', d.fix_vendor_id) || '—'}\n${M.name('vendors', d.resp_vendor_id) || '—'}`].forEach(v => {
      const td = el('td', null, v); td.style.whiteSpace = 'pre-line'; tr.appendChild(td);
    });
    const td = el('td'); td.appendChild(el('span', 'status ' + d.status, statusText(d))); tr.appendChild(td);
    tr.onclick = () => openDefect(d, { no: d.id, onDone: runReport });
    tb.appendChild(tr);
  });
  if (!rows.length) { const tr = el('tr'); const td = el('td', null, '沒有符合條件的缺失。'); td.colSpan = 5; tr.appendChild(td); tb.appendChild(tr); }
  $('rnote').textContent = (viewSt ? `目前只顯示「${viewSt === 'fixed' ? '待複驗' : STATUS[viewSt]}」${rows.length} 筆（匯出也只匯出這些），點「總數」看全部。` : '') +
    (rows.length > SHOW_MAX ? `畫面只列前 ${SHOW_MAX} 筆，匯出 Excel 會包含全部 ${rows.length} 筆。` : '');
}
document.querySelectorAll('.stat > div').forEach(d => {
  d.onclick = () => { const k = d.dataset.st || null; viewSt = viewSt === k ? null : k; drawReport(); };
  d.setAttribute('role', 'button'); d.tabIndex = 0; d.onkeydown = e => { if (e.key === 'Enter') d.onclick(); };
});

async function photoCounts(ids) {
  const cnt = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('defect_photos').select('*').in('defect_id', ids.slice(i, i + 200)).limit(5000);
    if (error) throw error;
    data.filter(p => !p.deleted_at).forEach(p => { const c = cnt[p.defect_id] || (cnt[p.defect_id] = { before: 0, after: 0, sign: 0 }); c[p.kind]++; });
  }
  return cnt;
}
// ---------- 匯出欄位：自己勾要哪些欄，每台裝置記住；Excel、PDF 都照這個 ----------
const pos = d => `${M.name('buildings', d.building_id)} ${d.floor} ${M.unitCode(d.unit_id)}`;
const EXPORT_FIELDS = [   // [key, 欄名, Excel 欄寬, 取值]
  ['id', '編號', 6, d => d.id], ['site', '案場', 10, d => M.name('sites', d.site_id)], ['itype', '檢查類型', 10, d => M.name('inspect_types', d.inspect_type_id)],
  ['pos', '位置（棟 樓 戶）', 14, pos], ['bld', '棟別', 8, d => M.name('buildings', d.building_id)], ['floor', '樓層', 6, d => d.floor], ['unit', '戶別', 8, d => M.unitCode(d.unit_id)],
  ['cust', '客戶名稱', 12, d => d.customer_name || ''], ['space', '空間', 10, d => M.name('spaces', d.space_id)], ['cat', '工項', 14, d => M.name('categories', d.category_id)],
  ['item', '缺失內容', 28, d => M.name('items', d.item_id)], ['method', '修繕方式', 8, d => M.name('repair_methods', d.repair_method_id)],
  ['fixv', '修繕廠商', 20, d => M.name('vendors', d.fix_vendor_id)], ['respv', '責任廠商', 20, d => M.name('vendors', d.resp_vendor_id)],
  ['planned', '預計修繕日', 12, d => d.planned_date || ''], ['fixed', '實際修繕日', 12, d => d.fixed_date || ''], ['status', '狀態', 10, d => statusText(d)],
  ['ctype', '結案方式', 10, d => d.close_type || ''], ['reason', '不修原因', 20, d => d.close_reason || ''], ['signer', '簽認人', 10, d => d.signed_name || ''],
  ['sdate', '簽認日期', 12, d => d.signed_date || ''], ['desc', '缺失說明', 30, d => d.description || ''],
  ['cby', '建立者', 10, d => M.userName(d.created_by)], ['cat_at', '建立時間', 16, d => fmtTime(d.created_at)],
  ['uby', '最後修改者', 10, d => M.userName(d.updated_by)], ['uat', '最後修改時間', 16, d => fmtTime(d.updated_at)],
  ['nb', '修繕前照片數', 8, (d, c) => (c[d.id] || {}).before || 0], ['na', '修繕後照片數', 8, (d, c) => (c[d.id] || {}).after || 0]];
const FIELDS_COMMON = ['id', 'itype', 'bld', 'floor', 'unit', 'space', 'cat', 'item', 'fixv', 'respv', 'planned', 'status', 'desc', 'cat_at'];
const FIELDS_KEY = 'qc-export-fields';
let expFields = (() => { try { const v = JSON.parse(localStorage.getItem(FIELDS_KEY)); if (Array.isArray(v) && v.length) return v.filter(k => EXPORT_FIELDS.some(f => f[0] === k)); } catch (e) {} return FIELDS_COMMON.slice(); })();
const chosenFields = () => EXPORT_FIELDS.filter(f => expFields.includes(f[0]));
function drawFieldPicker() {
  const box = $('f-fields'); if (!box) return; box.innerHTML = '';
  const sum = el('summary', null, `匯出欄位：已選 ${expFields.length} 個（點此更改）`); box.appendChild(sum);
  const save = () => { try { localStorage.setItem(FIELDS_KEY, JSON.stringify(expFields)); } catch (e) {} sum.textContent = `匯出欄位：已選 ${expFields.length} 個（點此更改）`; };
  const btns = el('div', 'row'); btns.style.gap = '8px';
  [['常用', FIELDS_COMMON], ['全部', EXPORT_FIELDS.map(f => f[0])], ['全不選', []]].forEach(([n, keys]) => {
    const b = el('button', 'btn ghost small', n); b.type = 'button'; b.onclick = () => { expFields = keys.slice(); save(); paint(); }; btns.appendChild(b);
  });
  const grid = el('div', 'fieldgrid');
  box.append(btns, grid, el('p', 'hint', '勾的欄位會用在「匯出 Excel」和「匯出 PDF（文字）」；含照片的匯出另外附照片欄。順序固定照上面排列。'));
  const paint = () => {
    grid.innerHTML = '';
    EXPORT_FIELDS.forEach(([k, n]) => {
      const lab = el('label'); const c = el('input'); c.type = 'checkbox'; c.checked = expFields.includes(k); c.dataset.field = k;
      c.onchange = () => { expFields = EXPORT_FIELDS.map(f => f[0]).filter(x => x === k ? c.checked : expFields.includes(x)); save(); };
      lab.append(c, ' ' + n); grid.appendChild(lab);
    });
  };
  paint();
}
drawFieldPicker();
function needFields() { const f = chosenFields(); if (!f.length) throw new Error('請在「匯出欄位」至少勾一個欄位'); return f; }
// Excel 列印設定：A4 橫向、寬度縮成一頁、每頁重複標題列
function sheetPrintSetup(ws) {
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1',
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  ws.headerFooter = { oddFooter: '第 &P 頁，共 &N 頁' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}
function downloadXlsx(buf, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const d0 = new Date(); a.download = `${name}_${d0.getFullYear()}${pad(d0.getMonth() + 1)}${pad(d0.getDate())}.xlsx`; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
$('f-export').onclick = e => guard(e.currentTarget, async () => {
  if (!shownRows().length) { toast('目前沒有資料可匯出'); return; }
  const fields = needFields();
  const cnt = fields.some(f => f[0] === 'nb' || f[0] === 'na') ? await photoCounts(shownRows().map(r => r.id)) : {};
  if (!window.ExcelJS) await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('缺失清單');
  ws.columns = fields.map(f => ({ width: f[2] }));
  const hr = ws.addRow(fields.map(f => f[1])); hr.font = { bold: true }; hr.alignment = { vertical: 'middle', wrapText: true };
  hr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }; });
  const rows = shownRows().slice().sort((a, b) => a.id - b.id);
  rows.forEach(d => { const r = ws.addRow(fields.map(f => f[3](d, cnt))); r.alignment = { vertical: 'top', wrapText: true }; });
  ws.eachRow(r => r.eachCell(c => { c.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }; }));
  sheetPrintSetup(ws);
  downloadXlsx(await wb.xlsx.writeBuffer(), '品質查驗報表');
  toast(`已匯出 ${rows.length} 筆`);
});


// ---------- 匯出 Excel（含照片）----------
function loadScriptOnce(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[data-src="${src}"]`)) { res(); return; }
    const t = document.createElement('script'); t.src = src; t.dataset.src = src; t.onload = res;
    t.onerror = () => rej(new Error('匯出元件載入失敗，請確認網路後再試')); document.head.appendChild(t);
  });
}
const PHOTO_MAX_ROWS = 600, PHOTO_PER_KIND = 3;
$('f-export-photo').onclick = e => guard(e.currentTarget, async () => {
  if (!shownRows().length) { toast('目前沒有資料可匯出'); return; }
  const kinds = ['before', 'after'].filter(k => $(k === 'before' ? 'f-ph-before' : 'f-ph-after').checked);
  if (!kinds.length) throw new Error('請至少勾選一種照片（修繕前或修繕後）');
  const rows = shownRows().slice().sort((a, b) => a.id - b.id);
  const ids = rows.map(r => r.id); let photos = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('defect_photos').select('*').in('defect_id', ids.slice(i, i + 200)).in('kind', kinds).order('id').limit(5000);
    if (error) throw error; photos = photos.concat(data.filter(p => !p.deleted_at));
  }
  const by = {}; photos.forEach(p => { const k = p.defect_id + p.kind; (by[k] = by[k] || []).length < PHOTO_PER_KIND && by[k].push(p); });
  const use = Object.values(by).flat();
  if (use.length > PHOTO_MAX_ROWS) throw new Error(`符合的照片有 ${use.length} 張，一次最多匯出 ${PHOTO_MAX_ROWS} 張，請先縮小篩選條件（例如先選棟別或樓層）。`);
  if (!window.ExcelJS) await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
  const urls = await signedUrls('photos', use.map(p => p.path));
  const imgs = new Map(); let done = 0, next = 0;
  const worker = async () => {
    while (next < use.length) {
      const i = next++; const p = use[i];
      try {
        const blob = await (await fetch(urls[i])).blob();
        const small = await compressImage(blob, 640, 0.7);            // Excel 內縮小，檔案才不會太大
        imgs.set(p.id, await small.arrayBuffer());
      } catch (err) { console.warn('照片載入失敗', p.path, err); }
      done++; if (done % 10 === 0 || done === use.length) toast(`整理照片 ${done} / ${use.length}…`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);

  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('缺失清單（含照片）');
  const fields = needFields(), cnt = fields.some(f => f[0] === 'nb' || f[0] === 'na') ? await photoCounts(ids) : {};
  const textHead = fields.map(f => f[1]);
  const kindName = { before: '修繕前', after: '修繕後' };
  const photoCols = []; kinds.forEach(k => { const n = Math.max(1, ...rows.map(r => (by[r.id + k] || []).length)); for (let j = 0; j < n; j++) photoCols.push({ kind: k, j }); });
  const head = textHead.concat(photoCols.map(c => `${kindName[c.kind]}照片${c.j + 1}`));
  ws.addRow(head); ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  ws.columns = head.map((h, i) => ({ width: i < textHead.length ? fields[i][2] : 24 }));
  const IMG_W = 170, IMG_H = 128;
  rows.forEach((d, r) => {
    const row = ws.addRow(fields.map(f => f[3](d, cnt)));
    row.alignment = { vertical: 'top', wrapText: true };
    const has = photoCols.some(c => (by[d.id + c.kind] || [])[c.j]);
    if (has) row.height = IMG_H * 0.75 + 6;
    photoCols.forEach((c, ci) => {
      const p = (by[d.id + c.kind] || [])[c.j]; const buf = p && imgs.get(p.id); if (!buf) return;
      const id = wb.addImage({ buffer: buf, extension: 'jpeg' });
      ws.addImage(id, { tl: { col: textHead.length + ci + 0.05, row: r + 1 + 0.05 }, ext: { width: IMG_W, height: IMG_H } });
    });
  });
  sheetPrintSetup(ws);
  downloadXlsx(await wb.xlsx.writeBuffer(), '品質查驗報表_含照片');
  toast(`已匯出 ${rows.length} 筆、${imgs.size} 張照片`);
});

// ---------- 匯出 PDF（用瀏覽器列印，目的地選「另存為 PDF」）----------
function filterSummary() {
  const parts = [];
  const add = (label, v) => { if (v) parts.push(`${label}：${v}`); };
  const nm = (k, f) => RF[k].map(f).join('、');
  add('區分', nm('zone', v => M.name('zones', v)));
  add('檢查類型', nm('itype', v => M.name('inspect_types', v)));
  add('棟別', nm('bld', v => M.name('buildings', v)));
  add('樓層', nm('floor', v => v));
  add('戶別', nm('unit', v => M.unitCode(v)));
  add('工項', nm('cat', v => M.name('categories', v)));
  add('狀態', nm('status', v => STATUS[v]));
  add('修繕廠商', nm('fixv', v => M.name('vendors', v)));
  add('責任廠商', nm('respv', v => M.name('vendors', v)));
  if (viewSt) add('只看', viewSt === 'fixed' ? '待複驗' : STATUS[viewSt]);
  return parts.length ? parts.join('　') : '全部資料';
}
function printNow(landscape) {
  let st = $('print-page'); if (!st) { st = el('style'); st.id = 'print-page'; document.head.appendChild(st); }
  st.textContent = `@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:12mm}`;
  const root = $('print-root');
  window.onafterprint = () => { root.innerHTML = ''; window.onafterprint = null; };
  window.print();
}
function printHead(root, title, n) {
  root.innerHTML = '';
  root.appendChild(el('h1', null, title));
  root.appendChild(el('div', 'pmeta', `${fmtTime(new Date().toISOString())}　共 ${n} 筆　篩選：${filterSummary()}`));
}
$('f-pdf').onclick = e => guard(e.currentTarget, async () => {
  if (!shownRows().length) { toast('目前沒有資料可匯出'); return; }
  const root = $('print-root'); const rows = shownRows().slice().sort((a, b) => a.id - b.id);
  printHead(root, '品質查驗報表', rows.length);
  const fields = needFields(), cnt = fields.some(f => f[0] === 'nb' || f[0] === 'na') ? await photoCounts(rows.map(r => r.id)) : {};
  const t = el('table'); const th = el('thead'); const hr = el('tr');
  fields.forEach(f => hr.appendChild(el('th', null, f[1])));
  th.appendChild(hr); t.appendChild(th); const tb = el('tbody');
  rows.forEach(d => {
    const tr = el('tr');
    fields.forEach(f => { const td = el('td', null, String(f[3](d, cnt) ?? '')); td.style.whiteSpace = 'pre-line'; tr.appendChild(td); });
    tb.appendChild(tr);
  });
  t.appendChild(tb); root.appendChild(t);
  printNow(true);
});
$('f-pdf-photo').onclick = e => guard(e.currentTarget, async () => {
  if (!shownRows().length) { toast('目前沒有資料可匯出'); return; }
  const kinds = ['before', 'after'].filter(k => $(k === 'before' ? 'f-ph-before' : 'f-ph-after').checked);
  if (!kinds.length) throw new Error('請至少勾選一種照片（修繕前或修繕後）');
  const rows = shownRows().slice().sort((a, b) => a.id - b.id);
  if (rows.length > 150) throw new Error(`含照片的 PDF 一次最多 150 筆，目前有 ${rows.length} 筆，請先縮小篩選條件（例如先選棟別或樓層）。`);
  const ids = rows.map(r => r.id); let photos = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('defect_photos').select('*').in('defect_id', ids.slice(i, i + 200)).in('kind', kinds).order('id').limit(5000);
    if (error) throw error; photos = photos.concat(data.filter(p => !p.deleted_at));
  }
  const by = {}; photos.forEach(p => { const k = p.defect_id + p.kind; const a = (by[k] = by[k] || []); if (a.length < 4) a.push(p); });
  const use = Object.values(by).flat();
  const urls = await signedUrls('photos', use.map(p => p.path)); const url = new Map(use.map((p, i) => [p.id, urls[i]]));
  const root = $('print-root'); printHead(root, '品質查驗報表（含照片）', rows.length);
  const imgs = [];
  rows.forEach(d => {
    const c = el('div', 'card');
    c.appendChild(el('div', 'h', `#${d.id}　${M.name('buildings', d.building_id)} ${d.floor} ${M.unitCode(d.unit_id)}　${M.name('spaces', d.space_id) || ''}　［${statusText(d)}${d.close_type && !isNofix(d) ? '・' + d.close_type : ''}］`));
    c.appendChild(el('div', null, `${M.name('categories', d.category_id)}　${M.name('items', d.item_id)}`));
    c.appendChild(el('div', 's', `修繕廠商：${M.name('vendors', d.fix_vendor_id) || '—'}　責任廠商：${M.name('vendors', d.resp_vendor_id) || '—'}　預計：${d.planned_date || '—'}　實際：${d.fixed_date || '—'}`));
    if (d.description) c.appendChild(el('div', 's', '說明：' + d.description));
    if (d.close_reason) c.appendChild(el('div', 's', '不修原因：' + d.close_reason));
    const ph = el('div', 'ph');
    kinds.forEach(k => (by[d.id + k] || []).forEach((p, j) => {
      const f = el('figure'); const im = el('img'); im.alt = ''; imgs.push(im); im.src = url.get(p.id);
      f.append(im, el('figcaption', null, `${k === 'before' ? '修繕前' : '修繕後'} ${j + 1}`)); ph.appendChild(f);
    }));
    if (ph.children.length) c.appendChild(ph);
    root.appendChild(c);
  });
  toast('整理照片中…');
  await Promise.all(imgs.map(im => new Promise(res => { if (im.complete) res(); else { im.onload = im.onerror = res; setTimeout(res, 15000); } })));
  printNow(false);
});
