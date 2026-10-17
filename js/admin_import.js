/* 後台：缺失批次匯入（驗屋報告轉好的 Excel，可連同照片打包成 zip） */
const IM_HEAD = ['棟別', '樓層', '戶別', '檢查類型', '空間', '工項', '缺失內容', '修繕方式', '修繕廠商', '責任廠商', '缺失說明', '照片', '報告編號', '對應備註'];
const IM_NEED = ['棟別', '樓層', '戶別', '檢查類型', '空間', '工項', '缺失內容'];

// 匯入範本：標題列鎖住；每格都有下拉（清單取自目前系統設定），樓層／戶別跟著棟別、缺失內容跟著工項
const IM_WIDTH = { 棟別: 8, 樓層: 8, 戶別: 8, 檢查類型: 14, 空間: 10, 工項: 13, 缺失內容: 30, 修繕方式: 12, 修繕廠商: 20, 責任廠商: 20, 缺失說明: 40, 照片: 22, 報告編號: 12, 對應備註: 30 };
async function imTemplate() {
  if (!window.ExcelJS) await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('缺失匯入', { views: [{ state: 'frozen', ySplit: 1 }] });
  const help = wb.addWorksheet('說明');
  const ls = wb.addWorksheet('清單');
  const L = n => { let s = ''; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };   // 0→A
  let col = 0;
  const put = (c, title, vals, bold = true) => { ls.getCell(1, c + 1).value = title; ls.getCell(1, c + 1).font = { bold }; vals.forEach((v, i) => { ls.getCell(i + 2, c + 1).value = v; }); };
  const single = (title, vals) => { const c = col++; put(c, title, vals); return `'清單'!$${L(c)}$2:$${L(c)}$${Math.max(2, vals.length + 1)}`; };
  const group = (title, pairs) => { col++; put(col++, title, [], false); const a = col; pairs.forEach(([n, vals]) => put(col++, n, vals)); return [a, col - 1]; };
  const blds = M.buildingsOf(S.sel.siteId), cats = M.list('categories').filter(c => M.itemsOf(c.id).length);
  const rB = single('棟別', blds.map(b => b.name)), rT = single('檢查類型', M.list('inspect_types').map(t => t.name));
  const rS = single('空間', M.list('spaces').map(x => x.name)), rC = single('工項', cats.map(c => c.name));
  const rM = single('修繕方式', M.list('repair_methods').map(x => x.name)), rV = single('廠商', M.list('vendors').map(x => x.name));
  const gF = group('樓層→', blds.map(b => [b.name, b.floors])), gU = group('戶別→', blds.map(b => [b.name, M.unitsOf(b.id).map(u => u.code)]));
  const gI = group('缺失內容→', cats.map(c => [c.name, M.itemsOf(c.id).map(i => i.name)]));
  for (let c = 1; c <= col; c++) ls.getColumn(c).width = 16;
  const dep = (key, [a, b]) => { const m = `MATCH($${key}2,'清單'!$${L(a)}$1:$${L(b)}$1,0)-1`; return `OFFSET('清單'!$${L(a)}$2,0,${m},COUNTA(OFFSET('清單'!$${L(a)}$2,0,${m},200,1)),1)`; };
  const dv = { 棟別: rB, 樓層: dep('A', gF), 戶別: dep('A', gU), 檢查類型: rT, 空間: rS, 工項: rC, 缺失內容: dep('F', gI), 修繕方式: rM, 修繕廠商: rV, 責任廠商: rV };
  ws.columns = IM_HEAD.map(h => ({ header: h, key: h, width: IM_WIDTH[h] || 12 }));
  const hr = ws.getRow(1); hr.height = 30;
  hr.eachCell((c, i) => {
    const need = IM_NEED.includes(IM_HEAD[i - 1]);
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: need ? 'FF1F3A5F' : 'FF3D5A80' } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'medium', color: { argb: 'FF22D3EE' } } };
    c.protection = { locked: true };
  });
  const N = 500;
  for (let r = 2; r <= N; r++) {
    const row = ws.getRow(r);
    IM_HEAD.forEach((h, i) => {
      const c = row.getCell(i + 1); c.protection = { locked: false };
      if (h === '缺失說明' || h === '對應備註') c.alignment = { wrapText: true, vertical: 'top' };
      if (dv[h]) c.dataValidation = { type: 'list', allowBlank: true, formulae: [dv[h]], showErrorMessage: true, errorTitle: '不在清單裡', error: '請用下拉選單選；清單沒有的項目，請先到系統後台新增。' };
    });
  }
  await ws.protect('', { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true, insertRows: true, deleteRows: true, sort: true, autoFilter: true });
  const t = M.list('inspect_types')[0], b = blds[0], c = cats[0];
  [['怎麼填'], ['1. 一列一筆缺失。深藍色標題是必填：棟別、樓層、戶別、檢查類型、空間、工項、缺失內容。'],
   ['2. 每格點右邊小箭頭用下拉選；樓層、戶別會跟著棟別，缺失內容會跟著工項。'],
   ['3. 修繕廠商空白＝用工項的預設廠商；責任廠商空白＝同修繕廠商。'],
   ['4. 照片：把照片和這個 Excel 一起壓成 zip，「照片」欄寫檔名，多張用「、」分開。'],
   ['5. 標題列已鎖住（避免改到欄名讀不到）；下面的格子可以自由填、插入或刪除列。'],
   ['6. 清單是下載當下的系統設定；後台新增了項目，請重新下載範本。'], [],
   ['範例（不要貼到「缺失匯入」頁；照著格式填即可）'], IM_HEAD,
   [b && b.name, b && b.floors[0], b && (M.unitsOf(b.id)[0] || {}).code, t && t.name, (M.list('spaces')[0] || {}).name, c && c.name, c && (M.itemsOf(c.id)[0] || {}).name, '', '', '', '牆面細紋，需補土重漆', 'L-1.jpg、L-2.jpg', 'L-1', '']]
    .forEach(r => help.addRow(r));
  help.getColumn(1).width = 12; help.getRow(1).font = { bold: true, size: 14 }; help.getRow(9).font = { bold: true };
  return wb;
}
const imKey = s => String(s || '').replace(/\s+/g, '').toLowerCase();
const imFind = (rows, v, f = r => r.name) => { const k = imKey(v); return k ? rows.find(r => imKey(f(r)) === k) : undefined; };

// 讀檔：xlsx 單檔，或 zip（裡面一個 xlsx ＋ 照片）
async function imReadFile(f) {
  const photos = new Map(); let buf;
  if (/\.zip$/i.test(f.name)) {
    if (!window.JSZip) await loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
    const zip = await JSZip.loadAsync(await f.arrayBuffer());
    const files = Object.values(zip.files).filter(z => !z.dir && !/(^|\/)(__MACOSX|\.)/.test(z.name));
    const xl = files.find(z => /\.xlsx?$/i.test(z.name));
    if (!xl) throw new Error('zip 裡找不到 Excel 檔');
    buf = await xl.async('arraybuffer');
    for (const z of files) if (/\.(jpe?g|png|webp)$/i.test(z.name)) photos.set(imKey(z.name.split('/').pop()), z);
  } else buf = await f.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets['缺失匯入'] || wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }).map(r => {
    const o = {}; Object.keys(r).forEach(c => { o[String(c).trim()] = String(r[c]).trim(); }); return o;
  }).filter(r => Object.values(r).some(v => v !== ''));
  const miss = IM_NEED.filter(h => rows.length && !(h in rows[0]));
  if (miss.length) throw new Error('缺少欄位：' + miss.join('、') + '。請用「下載匯入範本」的欄位名稱。');
  return { rows, photos };
}

// 把一列文字對應到資料庫 id；對不到的欄位記在 bad
function imResolve(r, photos) {
  const o = { src: r, bad: [], photoFiles: [], missingPhotos: [] };
  const b = imFind(M.buildingsOf(S.sel.siteId), r['棟別']);
  if (!b) o.bad.push('棟別'); o.building_id = b && b.id;
  o.floor = r['樓層'].toUpperCase();
  if (b && !b.floors.includes(o.floor)) o.bad.push('樓層');
  const u = b && imFind(M.unitsOf(b.id), r['戶別'], x => x.code);
  if (!u) o.bad.push('戶別'); o.unit_id = u && u.id;
  const t = imFind(M.list('inspect_types'), r['檢查類型']); if (!t) o.bad.push('檢查類型'); o.inspect_type_id = t && t.id;
  const sp = imFind(M.list('spaces'), r['空間']); o.space_id = sp ? sp.id : null;
  const c = imFind(M.list('categories'), r['工項']); o.category_id = c ? c.id : null;
  const it = c && imFind(M.itemsOf(c.id), r['缺失內容']); o.item_id = it ? it.id : null;
  const rm = imFind(M.list('repair_methods'), r['修繕方式']); o.repair_method_id = rm ? rm.id : null;
  const fv = imFind(M.list('vendors'), r['修繕廠商']) || (c && M.vendorsOfCat(c.id)[0]);
  o.fix_vendor_id = fv ? fv.id : null;
  const rv = imFind(M.list('vendors'), r['責任廠商']); o.resp_vendor_id = rv ? rv.id : o.fix_vendor_id;
  const no = r['報告編號'];
  o.description = [r['缺失說明'], no ? `（報告編號 ${no}）` : ''].join('') || null;
  String(r['照片'] || '').split(/[、,，;；\n]+/).map(s => s.trim()).filter(Boolean).forEach(n => {
    const z = photos.get(imKey(n.split('/').pop())); z ? o.photoFiles.push(z) : o.missingPhotos.push(n);
  });
  o.flag = !!String(r['對應備註'] || '').trim();   // 有備註＝AI 不確定，整列都給下拉可改
  o.pick = { space: !sp || o.flag, cat: !c || o.flag, item: !it || o.flag };   // 對不到或有疑問的欄位，預覽時給下拉選
  o.on = !o.bad.length;
  return o;
}
const imReady = o => !o.bad.length && o.space_id && o.category_id && o.item_id;

// 預覽表：對不到的欄位給下拉補選，確認後逐筆寫入（Excel 匯入、報告轉檔共用）
function imMountPreview(out, list, onDone) {

  function cellSel(o, field, rows, label) {
    const s = el('select'); s.style.minWidth = '8em';
    fillSelect(s, rows, o[field], '（請選）', label);
    s.onchange = () => { o[field] = s.value ? Number(s.value) : null; if (field === 'category_id') { o.item_id = null; o.pick.item = true;
      if (!imFind(M.list('vendors'), o.src['修繕廠商'])) { const v = o.category_id && M.vendorsOfCat(o.category_id)[0]; o.fix_vendor_id = v ? v.id : null; if (!imFind(M.list('vendors'), o.src['責任廠商'])) o.resp_vendor_id = o.fix_vendor_id; } } paint(); };
    return s;
  }
  function paint() {
    out.innerHTML = '';
    if (!list.length) return;
    const ok = list.filter(o => o.on && imReady(o)).length, todo = list.filter(o => o.on && !imReady(o)).length;
    out.appendChild(el('p', 'hint', `共 ${list.length} 列：可匯入 ${ok}　待補選 ${todo}　略過 ${list.filter(o => !o.on).length}` + (list.some(o => o.on && o.flag) ? `　有疑問 ${list.filter(o => o.on && o.flag).length}（藍底，已先選好，可直接下拉改）` : '')));
    const wrap = el('div', 'tablewrap'); const tb = el('table');
    const hr = el('tr'); ['匯入', '戶', '空間', '工項', '缺失內容', '說明／照片'].forEach(h => hr.appendChild(el('th', null, h)));
    const th = el('thead'); th.appendChild(hr); tb.appendChild(th);
    const body = el('tbody');
    list.forEach((o, i) => {
      const tr = el('tr'); tr.dataset.i = i;
      if (o.on && !imReady(o)) tr.style.background = 'color-mix(in srgb, var(--fixed) 14%, transparent)';
      else if (o.on && o.flag) tr.style.background = 'color-mix(in srgb, var(--accent) 8%, transparent)';
      if (!o.on) tr.style.opacity = '.5';
      const c0 = el('td'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = o.on; cb.disabled = !!o.bad.length;
      cb.onchange = () => { o.on = cb.checked; paint(); }; c0.appendChild(cb); tr.appendChild(c0);
      const r = o.src;
      tr.appendChild(el('td', null, `${r['棟別']} ${r['樓層']} ${r['戶別']}\n${r['檢查類型']}` + (o.bad.length ? `\n⚠ 對不到：${o.bad.join('、')}` : '')));
      const cs = el('td'); cs.appendChild(o.pick.space ? cellSel(o, 'space_id', M.list('spaces')) : document.createTextNode(M.name('spaces', o.space_id))); tr.appendChild(cs);
      const cc = el('td'); cc.appendChild(o.pick.cat ? cellSel(o, 'category_id', M.list('categories')) : document.createTextNode(M.name('categories', o.category_id))); tr.appendChild(cc);
      const ci = el('td'); ci.appendChild(!(o.pick.item || o.pick.cat) ? document.createTextNode(M.name('items', o.item_id)) : (o.category_id ? cellSel(o, 'item_id', M.itemsOf(o.category_id)) : el('span', 'hint', '先選工項'))); tr.appendChild(ci);
      [[cs, o.pick.space, '空間'], [cc, o.pick.cat, '工項'], [ci, o.pick.item || o.pick.cat, '缺失內容']].forEach(([td, p, k]) => { if (p) td.prepend(el('div', 'hint', '原文：' + (r[k] || '（空白）'))); });
      const cd = el('td', null, (o.description || '') + `\n照片 ${o.photoFiles.length} 張` + (o.missingPhotos.length ? `（找不到：${o.missingPhotos.join('、')}）` : '') + (r['對應備註'] ? `\n備註：${r['對應備註']}` : ''));
      tr.appendChild(cd);
      [...tr.children].forEach(td => { td.style.whiteSpace = 'pre-line'; });
      body.appendChild(tr);
    });
    tb.appendChild(body); wrap.appendChild(tb); out.appendChild(wrap);
    const go = el('button', 'btn block', `確認匯入 ${ok} 筆`); go.id = 'im-go'; go.disabled = !ok || !!todo;
    if (todo) out.appendChild(el('p', 'hint', '還有黃色列沒選好，選好或取消勾選後才能匯入。'));
    go.onclick = () => guard(go, async () => {
      const rows = list.filter(o => o.on && imReady(o)); const log = el('p', 'hint'); out.appendChild(log); let n = 0, np = 0;
      for (const o of rows) {
        const rec = { site_id: S.sel.siteId, inspect_type_id: o.inspect_type_id, building_id: o.building_id, floor: o.floor, unit_id: o.unit_id,
          plan_id: null, x: null, y: null, space_id: o.space_id, category_id: o.category_id, item_id: o.item_id,
          repair_method_id: o.repair_method_id, fix_vendor_id: o.fix_vendor_id, resp_vendor_id: o.resp_vendor_id,
          description: o.description, status: 'todo', created_by: S.user.id };
        const { data, error } = await sb.from('defects').insert(rec).select('id').single();
        if (error) throw new Error(`第 ${list.indexOf(o) + 2} 列：` + errMsg(error) + `（前 ${n} 筆已匯入）`);
        for (const z of o.photoFiles) {
          const blob = await compressImage(await z.async('blob'));
          await uploadPhoto(data.id, 'before', blob);
          np++;
        }
        o.on = false; o.done = true; n++; log.textContent = `匯入中… ${n}／${rows.length} 筆，照片 ${np} 張`;
      }
      toast(`完成：${n} 筆缺失、${np} 張照片`); list = []; out.innerHTML = '';
      out.appendChild(el('div', 'banner', `已匯入 ${n} 筆缺失、${np} 張照片。可到「報表」查看。`));
      if (onDone) await onDone(n, np);
    });
    out.appendChild(go);
  }
  paint();
}

function renderImportAdmin(root) {
  const g = group('import', '缺失批次匯入', '驗屋報告轉好的 Excel（可連照片打包成 zip）'); root.appendChild(g.d);
  g.body.appendChild(el('div', 'banner', '把驗屋報告整理成「缺失匯入」Excel，照片放在同一個 zip 裡（Excel 的「照片」欄寫檔名），選檔後會先預覽；黃色列是對不到清單的，請在該列選好空間／工項／缺失內容，或取消勾選略過。匯入的缺失都是「待修」，照片當修繕前照片，不標平面圖位置。'));
  const row = el('div', 'row');
  const tp = el('button', 'btn ghost', '下載匯入範本'); tp.onclick = () => guard(tp, async () => {
    const buf = await (await imTemplate()).xlsx.writeBuffer();
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = '缺失匯入範本.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  row.append(tp); g.body.appendChild(row);
  g.body.appendChild(el('label', 'f', '選擇 Excel 或 zip'));
  const fi = el('input'); fi.type = 'file'; fi.accept = '.xlsx,.xls,.zip'; fi.id = 'im-file'; g.body.appendChild(fi);
  const out = el('div', 'stack'); out.id = 'im-out'; g.body.appendChild(out);
  fi.onchange = async () => {
    const f = fi.files[0]; if (!f) return; out.innerHTML = '';
    try {
      const { rows, photos } = await imReadFile(f);
      if (!rows.length) throw new Error('Excel 裡沒有資料列');
      imMountPreview(out, rows.map(r => imResolve(r, photos)), () => { fi.value = ''; });
    } catch (e) { console.warn(e); out.appendChild(el('div', 'banner', errMsg(e))); }
  };
}
