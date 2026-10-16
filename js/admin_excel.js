/* 管理：用固定格式的 Excel 批次匯出／匯入設定（只新增與修改，不會刪除任何東西） */
const XL_SHEETS = {
  bld: ['棟別樓層', ['棟別', '樓層', '排序', '狀態']],
  unit: ['戶別', ['棟別', '戶別', '排序', '狀態']],
  space: ['空間別', ['檢查類型', '空間別', '圖面代號', '排序', '狀態']],
  cat: ['工項', ['工項', '預設廠商', '排序', '狀態']],
  item: ['缺失內容', ['工項', '缺失內容', '排序', '狀態']],
  vendor: ['廠商', ['廠商', '狀態']],
  method: ['修繕方式', ['修繕方式', '排序', '狀態']],
  itype: ['檢查類型', ['檢查類型', '排序', '狀態']],
};
const xlState = a => a ? '啟用' : '停用';

function xlHelpRows() {
  return [
    ['品質查驗系統｜設定表（固定格式）'],
    [''],
    ['用法：'],
    ['1. 每個工作表一種清單，第一列是欄位名稱，請不要改欄位名稱與工作表名稱。'],
    ['2. 從第二列起一列填一筆。名稱相同的會「修改」（排序、樓層、狀態…），名稱不存在的會「新增」。'],
    ['3. 匯入只新增與修改，不會刪除；要刪除或改名，請回系統「管理」逐項操作。'],
    ['4. 狀態欄填「啟用」或「停用」；留空＝新增的項目啟用、既有的項目不動。排序留空＝排在最後。'],
    ['5. 棟別樓層：樓層用「、」分隔，照順序，例：2F、3F、4F；匯入時會整格覆蓋該棟原本的樓層。'],
    ['6. 戶別、缺失內容要填的「棟別」「工項」「檢查類型」，必須是已存在，或同一份檔案裡有列出。'],
    ['7. 工項的「預設廠商」可填多家，用「、」分隔；廠商不存在會自動新增；已設的對應不會被移除。'],
    ['8. 平面圖照片不在這裡，請到「管理 → 平面圖」批次上傳。'],
    [''],
    ['範例（棟別樓層）：'],
    ['棟別', '樓層', '排序', '狀態'],
    ['G棟', '2F、3F、4F', 1, '啟用'],
  ];
}

function xlBuildBook(withData) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(xlHelpRows()), '說明');
  const siteId = S.sel.siteId;
  const blds = M.list('buildings', false).filter(b => b.site_id === siteId);
  const bIds = new Set(blds.map(b => b.id));
  const D = {
    bld: blds.map(b => [b.name, b.floors.join('、'), b.sort, xlState(b.active)]),
    unit: S.m.units.filter(u => bIds.has(u.building_id)).slice()
      .sort((a, b) => (M.get('buildings', a.building_id).sort - M.get('buildings', b.building_id).sort) || bySort(a, b))
      .map(u => [M.name('buildings', u.building_id), u.code, u.sort, xlState(u.active)]),
    space: S.m.spaces.slice().sort((a, b) => a.inspect_type_id - b.inspect_type_id || bySort(a, b))
      .map(s => [M.name('inspect_types', s.inspect_type_id), s.name, s.code && s.code !== '0' ? s.code : '', s.sort, xlState(s.active)]),
    cat: M.list('categories', false).map(c => [c.name, S.m.category_vendors.filter(x => x.category_id === c.id).sort((a, b) => a.sort - b.sort)
      .map(x => M.name('vendors', x.vendor_id)).filter(Boolean).join('、'), c.sort, xlState(c.active)]),
    item: S.m.items.slice().sort((a, b) => (M.get('categories', a.category_id).sort - M.get('categories', b.category_id).sort) || bySort(a, b))
      .map(i => [M.name('categories', i.category_id), i.name, i.sort, xlState(i.active)]),
    vendor: M.list('vendors', false).map(v => [v.name, xlState(v.active)]),
    method: M.list('repair_methods', false).map(r => [r.name, r.sort, xlState(r.active)]),
    itype: M.list('inspect_types', false).map(r => [r.name, r.sort, xlState(r.active)]),
  };
  Object.keys(XL_SHEETS).forEach(k => {
    const [name, head] = XL_SHEETS[k];
    const ws = XLSX.utils.aoa_to_sheet([head].concat(withData ? D[k] : []));
    ws['!cols'] = head.map(h => ({ wch: h === '樓層' || h === '預設廠商' ? 36 : 16 }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  return wb;
}

// ---------- 讀檔 ----------
function xlRead(wb) {
  const out = {};
  Object.keys(XL_SHEETS).forEach(k => {
    const [name, head] = XL_SHEETS[k]; const ws = wb.Sheets[name];
    if (!ws) { out[k] = null; return; }
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }).map(r => {
      const o = {}; Object.keys(r).forEach(c => { o[String(c).trim()] = String(r[c]).trim(); }); return o;
    }).filter(r => Object.values(r).some(v => v !== ''));
    out[k] = { rows, missing: head.filter(h => !(rows.length ? h in rows[0] : true)) };
  });
  return out;
}
function xlSort(v) { if (v === '' || v == null) return undefined; const n = Number(v); if (!isFinite(n)) throw new Error('排序「' + v + '」不是數字'); return n; }
function xlActive(v) { if (!v) return undefined; if (/^(停用|否|n|no|0|false)$/i.test(v)) return false; if (/^(啟用|是|y|yes|1|true)$/i.test(v)) return true; throw new Error('狀態「' + v + '」請填 啟用 或 停用'); }

// ---------- 比對（預覽與實際執行共用）----------
// o.row(r) → { k:去重用的鍵, ex:既有資料或null, base:新增時才需要的固定欄位, want:要設定的欄位 }
function xlStage(label, table, rows, o) {
  const res = { label, table, inserts: [], updates: [], warns: [], names: [] };
  const seen = new Set();
  (rows || []).forEach((r, i) => {
    const where = `「${label}」第 ${i + 2} 列`;
    try {
      const x = o.row(r);
      if (seen.has(x.k)) { res.warns.push(where + '：和前面重複，略過'); return; }
      seen.add(x.k);
      if (x.ex) {
        const patch = {};
        Object.keys(x.want).forEach(f => {
          if (x.want[f] === undefined) return;
          const a = Array.isArray(x.ex[f]) ? x.ex[f].join('、') : String(x.ex[f] ?? '');
          const b = Array.isArray(x.want[f]) ? x.want[f].join('、') : String(x.want[f]);
          if (a !== b) patch[f] = x.want[f];
        });
        if (Object.keys(patch).length) res.updates.push({ id: x.ex.id, patch });
      } else {
        const ins = Object.assign({}, x.base); Object.keys(x.want).forEach(f => { if (x.want[f] !== undefined) ins[f] = x.want[f]; });
        res.inserts.push(ins); res.names.push(x.nm);
      }
    } catch (e) { res.warns.push(where + '：' + e.message); }
  });
  return res;
}

// 以目前的資料庫狀態算出某一階段要做什麼；pend＝預覽時「這份檔案會先建立」的名稱
function xlCompute(stage, data, pend) {
  const siteId = S.sel.siteId; const cnt = {};
  const ns = (key, rows) => { cnt[key] = (cnt[key] || 0) + 1; return nextSort(rows) + cnt[key] - 1; };
  const bldRows = () => S.m.buildings.filter(b => b.site_id === siteId);
  const need = (row, col) => { if (!row[col]) throw new Error('「' + col + '」不能空白'); return row[col]; };
  const findB = n => bldRows().find(b => b.name === n) || (pend.bld.has(n) ? { id: null } : (() => { throw new Error('找不到棟別「' + n + '」'); })());
  const findT = n => S.m.inspect_types.find(t => t.name === n) || (pend.itype.has(n) ? { id: null } : (() => { throw new Error('找不到檢查類型「' + n + '」'); })());
  const findC = n => S.m.categories.find(c => c.name === n) || (pend.cat.has(n) ? { id: null } : (() => { throw new Error('找不到工項「' + n + '」'); })());
  const rowsOf = k => data[k] ? data[k].rows : [];

  switch (stage) {
    case 'itype': return xlStage('檢查類型', 'inspect_types', rowsOf('itype'), { row: r => {
      const n = need(r, '檢查類型'), ex = S.m.inspect_types.find(t => t.name === n), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      return { k: n, nm: n, ex, base: { sort: ns('it', S.m.inspect_types), active: true }, want: { name: n, sort: s, active: a } };
    } });
    case 'method': return xlStage('修繕方式', 'repair_methods', rowsOf('method'), { row: r => {
      const n = need(r, '修繕方式'), ex = S.m.repair_methods.find(t => t.name === n), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      return { k: n, nm: n, ex, base: { sort: ns('rm', S.m.repair_methods), active: true }, want: { name: n, sort: s, active: a } };
    } });
    case 'vendor': {
      const rows = rowsOf('vendor').slice(); const have = new Set(rows.map(r => r['廠商']));
      rowsOf('cat').forEach(c => splitNames(c['預設廠商'] || '').forEach(v => { if (!have.has(v)) { have.add(v); rows.push({ 廠商: v, 狀態: '' }); } }));
      return xlStage('廠商', 'vendors', rows, { row: r => {
        const n = need(r, '廠商'), ex = S.m.vendors.find(t => t.name === n), a = xlActive(r['狀態']);
        return { k: n, nm: n, ex, base: { active: true }, want: { name: n, active: a } };
      } });
    }
    case 'bld': return xlStage('棟別樓層', 'buildings', rowsOf('bld'), { row: r => {
      const n = need(r, '棟別'), ex = bldRows().find(b => b.name === n), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      const fl = r['樓層'] === '' ? undefined : splitNames(r['樓層'].replace(/\s+/g, '、'));
      return { k: n, nm: n, ex, base: { site_id: siteId, floors: [], sort: ns('b', bldRows()), active: true }, want: { name: n, floors: fl, sort: s, active: a } };
    } });
    case 'unit': return xlStage('戶別', 'units', rowsOf('unit'), { row: r => {
      const bn = need(r, '棟別'), code = need(r, '戶別'), b = findB(bn), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      const ex = b.id == null ? null : S.m.units.find(u => u.building_id === b.id && u.code === code);
      const mine = S.m.units.filter(u => u.building_id === b.id);
      return { k: bn + '|' + code, nm: bn + ' ' + code, ex, base: { building_id: b.id, sort: ns('u' + b.id, mine), active: true }, want: { code, sort: s, active: a } };
    } });
    case 'space': return xlStage('空間別', 'spaces', rowsOf('space'), { row: r => {
      const tn = need(r, '檢查類型'), n = need(r, '空間別'), t = findT(tn), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      const ex = t.id == null ? null : S.m.spaces.find(x => x.inspect_type_id === t.id && x.name === n);
      const mine = S.m.spaces.filter(x => x.inspect_type_id === t.id);
      return { k: tn + '|' + n, nm: tn + ' ' + n, ex, base: { inspect_type_id: t.id, code: '', sort: ns('s' + t.id, mine), active: true },
        want: { name: n, code: r['圖面代號'] === '' ? undefined : r['圖面代號'], sort: s, active: a } };
    } });
    case 'cat': return xlStage('工項', 'categories', rowsOf('cat'), { row: r => {
      const n = need(r, '工項'), ex = S.m.categories.find(c => c.name === n), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      return { k: n, nm: n, ex, base: { sort: ns('c', S.m.categories), active: true }, want: { name: n, sort: s, active: a } };
    } });
    case 'item': return xlStage('缺失內容', 'items', rowsOf('item'), { row: r => {
      const cn = need(r, '工項'), n = need(r, '缺失內容'), c = findC(cn), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      const ex = c.id == null ? null : S.m.items.find(x => x.category_id === c.id && x.name === n);
      const mine = S.m.items.filter(x => x.category_id === c.id);
      return { k: cn + '|' + n, nm: cn + ' ／ ' + n, ex, base: { category_id: c.id, sort: ns('i' + c.id, mine), active: true }, want: { name: n, sort: s, active: a } };
    } });
    case 'catvend': {                                     // 工項 ↔ 預設廠商（只新增對應）
      const res = { label: '工項的預設廠商', table: 'category_vendors', inserts: [], updates: [], warns: [], names: [] };
      rowsOf('cat').forEach(r => {
        if (!r['工項'] || !r['預設廠商']) return;
        const c = S.m.categories.find(x => x.name === r['工項']); let order = 0;
        splitNames(r['預設廠商']).forEach(vn => {
          const v = S.m.vendors.find(x => x.name === vn);
          if (c && v) {
            const rows = S.m.category_vendors.filter(m => m.category_id === c.id);
            if (rows.some(m => m.vendor_id === v.id)) return;
            res.inserts.push({ category_id: c.id, vendor_id: v.id, sort: nextSort(rows) + order++ });
          } else if (pend.cat.has(r['工項']) || pend.vendor.has(vn) || c || v) res.inserts.push({ category_id: c ? c.id : null, vendor_id: v ? v.id : null, sort: order++ });
          res.names.push(r['工項'] + '→' + vn);
        });
      });
      return res;
    }
  }
}
const XL_ORDER = ['itype', 'method', 'vendor', 'bld', 'unit', 'space', 'cat', 'item', 'catvend'];

function xlPreview(data) {
  const pend = { bld: new Set(), itype: new Set(), cat: new Set(), vendor: new Set() };
  return XL_ORDER.map(st => {
    const r = xlCompute(st, data, pend); r.stage = st;
    if (pend[st]) r.names.forEach(n => pend[st].add(n));
    return r;
  });
}
async function xlApply(data, onStep) {
  for (const st of XL_ORDER) {
    await loadMaster();
    const r = xlCompute(st, data, { bld: new Set(), itype: new Set(), cat: new Set(), vendor: new Set() });
    onStep(r, 'start');
    for (let i = 0; i < r.inserts.length; i += 400) await q(sb.from(r.table).insert(r.inserts.slice(i, i + 400)));
    for (const u of r.updates) await q(sb.from(r.table).update(u.patch).eq('id', u.id));
    onStep(r, 'done');
  }
  await loadMaster();
}

// ---------- 畫面 ----------
function renderExcelAdmin(root) {
  const g = group('excel', 'Excel 批次設定', '匯出／填寫／匯入，新案場快速建立'); root.appendChild(g.d);
  g.body.appendChild(el('div', 'banner', '新案場：下載「空白範本」填好再匯入，就把棟別、戶別、空間、工項、缺失內容、廠商一次建好。已有資料：先「匯出目前設定」，在 Excel 改完再匯入。匯入只新增與修改，不會刪東西；上面逐項修改的功能都還在。'));
  const row = el('div', 'row');
  const ex = el('button', 'btn ghost', '匯出目前設定'); ex.onclick = () => { XLSX.writeFile(xlBuildBook(true), `設定_${today()}.xlsx`); };
  const tp = el('button', 'btn ghost', '下載空白範本'); tp.onclick = () => { XLSX.writeFile(xlBuildBook(false), '設定範本.xlsx'); };
  row.append(ex, tp); g.body.appendChild(row);
  g.body.appendChild(el('label', 'f', '選擇填好的 Excel 檔來匯入'));
  const fi = el('input'); fi.type = 'file'; fi.accept = '.xlsx,.xls'; fi.id = 'xl-file'; g.body.appendChild(fi);
  const out = el('div', 'stack'); out.id = 'xl-out'; g.body.appendChild(out);
  fi.onchange = async () => {
    const f = fi.files[0]; if (!f) return; out.innerHTML = '';
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const data = xlRead(wb);
      if (Object.values(data).every(x => x == null)) throw new Error('找不到任何設定工作表，請使用本系統匯出的檔案或空白範本。');
      const bad = [];
      Object.keys(data).forEach(k => { if (data[k] && data[k].missing.length) bad.push(`「${XL_SHEETS[k][0]}」缺少欄位：${data[k].missing.join('、')}`); });
      if (bad.length) throw new Error(bad.join('；') + '。請不要修改欄位名稱。');
      const plan = xlPreview(data);
      const tot = plan.reduce((s, p) => s + p.inserts.length + p.updates.length, 0);
      const box = el('div', 'sublist');
      plan.forEach(p => {
        const r = el('div', 'r'); r.append(el('span', 'grow', p.label), el('span', 'tag' + (p.inserts.length || p.updates.length ? ' ok' : ''), `新增 ${p.inserts.length}　修改 ${p.updates.length}`)); box.appendChild(r);
        p.warns.forEach(w => { const wr = el('div', 'hint', '⚠ ' + w); wr.style.color = 'var(--danger, #c0392b)'; box.appendChild(wr); });
      });
      out.appendChild(box);
      if (!tot) { out.appendChild(el('p', 'hint', '沒有需要新增或修改的項目。')); return; }
      out.appendChild(el('p', 'hint', `共 ${tot} 筆變動（有⚠的列會略過）。確認無誤再按匯入。`));
      const go = el('button', 'btn block', '確認匯入'); go.id = 'xl-go';
      go.onclick = () => guard(go, async () => {
        const log = el('div', 'sublist'); out.appendChild(log); let n = 0;
        await xlApply(data, (r, ph) => { if (ph === 'done' && (r.inserts.length || r.updates.length)) { n += r.inserts.length + r.updates.length; log.appendChild(el('div', 'hint', `✓ ${r.label}：新增 ${r.inserts.length}、修改 ${r.updates.length}`)); } });
        toast(`匯入完成，共 ${n} 筆`); fi.value = ''; renderAdmin();
      });
      out.appendChild(go);
    } catch (e) { console.warn(e); const m = el('div', 'banner', errMsg(e)); out.appendChild(m); }
  };
}
