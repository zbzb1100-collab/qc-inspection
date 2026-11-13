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
// 圖上編號＝填寫頁平面圖上的數字：同一戶、同樓層、同檢查類型的缺失照建立順序 1、2、3…（跟 pick.js 的 S.unitDefects 一樣）
let pinNos = new Map();
async function loadPinNos(rows) {
  pinNos = new Map(); const units = [...new Set(rows.map(r => r.unit_id).filter(Boolean))], all = [];
  for (let i = 0; i < units.length; i += 100) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('defects').select('id,unit_id,floor,inspect_type_id').in('unit_id', units.slice(i, i + 100)).order('id').range(from, from + 999);
      if (error) throw error; all.push(...data); if (data.length < 1000) break;
    }
  }
  const seen = {}; all.sort((a, b) => a.id - b.id).forEach(d => { const k = `${d.unit_id}|${d.floor}|${d.inspect_type_id}`; seen[k] = (seen[k] || 0) + 1; pinNos.set(d.id, seen[k]); });
}
const needPin = fields => fields.some(f => f[0] === 'pinno');
const pos = d => `${M.name('buildings', d.building_id)} ${d.floor} ${M.unitCode(d.unit_id)}`;
const EXPORT_FIELDS = [   // [key, 欄名, Excel 欄寬, 取值]
  ['id', '系統編號', 6, d => d.id], ['pinno', '圖上編號', 6, d => pinNos.get(d.id) ?? ''], ['cat_at', '建立日期', 12, d => fmtTime(d.created_at).slice(0, 10)], ['site', '案場', 10, d => M.name('sites', d.site_id)], ['itype', '檢查類型', 10, d => M.name('inspect_types', d.inspect_type_id)],
  ['pos', '位置（棟 樓 戶）', 14, pos], ['bld', '棟別', 8, d => M.name('buildings', d.building_id)], ['floor', '樓層', 6, d => d.floor], ['unit', '戶別', 12, d => M.unitCode(d.unit_id)],
  ['cust', '客戶名稱', 12, d => d.customer_name || ''], ['space', '空間', 10, d => M.name('spaces', d.space_id)], ['cat', '工項', 14, d => M.name('categories', d.category_id)],
  ['item', '缺失內容', 28, d => M.name('items', d.item_id)], ['method', '修繕方式', 8, d => M.name('repair_methods', d.repair_method_id)],
  ['fixv', '修繕廠商', 20, d => M.name('vendors', d.fix_vendor_id)], ['respv', '責任廠商', 20, d => M.name('vendors', d.resp_vendor_id)],
  ['planned', '預計修繕日', 13, d => d.planned_date || ''], ['fixed', '實際修繕日', 13, d => d.fixed_date || ''], ['status', '狀態', 10, d => statusText(d)],
  ['ctype', '結案方式', 10, d => d.close_type || ''], ['reason', '不修原因', 20, d => d.close_reason || ''], ['signer', '簽認人', 10, d => d.signed_name || ''],
  ['sdate', '簽認日期', 13, d => d.signed_date || ''], ['desc', '缺失說明', 30, d => d.description || ''],
  ['cby', '建立者', 10, d => M.userName(d.created_by)],
  ['uby', '最後修改者', 10, d => M.userName(d.updated_by)], ['uat', '最後修改時間', 16, d => fmtTime(d.updated_at)],
  ['nb', '修繕前照片數', 8, (d, c) => (c[d.id] || {}).before || 0], ['na', '修繕後照片數', 8, (d, c) => (c[d.id] || {}).after || 0]];
const FIELDS_COMMON = ['pinno', 'cat_at', 'itype', 'bld', 'floor', 'unit', 'space', 'cat', 'item', 'fixv', 'planned', 'status', 'desc'];
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
// ---------- 匯出排序：第一、第二…排序（不限層數），每台裝置記住；四種匯出都照這個 ----------
const listIdx = t => { const m = new Map(); (S.all && S.all[t] ? S.all[t] : S.m[t]).slice().sort(bySort).forEach((r, i) => m.set(r.id, i)); return m; };
// 樓層：B2 < B1 < 1F < 2F … < 19F < R1F < PRF（照數字大小，不是照字面）
const floorKey = f => { f = String(f || '').toUpperCase(); let m;
  if ((m = f.match(/^B(\d+)/))) return -Number(m[1]);
  if ((m = f.match(/^(\d+)/))) return Number(m[1]);
  if ((m = f.match(/^R(\d*)/))) return 1000 + Number(m[1] || 0);
  if (f.startsWith('PR')) return 2000; return f ? 3000 : -9999; };
const STATUS_ORDER = d => isNofix(d) ? 1 : ({ todo: 0, fixed: 2, signing: 3, closed: 4 })[d.status] ?? 9;
const SORT_KEYS = [   // [key, 名稱, 產生排序用的取值函式（每次匯出前建一次對照表）]
  ['id', '系統編號', () => d => d.id], ['cat_at', '建立時間', () => d => d.created_at || ''], ['uat', '最後修改時間', () => d => d.updated_at || ''],
  ['itype', '檢查類型', () => { const m = listIdx('inspect_types'); return d => m.get(d.inspect_type_id) ?? 1e9; }],
  ['bld', '棟別', () => { const m = listIdx('buildings'); return d => m.get(d.building_id) ?? 1e9; }],
  ['floor', '樓層', () => d => floorKey(d.floor)],
  ['unit', '戶別', () => { const m = listIdx('units'); return d => m.get(d.unit_id) ?? 1e9; }],
  ['space', '空間', () => { const m = listIdx('spaces'); return d => m.get(d.space_id) ?? 1e9; }],
  ['cat', '工項', () => { const m = listIdx('categories'); return d => m.get(d.category_id) ?? 1e9; }],
  ['item', '缺失內容', () => { const m = listIdx('items'); return d => m.get(d.item_id) ?? 1e9; }],
  ['fixv', '修繕廠商', () => d => M.name('vendors', d.fix_vendor_id)], ['respv', '責任廠商', () => d => M.name('vendors', d.resp_vendor_id)],
  ['planned', '預計修繕日', () => d => d.planned_date || '9999'], ['fixed', '實際修繕日', () => d => d.fixed_date || '9999'],
  ['status', '狀態', () => STATUS_ORDER]];
const SORT_KEY_STORE = 'qc-export-sort';
let expSort = (() => { try { const v = JSON.parse(localStorage.getItem(SORT_KEY_STORE)); if (Array.isArray(v) && v.length && v.every(x => SORT_KEYS.some(k => k[0] === x[0]))) return v; } catch (e) {} return [['id', 'asc']]; })();
const sortText = () => expSort.map(([k, dir]) => SORT_KEYS.find(x => x[0] === k)[1] + (dir === 'desc' ? '↓' : '↑')).join(' → ');
function sortedRows() {
  const fns = expSort.map(([k, dir]) => [SORT_KEYS.find(x => x[0] === k)[2](), dir === 'desc' ? -1 : 1]);
  const cmp = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'zh-Hant', { numeric: true });
  return shownRows().slice().sort((a, b) => { for (const [f, s] of fns) { const c = cmp(f(a), f(b)); if (c) return c * s; } return a.id - b.id; });
}
function drawSortPicker() {
  const box = $('f-sort'); if (!box) return; box.innerHTML = '';
  const sum = el('summary', null, ''); box.appendChild(sum);
  const save = () => { try { localStorage.setItem(SORT_KEY_STORE, JSON.stringify(expSort)); } catch (e) {} sum.textContent = `匯出排序：${sortText()}（點此更改）`; };
  const rows = el('div', 'sortrows'); box.append(rows, el('p', 'hint', '先照第一排序排，一樣的再照下一層排；選了一層就會多出下一層，可以一直加。四種匯出都照這個順序。'));
  const paint = () => {
    rows.innerHTML = '';
    const CN = '一二三四五六七八九十';
    Array.from({ length: Math.min(expSort.length + 1, SORT_KEYS.length) }, (_, i) => `第${CN[i] || i + 1}排序`).forEach((lab, i) => {   // 選了一層就多出下一層，沒有上限
      const cur = expSort[i], r = el('div', 'sortrow'), k = el('select'), dir = el('select');
      k.dataset.sort = i; dir.dataset.sortDir = i;
      if (i > 0) k.appendChild(new Option('（不用）', ''));
      SORT_KEYS.forEach(([key, n]) => { if (!expSort.some((x, j) => j !== i && x[0] === key)) k.appendChild(new Option(n, key)); });
      [['asc', '正序 ↑（小→大、舊→新）'], ['desc', '倒序 ↓（大→小、新→舊）']].forEach(([v, n]) => dir.appendChild(new Option(n, v)));
      k.value = cur ? cur[0] : ''; dir.value = cur ? cur[1] : 'asc'; dir.disabled = !cur;
      k.onchange = () => { if (!k.value) expSort = expSort.slice(0, i); else expSort[i] = [k.value, dir.value]; save(); paint(); };
      dir.onchange = () => { if (expSort[i]) expSort[i][1] = dir.value; save(); };
      r.append(el('span', 'sortlab', lab), k, dir); rows.appendChild(r);
    });
  };
  save(); paint();
}
drawSortPicker();
// Excel 列印設定：A4 橫向、寬度縮成一頁、每頁重複標題列
// 兩種 Excel 共用的外觀：正黑體 12 號、標題列淡藍底、全部框線、文字靠上自動換行
const XL_FONT = { name: '微軟正黑體', size: 12 }, XL_BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
function sheetStyle(ws, nCols, valign) {
  ws.eachRow((r, i) => {
    for (let c = 1; c <= nCols; c++) {
      const cell = r.getCell(c); cell.border = XL_BORDER;
      if (i === 1) { cell.font = { ...XL_FONT, bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: false }; }
      else { cell.font = XL_FONT; cell.alignment = { vertical: valign || 'top', wrapText: true }; }
    }
  });
  ws.getRow(1).height = 24;
}
// 欄寬：至少放得下一行標題（標題不換行），內容短的就縮到剛好，長的到上限再換行
const textW = v => [...String(v ?? '')].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2.2 : 1.15), 0) + 1.5;
function colWidths(fields, data, cap) {
  return fields.map((f, i) => { const hw = textW(f[1]), max = Math.max(hw, cap ? Math.min(f[2], cap) : f[2]);
    return Math.min(max, Math.max(hw, ...data.map(r => textW(r[i])))); });
}
function sheetPrintSetup(ws) {
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1',
    margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.25 }, horizontalCentered: true };
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
  if (needPin(fields)) await loadPinNos(shownRows());
  if (!window.ExcelJS) await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('缺失清單');
  const rows = sortedRows(), data = rows.map(d => fields.map(f => f[3](d, cnt)));
  ws.columns = colWidths(fields, data).map(width => ({ width }));
  ws.addRow(fields.map(f => f[1]));
  data.forEach(v => ws.addRow(v));
  sheetStyle(ws, fields.length);
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
// 含照片的匯出不限筆數：系統自己切成幾個檔（每檔 CHUNK.xl／CHUNK.pdf 筆缺失），一檔做完、下載、放掉記憶體再做下一檔
const CHUNK = { xl: 150, pdf: 100, xlPhotos: 600, pdfPhotos: 500 };   // 每檔最多幾筆缺失、幾張照片（照片多就提早換下一檔，記憶體才夠）
async function photosOf(ids, kinds, perKind = Infinity) {   // 每筆缺失、每種照片（不限張數）
  let photos = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('defect_photos').select('*').in('defect_id', ids.slice(i, i + 200)).in('kind', kinds).order('id').limit(5000);
    if (error) throw error; photos = photos.concat(data.filter(p => !p.deleted_at));
  }
  const by = {}; photos.forEach(p => { const k = p.defect_id + p.kind; const a = (by[k] = by[k] || []); if (a.length < perKind) a.push(p); });
  return by;
}
async function loadPhotoBlobs(list, maxSide, quality, label) {   // 下載並縮小：回傳 Map(photo.id → Blob)
  const urls = await signedUrls('photos', list.map(p => p.path));
  const out = new Map(); let done = 0, next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++, p = list[i];
      try { out.set(p.id, await compressImage(await (await fetch(urls[i])).blob(), maxSide, quality)); }
      catch (err) { console.warn('照片載入失敗', p.path, err); }
      done++; if (done % 10 === 0 || done === list.length) toast(`${label}整理照片 ${done} / ${list.length}…`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  return out;
}
const chunksOf = (a, n) => { const r = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; };
// 依筆數和照片數分檔：任一個到上限就換下一檔（一筆缺失照片再多也不拆開）
function splitParts(rows, by, kinds, maxRows, maxPhotos) {
  const parts = []; let cur = [], n = 0;
  rows.forEach(d => {
    const c = kinds.reduce((t, k) => t + (by[d.id + k] || []).length, 0);
    if (cur.length && (cur.length >= maxRows || n + c > maxPhotos)) { parts.push(cur); cur = []; n = 0; }
    cur.push(d); n += c;
  });
  if (cur.length) parts.push(cur);
  return parts;
}
const partName = (k, n) => n > 1 ? `_第${k}檔共${n}檔` : '';
// 拼圖：照片固定大小（每列 2 張、4:3），編號在左上角；一格最多 MOSAIC_MAX 張（Excel 一列最高約 545px），多的由呼叫的地方開下一列
const MOSAIC_MAX = 8;
async function photoMosaic(blobList, W, start = 0, showNo = true) {
  const n = blobList.length, G = 4, c = Math.min(2, n), tw = (W - G) / 2, th = tw * 0.75, rowsN = Math.ceil(n / 2), h = rowsN * th + (rowsN - 1) * G;
  const S = 2, cv = document.createElement('canvas'); cv.width = Math.round((c * tw + (c - 1) * G) * S); cv.height = Math.round(h * S); const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  for (let i = 0; i < n; i++) {
    const x = (i % 2) * (tw + G) * S, y = Math.floor(i / 2) * (th + G) * S, w = tw * S, hh = th * S;
    g.fillStyle = '#f2f2f2'; g.fillRect(x, y, w, hh);
    try { const bm = await createImageBitmap(blobList[i]), k = Math.min(w / bm.width, hh / bm.height);
      g.drawImage(bm, x + (w - bm.width * k) / 2, y + (hh - bm.height * k) / 2, bm.width * k, bm.height * k); bm.close && bm.close(); } catch (e) {}
    if (showNo) { const fs = 26, t = String(start + i + 1); g.font = `700 ${fs}px sans-serif`; g.fillStyle = 'rgba(0,0,0,.6)';
      g.fillRect(x, y, g.measureText(t).width + fs * 0.6, fs * 1.3); g.fillStyle = '#fff'; g.fillText(t, x + fs * 0.3, y + fs * 1.05); }
  }
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
  return { buf: await blob.arrayBuffer(), w: Math.round(c * tw + (c - 1) * G), h: Math.round(h) };
}
const pause = ms => new Promise(r => setTimeout(r, ms));
function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const today8 = () => { const d0 = new Date(); return `${d0.getFullYear()}${pad(d0.getMonth() + 1)}${pad(d0.getDate())}`; };
$('f-export-photo').onclick = e => guard(e.currentTarget, async () => {
  if (!shownRows().length) { toast('目前沒有資料可匯出'); return; }
  const kinds = ['before', 'after'].filter(k => $(k === 'before' ? 'f-ph-before' : 'f-ph-after').checked);
  if (!kinds.length) throw new Error('請至少勾選一種照片（修繕前或修繕後）');
  const fields = needFields(), all = sortedRows();
  if (!window.ExcelJS) await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
  const cnt = fields.some(f => f[0] === 'nb' || f[0] === 'na') ? await photoCounts(all.map(r => r.id)) : {};
  if (needPin(fields)) await loadPinNos(all);
  const byAll = await photosOf(all.map(r => r.id), kinds), parts = splitParts(all, byAll, kinds, CHUNK.xl, CHUNK.xlPhotos);
  let nImg = 0;
  for (let k = 0; k < parts.length; k++) {
    const rows = parts[k], label = parts.length > 1 ? `第 ${k + 1}／${parts.length} 檔：` : '';
    const blobs = await loadPhotoBlobs(rows.flatMap(d => kinds.flatMap(kd => byAll[d.id + kd] || [])), 480, 0.75, label);   // Excel 內縮小，檔案才不會太大
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('缺失清單（含照片）');
    const textHead = fields.map(f => f[1]);
    const kindName = { before: '修繕前', after: '修繕後' };
    // 照片不限張數：每種照片固定一欄，同一筆的照片在格子裡每列 2 張排整齊（大小固定不縮），欄數不會變多
    const head = textHead.concat(kinds.map(kd => `${kindName[kd]}照片`));
    ws.addRow(head);
    const PAD = 6, CW = 320, PCOL = 47;                      // 照片欄 47 字 ≈ 334px，拼圖寬 320px
    const data = rows.map(d => fields.map(f => f[3](d, cnt))), tw = colWidths(fields, data, 16);
    ws.columns = head.map((h, i) => ({ width: i < textHead.length ? tw[i] : PCOL }));
    // 一筆缺失照片超過 MOSAIC_MAX 張：下面多開「續」列接著放（照片不縮小）；續列也填同樣的文字（淡灰色），Excel 篩選時整組一起留下
    const plan = rows.map(d => { const ps = kinds.map(kd => (byAll[d.id + kd] || []).filter(p => blobs.has(p.id))); return { d, ps, n: Math.max(1, ...ps.map(x => Math.ceil(x.length / MOSAIC_MAX))) }; });
    const cont = [];
    plan.forEach((pl, i) => { for (let j = 0; j < pl.n; j++) { ws.addRow(data[i]); if (j) cont.push(ws.rowCount); } });
    sheetStyle(ws, head.length, 'middle');
    cont.forEach(rn => { for (let c = 1; c <= textHead.length; c++) ws.getRow(rn).getCell(c).font = { ...XL_FONT, color: { argb: 'FFB0B0B0' } }; });
    let rowNo = 1;                                          // 0-based：第 1 列是標題
    for (const pl of plan) {
      for (let j = 0; j < pl.n; j++, rowNo++) {
        const tiles = [];
        for (let ci = 0; ci < kinds.length; ci++) {
          const part = pl.ps[ci].slice(j * MOSAIC_MAX, (j + 1) * MOSAIC_MAX); if (!part.length) continue;
          tiles.push({ ci, ...(await photoMosaic(part.map(p => blobs.get(p.id)), CW, j * MOSAIC_MAX, pl.ps[ci].length > 1)) }); nImg += part.length;
        }
        if (!tiles.length) continue;
        ws.getRow(rowNo + 1).height = (Math.max(...tiles.map(t => t.h)) + 2 * PAD) * 0.75;
        tiles.forEach(t => {
          const id = wb.addImage({ buffer: t.buf, extension: 'jpeg' });
          // 拼圖的左上、右下都釘在同一格裡（twoCellAnchor＝隨儲存格移動和調整大小）：Excel 篩選、排序、隱藏列時照片跟著那一列走
          const col = textHead.length + t.ci, px = 9525;    // 1 像素 = 9525 EMU
          ws.addImage(id, { tl: { nativeCol: col, nativeColOff: PAD * px, nativeRow: rowNo, nativeRowOff: PAD * px },
            br: { nativeCol: col, nativeColOff: (PAD + t.w) * px, nativeRow: rowNo, nativeRowOff: (PAD + t.h) * px }, editAs: 'twoCell' });
        });
      }
    }
    sheetPrintSetup(ws);
    toast(`${label}產生 Excel…`);
    downloadBlob(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `品質查驗報表_含照片_${today8()}${partName(k + 1, parts.length)}.xlsx`);
    if (k < parts.length - 1) await pause(1200);          // 連續下載中間停一下，瀏覽器才不會擋
  }
  toast(parts.length > 1 ? `已匯出 ${all.length} 筆、${nImg} 張照片，分成 ${parts.length} 個檔` : `已匯出 ${all.length} 筆、${nImg} 張照片`);
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
  const root = $('print-root'); const rows = sortedRows();
  printHead(root, '品質查驗報表', rows.length);
  const fields = needFields(), cnt = fields.some(f => f[0] === 'nb' || f[0] === 'na') ? await photoCounts(rows.map(r => r.id)) : {};
  if (needPin(fields)) await loadPinNos(rows);
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
// 含照片的 PDF：不經過列印視窗，直接在手機／電腦上一頁一頁畫成圖再組成 PDF 檔（A4 直式）
// 每次只有一頁在記憶體裡，筆數再多也不會當掉；每 CHUNK.pdf 筆存成一個檔
const PG = { W: 1240, H: 1754, M: 70 };                    // A4 @150dpi，邊界約 12mm
const PFONT = '"Noto Sans TC","Microsoft JhengHei","PingFang TC","Heiti TC",sans-serif';
function wrapText(g, text, maxW) {                         // 中文逐字換行，英數不拆字
  const out = []; String(text).split('\n').forEach(par => {
    let line = ''; const toks = par.match(/[A-Za-z0-9.\-_/:]+|./gu) || [''];
    toks.forEach(t => { if (line && g.measureText(line + t).width > maxW) { out.push(line); line = t.trimStart(); } else line += t; });
    out.push(line);
  });
  return out;
}
function cardLines(d) {
  return [
    ['b', `${pinNos.has(d.id) ? '圖上 ' + pinNos.get(d.id) + '　' : ''}#${d.id}　${M.name('buildings', d.building_id)} ${d.floor} ${M.unitCode(d.unit_id)}　${M.name('spaces', d.space_id) || ''}　［${statusText(d)}${d.close_type && !isNofix(d) ? '・' + d.close_type : ''}］`],
    ['n', `${M.name('categories', d.category_id)}　${M.name('items', d.item_id)}`],
    ['s', `修繕廠商：${M.name('vendors', d.fix_vendor_id) || '—'}　責任廠商：${M.name('vendors', d.resp_vendor_id) || '—'}　預計：${d.planned_date || '—'}　實際：${d.fixed_date || '—'}`],
    ...(d.description ? [['s', '說明：' + d.description]] : []), ...(d.close_reason ? [['s', '不修原因：' + d.close_reason]] : [])];
}
const FONT = { b: `700 26px ${PFONT}`, n: `500 23px ${PFONT}`, s: `400 21px ${PFONT}`, cap: `400 18px ${PFONT}` }, LH = { b: 36, n: 33, s: 30 };
const PCOLS = 3, PGAP = 14, CAP_H = 26, CPAD = 16;
function layoutCard(g, d, kinds, by) {                      // 卡片拆成一段一段：文字、每一排照片；放不下時可以在段落之間換頁
  const iw = PG.W - 2 * PG.M - 2 * CPAD, lines = [];
  cardLines(d).forEach(([t, txt]) => { g.font = FONT[t]; wrapText(g, txt, iw).forEach(l => lines.push([t, l])); });
  const cw = (iw - (PCOLS - 1) * PGAP) / PCOLS, ch = Math.round(cw * 0.75), segs = [];
  segs.push({ t: 'text', lines, h: lines.reduce((n, [t]) => n + LH[t], 0) });
  kinds.forEach(k => { const ps = by[d.id + k] || []; for (let i = 0; i < ps.length; i += PCOLS) segs.push({ t: 'photos', k, ps: ps.slice(i, i + PCOLS), start: i, h: ch + CAP_H + PGAP }); });
  if (segs.length > 1) segs[1].gap = 8;
  return { d, segs, cw, ch, h: CPAD * 2 + segs.reduce((n, x) => n + x.h + (x.gap || 0), 0) };
}
async function drawSeg(g, x0, cy, sg, L, blobs) {
  if (sg.t === 'text') { sg.lines.forEach(([t, l]) => { g.font = FONT[t]; g.fillStyle = t === 's' ? '#333' : '#000'; g.fillText(l, x0 + CPAD, cy + LH[t] - 9); cy += LH[t]; }); return; }
  for (let j = 0; j < sg.ps.length; j++) {
    const px = x0 + CPAD + j * (L.cw + PGAP);
    g.strokeStyle = '#bbb'; g.lineWidth = 1; g.strokeRect(px, cy, L.cw, L.ch);
    const b = blobs.get(sg.ps[j].id);
    if (b) {
      try {
        const bm = await createImageBitmap(b), s = Math.min(L.cw / bm.width, L.ch / bm.height), dw = bm.width * s, dh = bm.height * s;
        g.drawImage(bm, px + (L.cw - dw) / 2, cy + (L.ch - dh) / 2, dw, dh); bm.close && bm.close();
      } catch (err) { console.warn('照片畫不出來', err); }
    }
    g.font = FONT.cap; g.fillStyle = '#444'; g.fillText(`${sg.k === 'before' ? '修繕前' : '修繕後'} ${sg.start + j + 1}`, px, cy + L.ch + 20);
  }
}
// 畫一張卡片；pg.y 是目前位置，pg.newPage() 換頁。整張放得下就不拆；比一頁還高（照片很多）就一段一段畫，換頁後標「（續）」
async function drawCard(g, pg, L, blobs) {
  const x0 = PG.M, w = PG.W - 2 * PG.M, bottom = PG.H - PG.M, full = bottom - PG.M;
  const head = CPAD * 2 + L.segs.slice(0, 2).reduce((n, x) => n + x.h + (x.gap || 0), 0);   // 文字＋第一排照片
  if (pg.y > PG.M && (L.h <= full ? pg.y + L.h > bottom : pg.y + head > bottom)) pg.newPage();   // 放得進一頁的卡片不拆；很長的卡片這頁還放得下開頭就先接著畫
  if (L.h <= full) {
    g.strokeStyle = '#888'; g.lineWidth = 2; g.strokeRect(x0, pg.y, w, L.h);
    let cy = pg.y + CPAD; for (const sg of L.segs) { cy += sg.gap || 0; await drawSeg(g, x0, cy, sg, L, blobs); cy += sg.h; }
    pg.y += L.h; return;
  }
  let top = pg.y, cy = pg.y + CPAD;
  for (const sg of L.segs) {
    if (cy + (sg.gap || 0) + sg.h + CPAD > bottom) {         // 這頁放不下下一段：先把這頁的框畫好，換頁接著畫
      g.strokeStyle = '#888'; g.lineWidth = 2; g.strokeRect(x0, top, w, cy - top + CPAD);
      pg.newPage(); top = pg.y; cy = pg.y + CPAD;
      g.font = FONT.s; g.fillStyle = '#666'; g.fillText(`${pinNos.has(L.d.id) ? '圖上 ' + pinNos.get(L.d.id) + '　' : ''}#${L.d.id}（續）`, x0 + CPAD, cy + LH.s - 9); cy += LH.s;
    } else cy += sg.gap || 0;
    await drawSeg(g, x0, cy, sg, L, blobs); cy += sg.h;
  }
  g.strokeStyle = '#888'; g.lineWidth = 2; g.strokeRect(x0, top, w, cy - top + CPAD);
  pg.y = cy + CPAD;
}
$('f-pdf-photo').onclick = e => guard(e.currentTarget, async () => {
  if (!shownRows().length) { toast('目前沒有資料可匯出'); return; }
  const kinds = ['before', 'after'].filter(k => $(k === 'before' ? 'f-ph-before' : 'f-ph-after').checked);
  if (!kinds.length) throw new Error('請至少勾選一種照片（修繕前或修繕後）');
  if (!window.jspdf) await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
  await loadPinNos(shownRows());
  const all = sortedRows(), byAll = await photosOf(all.map(r => r.id), kinds), parts = splitParts(all, byAll, kinds, CHUNK.pdf, CHUNK.pdfPhotos);
  const made = fmtTime(new Date().toISOString()), filt = filterSummary(); let first = 0;
  const cv = document.createElement('canvas'); cv.width = PG.W; cv.height = PG.H; const g = cv.getContext('2d'); g.textBaseline = 'alphabetic';
  for (let k = 0; k < parts.length; k++) {
    const rows = parts[k], label = parts.length > 1 ? `第 ${k + 1}／${parts.length} 檔：` : '';
    const by = byAll, blobs = await loadPhotoBlobs(rows.flatMap(d => kinds.flatMap(kd => by[d.id + kd] || [])), 900, 0.8, label);
    const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    let page = 0, y = 0;
    const flush = () => {
      g.font = FONT.cap; g.fillStyle = '#666'; g.textAlign = 'center'; g.fillText(`第 ${page} 頁`, PG.W / 2, PG.H - 30); g.textAlign = 'left';
      if (page > 1) doc.addPage(); doc.addImage(cv.toDataURL('image/jpeg', 0.8), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    };
    const newPage = () => { if (page) flush(); page++; g.fillStyle = '#fff'; g.fillRect(0, 0, PG.W, PG.H); y = PG.M; };
    newPage();
    g.font = `700 38px ${PFONT}`; g.fillStyle = '#000'; g.fillText('品質查驗報表（含照片）', PG.M, y + 36); y += 52;
    g.font = FONT.s; g.fillStyle = '#333';
    wrapText(g, `${made}　共 ${all.length} 筆${parts.length > 1 ? `　本檔第 ${first + 1}～${first + rows.length} 筆（第 ${k + 1}／${parts.length} 檔）` : ''}　篩選：${filt}`, PG.W - 2 * PG.M)
      .forEach(l => { g.fillText(l, PG.M, y + 22); y += 30; });
    y += 14;
    const pg = { get y() { return y; }, set y(v) { y = v; }, newPage };
    for (let i = 0; i < rows.length; i++) {
      await drawCard(g, pg, layoutCard(g, rows[i], kinds, by), blobs); y += 16;
      if (i % 10 === 9) toast(`${label}排版 ${i + 1} / ${rows.length} 筆…`);
    }
    flush();
    toast(`${label}產生 PDF…`);
    downloadBlob(doc.output('blob'), `品質查驗報表_含照片_${today8()}${partName(k + 1, parts.length)}.pdf`);
    first += rows.length;
    if (k < parts.length - 1) await pause(1200);
  }
  toast(parts.length > 1 ? `已匯出 ${all.length} 筆，分成 ${parts.length} 個 PDF` : `已匯出 ${all.length} 筆`);
});
