/* 管理：用固定格式的 Excel 批次匯出／匯入設定（只新增與修改，不會刪除任何東西） */
const XL_SHEETS = {
  bld: ['棟別樓層', ['棟別', '樓層', '排序', '狀態']],
  unit: ['戶別', ['棟別', '戶別', '排序', '狀態']],
  space: ['空間別', ['空間別', '圖面代號', '排序', '狀態']],
  cat: ['工項', ['工項', '預設廠商', '排序', '狀態']],
  item: ['缺失內容', ['工項', '缺失內容', '排序', '狀態']],
  vendor: ['廠商', ['廠商', '狀態']],
  method: ['修繕方式', ['修繕方式', '排序', '狀態']],
  itype: ['檢查類型', ['檢查類型', '排序', '狀態']],
};
// 有「專有戶／公設」時，棟別樓層、戶別前面多一欄「區分」（兩區可以有同名的棟）；舊檔沒有這欄＝都算第一區
const xlZoned = () => M.list('zones', false).length > 0;
const xlOpt = (k, h) => h === '區分' || (k === 'unit' && h === '樓層');   // 新加的欄位：舊檔沒有也能匯入（沒有＝不動）
const xlHead = k => { const h = (xlZoned() && ['bld', 'unit', 'itype', 'cat', 'space'].includes(k) ? ['區分'] : []).concat(XL_SHEETS[k][1]);
  if (xlZoned() && k === 'unit') h.splice(h.indexOf('戶別') + 1, 0, '樓層'); return h; };
const xlZoneList = r => (r.zone_ids || []).map(z => M.name('zones', z)).filter(Boolean).join('、');   // 檢查類型、工項：空白＝每區都出現
const xlZoneName = b => xlZoned() ? M.name('zones', M.bldZone(b)) : '';
const xlBKey = (zn, n) => xlZoned() ? zn + ' ' + n : n;            // 棟別在檔案裡的辨識名稱
let xlSync = false;                 // 「完整同步」：Excel 沒列出的項目也處理
let XL_USE = null;                  // 已被缺失紀錄用過的項目
async function xlLoadUsage() {
  const rows = await fetchAll(() => sb.from('defects').select('id,inspect_type_id,building_id,unit_id,space_id,category_id,item_id,repair_method_id,fix_vendor_id,resp_vendor_id').order('id'));
  const u = { itype: new Set(), bld: new Set(), unit: new Set(), space: new Set(), cat: new Set(), item: new Set(), method: new Set(), vendor: new Set() };
  rows.forEach(d => {
    u.itype.add(d.inspect_type_id); u.bld.add(d.building_id); u.unit.add(d.unit_id); u.space.add(d.space_id); u.cat.add(d.category_id);
    u.item.add(d.item_id); u.method.add(d.repair_method_id); u.vendor.add(d.fix_vendor_id); u.vendor.add(d.resp_vendor_id);
  });
  XL_USE = u;
}
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
    ['6. 戶別、缺失內容要填的「棟別」「工項」，必須是已存在，或同一份檔案裡有列出。'],
    ['7. 工項的「預設廠商」可填多家，用「、」分隔；廠商必須已在「廠商」表；已設的對應不會被移除。'],
    ['8. 平面圖照片不在這裡，請到「管理 → 平面圖」批次上傳。'],
    ['9. 棟別樓層、戶別的「區分」欄填 專有戶 或 公設；兩區可以有同名的棟（例：兩邊都有 A棟）。留空＝專有戶。'],
    ['10. 戶別的「樓層」：這戶或使用空間出現在哪幾層（例：1F，或 B1F~B3F）；留空＝這棟每層都有。'],
    ['11. 檢查類型、工項、空間別的「區分」：用在哪一區，兩區都用填「專有戶、公設」；留空＝兩區都出現。'],
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
    bld: blds.map(b => (xlZoned() ? [xlZoneName(b)] : []).concat([b.name, b.floors.join('、'), b.sort, xlState(b.active)])),
    unit: S.m.units.filter(u => bIds.has(u.building_id)).slice()
      .sort((a, b) => (M.get('buildings', a.building_id).sort - M.get('buildings', b.building_id).sort) || bySort(a, b))
      .map(u => xlZoned() ? [xlZoneName(M.get('buildings', u.building_id)), M.name('buildings', u.building_id), u.code, (u.floors || []).join('、'), u.sort, xlState(u.active)]
        : [M.name('buildings', u.building_id), u.code, u.sort, xlState(u.active)]),
    space: S.m.spaces.slice().sort(bySort)
      .map(s => (xlZoned() ? [xlZoneList(s)] : []).concat([s.name, s.code && s.code !== '0' ? s.code : '', s.sort, xlState(s.active)])),
    cat: M.list('categories', false).map(c => (xlZoned() ? [xlZoneList(c)] : []).concat([c.name, S.m.category_vendors.filter(x => x.category_id === c.id).sort((a, b) => a.sort - b.sort)
      .map(x => M.name('vendors', x.vendor_id)).filter(Boolean).join('、'), c.sort, xlState(c.active)])),
    item: S.m.items.slice().sort((a, b) => (M.get('categories', a.category_id).sort - M.get('categories', b.category_id).sort) || bySort(a, b))
      .map(i => [M.name('categories', i.category_id), i.name, i.sort, xlState(i.active)]),
    vendor: M.list('vendors', false).map(v => [v.name, xlState(v.active)]),
    method: M.list('repair_methods', false).map(r => [r.name, r.sort, xlState(r.active)]),
    itype: M.list('inspect_types', false).map(r => (xlZoned() ? [xlZoneList(r)] : []).concat([r.name, r.sort, xlState(r.active)])),
  };
  Object.keys(XL_SHEETS).forEach(k => {
    const name = XL_SHEETS[k][0], head = xlHead(k);
    const ws = XLSX.utils.aoa_to_sheet([head].concat(withData ? D[k] : []));
    ws['!cols'] = head.map(h => ({ wch: h === '樓層' || h === '預設廠商' ? 36 : 16 }));   // 欄位順序跟 xlHead 一致
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  return wb;
}

// ---------- 讀檔 ----------
function xlRead(wb) {
  const out = {};
  Object.keys(XL_SHEETS).forEach(k => {
    const name = XL_SHEETS[k][0], head = xlHead(k); const ws = wb.Sheets[name];
    if (!ws) { out[k] = null; return; }
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }).map(r => {
      const o = {}; Object.keys(r).forEach(c => { o[String(c).trim()] = String(r[c]).trim(); }); return o;
    }).filter(r => Object.values(r).some(v => v !== ''));
    out[k] = { rows, missing: head.filter(h => !xlOpt(k, h) && !(rows.length ? h in rows[0] : true)), hasZone: !!rows.length && '區分' in rows[0], hasFloors: !!rows.length && '樓層' in rows[0] };
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
  res.removes = [];
  if (xlSync && o.scope && rows && !rows.length) res.emptySkip = true;   // 整張表清空：為安全起見不當成「全部刪除」
  if (xlSync && o.scope && (rows || []).length) {
    if (res.warns.length) res.skipSync = true;       // 這張表有問題列，為安全起見這次不處理刪除
    else res.removes = o.scope().filter(x => !seen.has(x.k)).map(x => ({ match: { id: x.ex.id }, nm: x.nm, used: o.used(x.ex), off: x.ex.active === false }))
      .filter(x => !(x.used && x.off));
  }
  return res;
}

// 以目前的資料庫狀態算出某一階段要做什麼；pend＝預覽時「這份檔案會先建立」的名稱
function xlCompute(stage, data, pend) {
  const siteId = S.sel.siteId; const cnt = {};
  const ns = (key, rows) => { cnt[key] = (cnt[key] || 0) + 1; return nextSort(rows) + cnt[key] - 1; };
  const bldRows = () => S.m.buildings.filter(b => b.site_id === siteId);
  const need = (row, col) => { if (!row[col]) throw new Error('「' + col + '」不能空白'); return row[col]; };
  const zones = M.list('zones', false), zone0 = zones[0];
  const rowZone = r => { if (!zones.length) return null; const zn = r['區分'] || zone0.name, z = zones.find(x => x.name === zn); if (!z) throw new Error('區分「' + zn + '」不存在'); return z; };
  const bldOf = (z, n) => bldRows().find(b => b.name === n && (!z || M.bldZone(b) === z.id));
  const findB = (z, n) => bldOf(z, n) || (pend.bld.has(xlBKey(z && z.name, n)) ? { id: null } : (() => { throw new Error('找不到棟別「' + (z && zones.length > 1 ? z.name + ' ' : '') + n + '」'); })());
  // 「區分」欄（檢查類型、工項）：多區用「、」分隔；空白＝每區都出現；舊檔沒有這欄＝不動
  const zoneIds = (k, r) => { if (!zones.length || !(data[k] && data[k].hasZone)) return undefined;
    return splitNames(r['區分'] || '').map(zn => { const z = zones.find(x => x.name === zn); if (!z) throw new Error('區分「' + zn + '」不存在'); return z.id; }); };
  const inScope = k => b => !zones.length || (data[k] && data[k].hasZone) || M.bldZone(b) === zone0.id;   // 舊檔沒有「區分」欄：完整同步只處理第一區
  const findC = n => S.m.categories.find(c => c.name === n) || (pend.cat.has(n) ? { id: null } : (() => { throw new Error('找不到工項「' + n + '」'); })());
  const rowsOf = k => data[k] ? data[k].rows : [];

  switch (stage) {
    case 'itype': return xlStage('檢查類型', 'inspect_types', rowsOf('itype'), { scope: () => S.m.inspect_types.map(e => ({ ex: e, k: e.name, nm: e.name })), used: e => XL_USE.itype.has(e.id), row: r => {
      const n = need(r, '檢查類型'), ex = S.m.inspect_types.find(t => t.name === n), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      return { k: n, nm: n, ex, base: { sort: ns('it', S.m.inspect_types), active: true }, want: { name: n, sort: s, active: a, zone_ids: zoneIds('itype', r) } };
    } });
    case 'method': return xlStage('修繕方式', 'repair_methods', rowsOf('method'), { scope: () => S.m.repair_methods.map(e => ({ ex: e, k: e.name, nm: e.name })), used: e => XL_USE.method.has(e.id), row: r => {
      const n = need(r, '修繕方式'), ex = S.m.repair_methods.find(t => t.name === n), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      return { k: n, nm: n, ex, base: { sort: ns('rm', S.m.repair_methods), active: true }, want: { name: n, sort: s, active: a } };
    } });
    case 'vendor': {
      const rows = rowsOf('vendor');
      return xlStage('廠商', 'vendors', rows, { scope: () => S.m.vendors.map(e => ({ ex: e, k: e.name, nm: e.name })), used: e => XL_USE.vendor.has(e.id), row: r => {
        const n = need(r, '廠商'), ex = S.m.vendors.find(t => t.name === n), a = xlActive(r['狀態']);
        return { k: n, nm: n, ex, base: { active: true }, want: { name: n, active: a } };
      } });
    }
    case 'bld': return xlStage('棟別樓層', 'buildings', rowsOf('bld'), { scope: () => bldRows().filter(inScope('bld')).map(e => ({ ex: e, k: xlBKey(xlZoneName(e), e.name), nm: xlBKey(xlZoneName(e), e.name) })), used: e => XL_USE.bld.has(e.id), row: r => {
      const z = rowZone(r), n = need(r, '棟別'), ex = bldOf(z, n), s = xlSort(r['排序']), a = xlActive(r['狀態']), key = xlBKey(z && z.name, n);
      const fl = r['樓層'] === '' ? undefined : parseFloors(r['樓層']);
      if (fl && fl.bad.length) throw new Error(`樓層「${fl.bad.join('、')}」沒辦法自動展開，請一層一層列出`);
      return { k: key, nm: key, ex, base: { site_id: siteId, floors: [], sort: ns('b', bldRows()), active: true, ...(z ? { zone_id: z.id } : {}) }, want: { name: n, floors: fl, sort: s, active: a } };
    } });
    case 'unit': return xlStage('戶別', 'units', rowsOf('unit'), { scope: () => S.m.units.filter(u => bldRows().filter(inScope('unit')).some(b => b.id === u.building_id)).map(e => { const eb = M.get('buildings', e.building_id), bk = xlBKey(xlZoneName(eb), eb.name); return { ex: e, k: bk + '|' + e.code, nm: bk + ' ' + e.code }; }), used: e => XL_USE.unit.has(e.id), row: r => {
      const z = rowZone(r), bn = xlBKey(z && z.name, need(r, '棟別')), code = need(r, '戶別'), b = findB(z, r['棟別']), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      const ex = b.id == null ? null : S.m.units.find(u => u.building_id === b.id && u.code === code);
      const mine = S.m.units.filter(u => u.building_id === b.id);
      // 樓層：這戶（使用空間）出現在哪幾層；空白＝每層都有；舊檔沒有這欄＝不動
      let fl; if (zones.length && data.unit && data.unit.hasFloors) {
        fl = parseFloors(r['樓層'] || ''); if (fl.bad.length) throw new Error(`樓層「${fl.bad.join('、')}」沒辦法自動展開`);
        const bf = b.id == null ? null : M.get('buildings', b.id).floors, no = bf ? fl.filter(f => !bf.includes(f)) : [];
        if (no.length) throw new Error(`${r['棟別']} 沒有 ${no.join('、')}，請先在「棟別樓層」加上這層`);
        fl = [...fl];
      }
      return { k: bn + '|' + code, nm: bn + ' ' + code, ex, base: { building_id: b.id, sort: ns('u' + b.id, mine), active: true }, want: { code, floors: fl, sort: s, active: a } };
    } });
    case 'space': return xlStage('空間別', 'spaces', rowsOf('space'), { scope: () => S.m.spaces.map(e => ({ ex: e, k: e.name, nm: e.name })), used: e => XL_USE.space.has(e.id), row: r => {
      // 空間別用「區分」（專有戶／公設）分，不再綁檢查類型；舊檔的「檢查類型」欄略過
      const n = need(r, '空間別'), ex = S.m.spaces.find(x => x.name === n), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      const typeId = (S.m.spaces[0] || {}).inspect_type_id || (S.m.inspect_types[0] || {}).id;   // 舊欄位，資料庫還要求有值
      return { k: n, nm: n, ex, base: { inspect_type_id: typeId, code: '', sort: ns('s', S.m.spaces), active: true },
        want: { name: n, code: r['圖面代號'] === '' ? undefined : r['圖面代號'], sort: s, active: a, zone_ids: S.noSpaceZones ? undefined : zoneIds('space', r) } };
    } });
    case 'cat': return xlStage('工項', 'categories', rowsOf('cat'), { scope: () => S.m.categories.map(e => ({ ex: e, k: e.name, nm: e.name })), used: e => XL_USE.cat.has(e.id), row: r => {
      const n = need(r, '工項'), ex = S.m.categories.find(c => c.name === n), s = xlSort(r['排序']), a = xlActive(r['狀態']);
      return { k: n, nm: n, ex, base: { sort: ns('c', S.m.categories), active: true }, want: { name: n, sort: s, active: a, zone_ids: zoneIds('cat', r) } };
    } });
    case 'item': return xlStage('缺失內容', 'items', rowsOf('item'), { scope: () => S.m.items.map(e => ({ ex: e, k: M.name('categories', e.category_id) + '|' + e.name, nm: M.name('categories', e.category_id) + ' ／ ' + e.name })), used: e => XL_USE.item.has(e.id), row: r => {
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
          if (!v && !pend.vendor.has(vn)) { res.warns.push(`「工項」${r['工項']}：預設廠商「${vn}」不在「廠商」表裡（是不是打錯字？請先在廠商表列出同名廠商），這個對應略過`); return; }
          if (c && v) {
            const rows = S.m.category_vendors.filter(m => m.category_id === c.id);
            if (rows.some(m => m.vendor_id === v.id)) return;
            res.inserts.push({ category_id: c.id, vendor_id: v.id, sort: nextSort(rows) + order++ });
          } else if (pend.cat.has(r['工項']) || pend.vendor.has(vn) || c || v) res.inserts.push({ category_id: c ? c.id : null, vendor_id: v ? v.id : null, sort: order++ });
          res.names.push(r['工項'] + '→' + vn);
        });
      });
      res.removes = [];
      if (xlSync && data.cat && data.cat.rows.length && !data.cat.missing.includes('預設廠商') && !res.warns.length) {
        data.cat.rows.forEach(r => {
          const c = S.m.categories.find(x => x.name === r['工項']); if (!c) return;
          const keep = new Set(splitNames(r['預設廠商'] || '').map(n => (S.m.vendors.find(v => v.name === n) || {}).id).filter(Boolean));
          S.m.category_vendors.filter(m => m.category_id === c.id && !keep.has(m.vendor_id)).forEach(m =>
            res.removes.push({ match: { category_id: m.category_id, vendor_id: m.vendor_id }, nm: c.name + '→' + M.name('vendors', m.vendor_id), used: false }));
        });
      }
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
async function xlRemove(r) {
  r.deleted = 0; r.deactivated = 0;
  for (const x of r.removes) {
    let dq = sb.from(r.table).delete(); Object.keys(x.match).forEach(c => { dq = dq.eq(c, x.match[c]); });
    const paths = r.table === 'units' ? S.m.plans.filter(p => p.unit_id === x.match.id).map(p => p.path) : [];
    const { error } = await dq;
    if (!error) { if (paths.length) await sb.storage.from('plans').remove(paths); r.deleted++; continue; }
    if (r.table !== 'category_vendors' && (error.code === '23503' || /foreign key|violates/i.test(error.message))) {
      await q(sb.from(r.table).update({ active: false }).eq('id', x.match.id)); r.deactivated++;
    } else throw error;
  }
}
async function xlApply(data, onStep) {
  if (xlSync) { await xlLoadUsage(); XLSX.writeFile(xlBuildBook(true), `備份_匯入前_${today()}.xlsx`); }
  for (const st of XL_ORDER) {
    await loadMaster();
    const r = xlCompute(st, data, { bld: new Set(), itype: new Set(), cat: new Set(), vendor: new Set() });
    onStep(r, 'start');
    for (let i = 0; i < r.inserts.length; i += 400) await q(sb.from(r.table).insert(r.inserts.slice(i, i + 400)));
    for (const u of r.updates) await q(sb.from(r.table).update(u.patch).eq('id', u.id));
    onStep(r, 'done');
  }
  if (xlSync) for (const st of XL_ORDER.slice().reverse()) {      // 先處理下層（缺失內容、戶別…）再處理上層
    await loadMaster();
    const r = xlCompute(st, data, { bld: new Set(), itype: new Set(), cat: new Set(), vendor: new Set() });
    if (!r.removes.length) continue;
    await xlRemove(r); onStep(r, 'removed');
  }
  await loadMaster();
}

// ---------- 畫面 ----------
function renderExcelAdmin(root) {
  const g = group('excel', 'Excel 批次設定', '匯出／填寫／匯入，新案場快速建立'); root.appendChild(g.d);
  g.body.appendChild(el('div', 'banner', '新案場：下載「空白範本」填好再匯入，就把棟別、戶別、空間、工項、缺失內容、廠商一次建好。已有資料：先「匯出目前設定」，在 Excel 改完再匯入。預設只新增與修改；勾選「完整同步」才會處理 Excel 裡刪掉的項目。上面逐項修改的功能都還在。'));
  const row = el('div', 'row');
  const ex = el('button', 'btn ghost', '匯出目前設定'); ex.onclick = () => { XLSX.writeFile(xlBuildBook(true), `設定_${today()}.xlsx`); };
  const tp = el('button', 'btn ghost', '下載空白範本'); tp.onclick = () => { XLSX.writeFile(xlBuildBook(false), '設定範本.xlsx'); };
  row.append(ex, tp); g.body.appendChild(row);
  g.body.appendChild(el('label', 'f', '選擇填好的 Excel 檔來匯入'));
  const fi = el('input'); fi.type = 'file'; fi.accept = '.xlsx,.xls'; fi.id = 'xl-file'; g.body.appendChild(fi);
  const sl = el('label', 'hint'); const sc = el('input'); sc.type = 'checkbox'; sc.id = 'xl-sync'; sc.checked = xlSync;
  sl.append(sc, document.createTextNode(' 完整同步：Excel 裡沒有的項目也處理（沒用過的刪除，用過的改成停用，舊紀錄保留；匯入前自動下載一份備份）'));
  g.body.appendChild(sl);
  const out = el('div', 'stack'); out.id = 'xl-out'; g.body.appendChild(out);
  let data = null;

  async function showPreview() {
    out.innerHTML = ''; if (!data) return;
    try {
      xlSync = sc.checked; if (xlSync) await xlLoadUsage();
      const plan = xlPreview(data);
      const nRm = plan.reduce((s, p) => s + p.removes.length, 0);
      const tot = plan.reduce((s, p) => s + p.inserts.length + p.updates.length, 0) + nRm;
      const box = el('div', 'sublist');
      plan.forEach(p => {
        const r = el('div', 'r'); const tag = `新增 ${p.inserts.length}　修改 ${p.updates.length}` + (xlSync ? `　移除 ${p.removes.length}` : '');
        r.append(el('span', 'grow', p.label), el('span', 'tag' + (p.inserts.length || p.updates.length || p.removes.length ? ' ok' : ''), tag)); box.appendChild(r);
        if (p.removes.length) {
          const del = p.removes.filter(x => !x.used).length, off = p.removes.length - del;
          const names = p.removes.slice(0, 12).map(x => x.nm + (x.used ? '（停用）' : '（刪除）')).join('、') + (p.removes.length > 12 ? '…' : '');
          box.appendChild(el('div', 'hint', `預估：刪除 ${del}、停用 ${off} → ${names}`));
        }
        if (p.skipSync) box.appendChild(el('div', 'hint', '⚠ 這張表有看不懂的列，這次不處理刪除'));
        if (p.emptySkip) box.appendChild(el('div', 'hint', '這張表是空的，完整同步不會因此刪除或停用任何項目（要清掉請在後台逐項停用）'));
        p.warns.forEach(w => { const wr = el('div', 'hint', '⚠ ' + w); wr.style.color = 'var(--danger, #c0392b)'; box.appendChild(wr); });
      });
      out.appendChild(box);
      if (!tot) { out.appendChild(el('p', 'hint', '沒有需要新增或修改的項目。')); return; }
      out.appendChild(el('p', 'hint', `共 ${tot} 筆變動（有⚠的列會略過）。` + (xlSync ? '完整同步會先下載備份檔，再動資料。' : '') + '確認無誤再按匯入。'));
      const go = el('button', 'btn block' + (nRm ? ' danger' : ''), nRm ? '確認同步（含刪除／停用）' : '確認匯入'); go.id = 'xl-go';
      go.onclick = () => guard(go, async () => {
        const log = el('div', 'sublist'); out.appendChild(log); let n = 0;
        await xlApply(data, (r, ph) => {
          if (ph === 'done' && (r.inserts.length || r.updates.length)) { n += r.inserts.length + r.updates.length; log.appendChild(el('div', 'hint', `✓ ${r.label}：新增 ${r.inserts.length}、修改 ${r.updates.length}`)); }
          if (ph === 'removed') { n += r.removes.length; log.appendChild(el('div', 'hint', `✓ ${r.label}：刪除 ${r.deleted}、停用 ${r.deactivated}`)); }
        });
        toast(`完成，共 ${n} 筆`); fi.value = ''; data = null; renderAdmin();
      });
      out.appendChild(go);
    } catch (e) { console.warn(e); out.appendChild(el('div', 'banner', errMsg(e))); }
  }
  sc.onchange = () => { xlSync = sc.checked; showPreview(); };
  fi.onchange = async () => {
    const f = fi.files[0]; if (!f) return; out.innerHTML = ''; data = null;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const d = xlRead(wb);
      if (Object.values(d).every(x => x == null)) throw new Error('找不到任何設定工作表，請使用本系統匯出的檔案或空白範本。');
      const bad = [];
      Object.keys(d).forEach(k => { if (d[k] && d[k].missing.length) bad.push(`「${XL_SHEETS[k][0]}」缺少欄位：${d[k].missing.join('、')}`); });
      if (bad.length) throw new Error(bad.join('；') + '。請不要修改欄位名稱。');
      data = d; await showPreview();
    } catch (e) { console.warn(e); out.appendChild(el('div', 'banner', errMsg(e))); }
  };
}
