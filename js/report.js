/* 報表：勾選條件查詢、匯出 Excel */
let reportRows = [];
const RF = { bld: '', floor: '', unit: '', cat: '', status: '', fixv: '', respv: '', itype: '' };

function initReportFilters() {
  const siteId = S.sel.siteId;
  fillSelect($('f-bld'), M.buildingsOf(siteId), RF.bld, '全部棟別');
  const b = M.get('buildings', Number(RF.bld));
  const floors = b ? b.floors : [...new Set(M.list('buildings').flatMap(x => x.floors))];
  const fs = $('f-floor'); fs.innerHTML = '<option value="">全部樓層</option>';
  floors.forEach(f => { const o = el('option', null, f); o.value = f; fs.appendChild(o); }); fs.value = RF.floor;
  // 已從樓層清單拿掉、但還有缺失紀錄的樓層，也要能篩選
  (async () => {
    let q = sb.from('defects').select('floor').limit(5000); if (b) q = q.eq('building_id', b.id);
    const { data } = await q; if (!data) return;
    const extra = [...new Set(data.map(d => d.floor))].filter(f => !floors.includes(f));
    extra.forEach(f => { const o = el('option', null, f + '（已關閉）'); o.value = f; fs.appendChild(o); }); fs.value = RF.floor;
  })();
  fillSelect($('f-unit'), b ? M.unitsOf(b.id) : [], RF.unit, b ? '全部戶別' : '（先選棟別）');
  fillSelect($('f-cat'), M.list('categories'), RF.cat, '全部工項');
  $('f-status').value = RF.status;
  fillSelect($('f-fixv'), M.list('vendors'), RF.fixv, '全部修繕廠商');
  fillSelect($('f-respv'), M.list('vendors'), RF.respv, '全部責任廠商');
  fillSelect($('f-itype'), M.list('inspect_types'), RF.itype, '全部檢查類型');
}
function readFilters() {
  RF.bld = $('f-bld').value; RF.floor = $('f-floor').value; RF.unit = $('f-unit').value; RF.cat = $('f-cat').value;
  RF.status = $('f-status').value; RF.fixv = $('f-fixv').value; RF.respv = $('f-respv').value; RF.itype = $('f-itype').value;
}
$('f-bld').onchange = () => { readFilters(); RF.unit = ''; RF.floor = ''; initReportFilters(); };
$('f-clear').onclick = () => { Object.keys(RF).forEach(k => RF[k] = ''); initReportFilters(); runReport(); };
$('f-go').onclick = e => guard(e.currentTarget, runReport);

async function runReport() {
  readFilters();
  const mk = () => {
    let q = sb.from('defects').select('*').order('id', { ascending: false });
    if (RF.bld) q = q.eq('building_id', Number(RF.bld));
    if (RF.floor) q = q.eq('floor', RF.floor);
    if (RF.unit) q = q.eq('unit_id', Number(RF.unit));
    if (RF.cat) q = q.eq('category_id', Number(RF.cat));
    if (RF.status) q = q.eq('status', RF.status);
    if (RF.fixv) q = q.eq('fix_vendor_id', Number(RF.fixv));
    if (RF.respv) q = q.eq('resp_vendor_id', Number(RF.respv));
    if (RF.itype) q = q.eq('inspect_type_id', Number(RF.itype));
    return q;
  };
  reportRows = await fetchAll(mk);
  drawReport();
}
const SHOW_MAX = 300;
function drawReport() {
  const rows = reportRows;
  $('st-all').textContent = rows.length;
  $('st-todo').textContent = rows.filter(r => r.status !== 'closed').length;
  $('st-closed').textContent = rows.filter(r => r.status === 'closed').length;
  const tb = $('rtable'); tb.innerHTML = '';
  rows.slice(0, SHOW_MAX).forEach(d => {
    const tr = el('tr'); tr.style.cursor = 'pointer';
    [`${M.name('buildings', d.building_id)} ${d.floor} ${M.unitCode(d.unit_id)}\n${M.name('inspect_types', d.inspect_type_id) || ''}`, M.name('spaces', d.space_id),
      `${M.name('categories', d.category_id)}\n${M.name('items', d.item_id)}`,
      `${M.name('vendors', d.fix_vendor_id) || '—'}\n${M.name('vendors', d.resp_vendor_id) || '—'}`].forEach(v => {
      const td = el('td', null, v); td.style.whiteSpace = 'pre-line'; tr.appendChild(td);
    });
    const td = el('td'); td.appendChild(el('span', 'status ' + d.status, STATUS[d.status])); tr.appendChild(td);
    tr.onclick = () => openDefect(d, { no: d.id, onDone: runReport });
    tb.appendChild(tr);
  });
  if (!rows.length) { const tr = el('tr'); const td = el('td', null, '沒有符合條件的缺失。'); td.colSpan = 5; tr.appendChild(td); tb.appendChild(tr); }
  $('rnote').textContent = rows.length > SHOW_MAX ? `畫面只列前 ${SHOW_MAX} 筆，匯出 Excel 會包含全部 ${rows.length} 筆。` : '';
}

async function photoCounts(ids) {
  const cnt = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('defect_photos').select('defect_id,kind').in('defect_id', ids.slice(i, i + 200)).limit(5000);
    if (error) throw error;
    data.forEach(p => { const c = cnt[p.defect_id] || (cnt[p.defect_id] = { before: 0, after: 0, sign: 0 }); c[p.kind]++; });
  }
  return cnt;
}
$('f-export').onclick = e => guard(e.currentTarget, async () => {
  if (!reportRows.length) { toast('目前沒有資料可匯出'); return; }
  if (!window.XLSX) throw new Error('匯出元件尚未載入，請稍後再試');
  const cnt = await photoCounts(reportRows.map(r => r.id));
  const head = ['編號', '案場', '檢查類型', '棟別', '樓層', '戶別', '客戶名稱', '空間', '工項', '缺失內容', '修繕方式', '修繕廠商', '責任廠商',
    '預計修繕日', '實際修繕日', '狀態', '結案方式', '不修原因', '簽認人', '簽認日期', '缺失說明', '建立者', '建立時間', '最後修改者', '最後修改時間', '修繕前照片數', '修繕後照片數'];
  const rows = reportRows.slice().sort((a, b) => a.id - b.id).map(d => [
    d.id, M.name('sites', d.site_id), M.name('inspect_types', d.inspect_type_id), M.name('buildings', d.building_id), d.floor, M.unitCode(d.unit_id),
    d.customer_name || '', M.name('spaces', d.space_id), M.name('categories', d.category_id), M.name('items', d.item_id),
    M.name('repair_methods', d.repair_method_id), M.name('vendors', d.fix_vendor_id), M.name('vendors', d.resp_vendor_id),
    d.planned_date || '', d.fixed_date || '', STATUS[d.status], d.close_type || '', d.close_reason || '', d.signed_name || '', d.signed_date || '', d.description || '',
    M.userName(d.created_by), fmtTime(d.created_at), M.userName(d.updated_by), fmtTime(d.updated_at),
    (cnt[d.id] || {}).before || 0, (cnt[d.id] || {}).after || 0]);
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws['!cols'] = head.map((h, i) => ({ wch: [6, 10, 10, 8, 6, 8, 12, 10, 14, 30, 8, 22, 22, 12, 12, 8, 10, 20, 10, 12, 30, 10, 16, 10, 16, 8, 8][i] }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '缺失清單');
  const d = new Date();
  XLSX.writeFile(wb, `品質查驗報表_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`);
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
  if (!reportRows.length) { toast('目前沒有資料可匯出'); return; }
  const kinds = ['before', 'after'].filter(k => $(k === 'before' ? 'f-ph-before' : 'f-ph-after').checked);
  if (!kinds.length) throw new Error('請至少勾選一種照片（修繕前或修繕後）');
  const rows = reportRows.slice().sort((a, b) => a.id - b.id);
  const ids = rows.map(r => r.id); let photos = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('defect_photos').select('id,defect_id,kind,path').in('defect_id', ids.slice(i, i + 200)).in('kind', kinds).order('id').limit(5000);
    if (error) throw error; photos = photos.concat(data);
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
  const textHead = ['編號', '棟別', '樓層', '戶別', '空間', '工項', '缺失內容', '修繕廠商', '責任廠商', '狀態', '預計修繕日', '實際修繕日', '缺失說明'];
  const kindName = { before: '修繕前', after: '修繕後' };
  const photoCols = []; kinds.forEach(k => { const n = Math.max(1, ...rows.map(r => (by[r.id + k] || []).length)); for (let j = 0; j < n; j++) photoCols.push({ kind: k, j }); });
  const head = textHead.concat(photoCols.map(c => `${kindName[c.kind]}照片${c.j + 1}`));
  ws.addRow(head); ws.getRow(1).font = { bold: true }; ws.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  const widths = [6, 8, 6, 8, 10, 14, 28, 20, 20, 8, 12, 12, 24];
  ws.columns = head.map((h, i) => ({ width: i < textHead.length ? widths[i] : 24 }));
  const IMG_W = 170, IMG_H = 128;
  rows.forEach((d, r) => {
    const row = ws.addRow([d.id, M.name('buildings', d.building_id), d.floor, M.unitCode(d.unit_id), M.name('spaces', d.space_id), M.name('categories', d.category_id),
      M.name('items', d.item_id), M.name('vendors', d.fix_vendor_id), M.name('vendors', d.resp_vendor_id), STATUS[d.status], d.planned_date || '', d.fixed_date || '', d.description || '']);
    row.alignment = { vertical: 'top', wrapText: true };
    const has = photoCols.some(c => (by[d.id + c.kind] || [])[c.j]);
    if (has) row.height = IMG_H * 0.75 + 6;
    photoCols.forEach((c, ci) => {
      const p = (by[d.id + c.kind] || [])[c.j]; const buf = p && imgs.get(p.id); if (!buf) return;
      const id = wb.addImage({ buffer: buf, extension: 'jpeg' });
      ws.addImage(id, { tl: { col: textHead.length + ci + 0.05, row: r + 1 + 0.05 }, ext: { width: IMG_W, height: IMG_H } });
    });
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const d0 = new Date(); a.download = `品質查驗報表_含照片_${d0.getFullYear()}${pad(d0.getMonth() + 1)}${pad(d0.getDate())}.xlsx`; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  toast(`已匯出 ${rows.length} 筆、${imgs.size} 張照片`);
});

// ---------- 匯出 PDF（用瀏覽器列印，目的地選「另存為 PDF」）----------
function filterSummary() {
  const parts = [];
  const add = (label, v) => { if (v) parts.push(`${label}：${v}`); };
  add('檢查類型', RF.itype && M.name('inspect_types', Number(RF.itype)));
  add('棟別', RF.bld && M.name('buildings', Number(RF.bld)));
  add('樓層', RF.floor);
  add('戶別', RF.unit && M.unitCode(Number(RF.unit)));
  add('工項', RF.cat && M.name('categories', Number(RF.cat)));
  add('狀態', RF.status && STATUS[RF.status]);
  add('修繕廠商', RF.fixv && M.name('vendors', Number(RF.fixv)));
  add('責任廠商', RF.respv && M.name('vendors', Number(RF.respv)));
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
  if (!reportRows.length) { toast('目前沒有資料可匯出'); return; }
  const root = $('print-root'); const rows = reportRows.slice().sort((a, b) => a.id - b.id);
  printHead(root, '品質查驗報表', rows.length);
  const t = el('table'); const th = el('thead'); const hr = el('tr');
  ['編號', '戶', '空間', '工項', '缺失內容', '修繕廠商', '責任廠商', '預計／實際修繕', '狀態', '缺失說明'].forEach(h => hr.appendChild(el('th', null, h)));
  th.appendChild(hr); t.appendChild(th); const tb = el('tbody');
  rows.forEach(d => {
    const tr = el('tr');
    [d.id, `${M.name('buildings', d.building_id)} ${d.floor} ${M.unitCode(d.unit_id)}`, M.name('spaces', d.space_id), M.name('categories', d.category_id), M.name('items', d.item_id),
      M.name('vendors', d.fix_vendor_id), M.name('vendors', d.resp_vendor_id), `${d.planned_date || '—'}\n${d.fixed_date || '—'}`, STATUS[d.status] + (d.close_type ? `（${d.close_type}）` : ''), d.description || ''
    ].forEach(v => { const td = el('td', null, String(v)); td.style.whiteSpace = 'pre-line'; tr.appendChild(td); });
    tb.appendChild(tr);
  });
  t.appendChild(tb); root.appendChild(t);
  printNow(true);
});
$('f-pdf-photo').onclick = e => guard(e.currentTarget, async () => {
  if (!reportRows.length) { toast('目前沒有資料可匯出'); return; }
  const kinds = ['before', 'after'].filter(k => $(k === 'before' ? 'f-ph-before' : 'f-ph-after').checked);
  if (!kinds.length) throw new Error('請至少勾選一種照片（修繕前或修繕後）');
  const rows = reportRows.slice().sort((a, b) => a.id - b.id);
  if (rows.length > 150) throw new Error(`含照片的 PDF 一次最多 150 筆，目前有 ${rows.length} 筆，請先縮小篩選條件（例如先選棟別或樓層）。`);
  const ids = rows.map(r => r.id); let photos = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await sb.from('defect_photos').select('id,defect_id,kind,path').in('defect_id', ids.slice(i, i + 200)).in('kind', kinds).order('id').limit(5000);
    if (error) throw error; photos = photos.concat(data);
  }
  const by = {}; photos.forEach(p => { const k = p.defect_id + p.kind; const a = (by[k] = by[k] || []); if (a.length < 4) a.push(p); });
  const use = Object.values(by).flat();
  const urls = await signedUrls('photos', use.map(p => p.path)); const url = new Map(use.map((p, i) => [p.id, urls[i]]));
  const root = $('print-root'); printHead(root, '品質查驗報表（含照片）', rows.length);
  const imgs = [];
  rows.forEach(d => {
    const c = el('div', 'card');
    c.appendChild(el('div', 'h', `#${d.id}　${M.name('buildings', d.building_id)} ${d.floor} ${M.unitCode(d.unit_id)}　${M.name('spaces', d.space_id) || ''}　［${STATUS[d.status]}${d.close_type ? '・' + d.close_type : ''}］`));
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
