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
    [`${M.name('buildings', d.building_id)} ${d.floor} ${M.unitCode(d.unit_id)}`, M.name('spaces', d.space_id),
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
    data.forEach(p => { const c = cnt[p.defect_id] || (cnt[p.defect_id] = { before: 0, after: 0 }); c[p.kind]++; });
  }
  return cnt;
}
$('f-export').onclick = e => guard(e.currentTarget, async () => {
  if (!reportRows.length) { toast('目前沒有資料可匯出'); return; }
  if (!window.XLSX) throw new Error('匯出元件尚未載入，請稍後再試');
  const cnt = await photoCounts(reportRows.map(r => r.id));
  const head = ['編號', '案場', '檢查類型', '棟別', '樓層', '戶別', '客戶名稱', '空間', '工項', '缺失內容', '修繕方式', '修繕廠商', '責任廠商',
    '預計修繕日', '實際修繕日', '狀態', '結案方式', '不修原因', '缺失說明', '建立者', '建立時間', '最後修改者', '最後修改時間', '修繕前照片數', '修繕後照片數'];
  const rows = reportRows.slice().sort((a, b) => a.id - b.id).map(d => [
    d.id, M.name('sites', d.site_id), M.name('inspect_types', d.inspect_type_id), M.name('buildings', d.building_id), d.floor, M.unitCode(d.unit_id),
    d.customer_name || '', M.name('spaces', d.space_id), M.name('categories', d.category_id), M.name('items', d.item_id),
    M.name('repair_methods', d.repair_method_id), M.name('vendors', d.fix_vendor_id), M.name('vendors', d.resp_vendor_id),
    d.planned_date || '', d.fixed_date || '', STATUS[d.status], d.close_type || '', d.close_reason || '', d.description || '',
    M.userName(d.created_by), fmtTime(d.created_at), M.userName(d.updated_by), fmtTime(d.updated_at),
    (cnt[d.id] || {}).before || 0, (cnt[d.id] || {}).after || 0]);
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  ws['!cols'] = head.map((h, i) => ({ wch: [6, 10, 10, 8, 6, 8, 12, 10, 14, 30, 8, 22, 22, 12, 12, 8, 10, 20, 30, 10, 16, 10, 16, 8, 8][i] }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '缺失清單');
  const d = new Date();
  XLSX.writeFile(wb, `品質查驗報表_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.xlsx`);
  toast(`已匯出 ${rows.length} 筆`);
});
