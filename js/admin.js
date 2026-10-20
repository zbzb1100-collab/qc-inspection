/* 管理：所有清單、平面圖、帳號都在這裡自己改（只有管理者看得到） */
const adminSel = {};              // 各編輯器目前選到的項目
const adminOpen = new Set(['bld']);
const adminShowOff = new Set();      // 哪些清單目前展開顯示「已停用」的項目
const splitNames = s => s.split(/[,，、\n]+/).map(x => x.trim()).filter(Boolean);
const nextSort = rows => rows.reduce((m, r) => Math.max(m, r.sort ?? 0), 0) + 1;
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
async function setUnitSpaces(unitIds, spaceIds) {      // 把這些戶的空間別整組換成 spaceIds
  await q(sb.from('unit_spaces').delete().in('unit_id', unitIds));
  const rows = []; unitIds.forEach(u => spaceIds.forEach(sp => rows.push({ unit_id: u, space_id: sp })));
  for (let i = 0; i < rows.length; i += 500) await q(sb.from('unit_spaces').insert(rows.slice(i, i + 500)));
}
function unitSpacesEditor(body, u) {
  const box = el('div', 'stack'); body.appendChild(box);
  if (S.noUnitSpaces) { box.appendChild(el('div', 'banner', '還沒建立「每戶空間別」資料表：請到 Supabase SQL Editor 執行 3_戶別空間.sql 一次，這裡才能使用。')); return; }
  const mine = () => S.m.unit_spaces.filter(m => m.unit_id === u.id).map(m => m.space_id);
  box.appendChild(el('label', 'f', `${u.code} 有哪些空間（點選＝有；全部不選＝填寫時顯示全部）`));
  const cs = el('div', 'chips'); box.appendChild(cs);
  const have = new Set(mine());
  M.list('spaces').forEach(sp => {
    const b = el('button', 'chip' + (have.has(sp.id) ? ' on' : ''), (sp.code && sp.code !== '0' ? sp.code + ' ' : '') + sp.name); b.type = 'button';
    b.onclick = () => guard(b, async () => {
      if (have.has(sp.id)) await q(sb.from('unit_spaces').delete().eq('unit_id', u.id).eq('space_id', sp.id));
      else await q(sb.from('unit_spaces').insert({ unit_id: u.id, space_id: sp.id }));
      await reloadAdmin();
    });
    cs.appendChild(b);
  });
  const sibs = S.m.units.filter(x => x.building_id === u.building_id && x.id !== u.id).sort(bySort);
  const row = el('div', 'inline-add'); const sel = el('select'); fillSelect(sel, sibs, null, '複製其他戶的空間設定…', x => `${x.code}（${S.m.unit_spaces.filter(m => m.unit_id === x.id).length} 個空間）`);
  const cp = el('button', 'btn ghost small', '複製到這戶'); cp.onclick = () => guard(cp, async () => {
    if (!sel.value) throw new Error('先選要複製哪一戶');
    await setUnitSpaces([u.id], S.m.unit_spaces.filter(m => m.unit_id === Number(sel.value)).map(m => m.space_id)); await reloadAdmin(); toast('已複製');
  });
  row.append(sel, cp); box.appendChild(row);
  const all = el('button', 'btn ghost small', '把這戶的設定套用到同棟全部戶別'); all.onclick = () => {
    if (!all.dataset.arm) { all.dataset.arm = '1'; all.textContent = `確定覆蓋同棟其他 ${sibs.length} 戶？`; setTimeout(() => { delete all.dataset.arm; all.textContent = '把這戶的設定套用到同棟全部戶別'; }, 5000); return; }
    guard(all, async () => { await setUnitSpaces(sibs.map(x => x.id).concat(u.id), mine()); await reloadAdmin(); toast('已套用到同棟全部戶別'); });
  };
  box.appendChild(all);
}
// 這戶（使用空間）出現在哪幾層：點選＝有；全部不選＝這棟每層都有
function unitFloorsEditor(body, u) {
  const b = M.get('buildings', u.building_id); if (!b) return;
  if (S.noZones) return;
  body.appendChild(el('label', 'f', `${u.code} 在哪幾層（全部不選＝每層都有）`));
  const cs = el('div', 'chips'); body.appendChild(cs);
  const have = new Set(u.floors || []);
  b.floors.forEach(f => {
    const c = el('button', 'chip' + (have.has(f) ? ' on' : ''), f); c.type = 'button';
    c.onclick = () => guard(c, async () => {
      const fl = have.has(f) ? [...have].filter(x => x !== f) : b.floors.filter(x => have.has(x) || x === f);
      await q(sb.from('units').update({ floors: fl }).eq('id', u.id)); await reloadAdmin();
    });
    cs.appendChild(c);
  });
}
async function reloadAdmin() { await loadMaster(); renderAdmin(); }
const ZONE_SQL = '要先到 Supabase 執行 12_專有公設.sql';
// 這一項屬於哪幾區（專有戶／公設）：點選＝屬於；全部不選＝每區都出現
function zoneChips(body, table, r, title) {
  const zones = M.list('zones'); if (!zones.length) return;
  body.appendChild(el('label', 'f', title || `${r.name} 用在哪裡（可兩邊都選）`));
  const cs = el('div', 'chips'); body.appendChild(cs);
  const have = new Set(r.zone_ids || []);
  zones.forEach(z => {
    const b = el('button', 'chip' + (have.has(z.id) ? ' on' : ''), z.name); b.type = 'button';
    b.onclick = () => guard(b, async () => {
      const ids = have.has(z.id) ? [...have].filter(x => x !== z.id) : [...have, z.id];
      await q(sb.from(table).update({ zone_ids: ids }).eq('id', r.id)); await reloadAdmin();
    });
    cs.appendChild(b);
  });
}
const zoneTag = b => M.list('zones').length > 1 ? `（${M.name('zones', M.zoneOf(b))}）` : '';

// 通用清單編輯器：點選 → 改名／排序／停用／刪除
// o = { key, table, rows, label, onAdd, placeholder, nameField?('name'|'code'), sortable?(預設 true), onSelect? }
function chipEditor(box, o) {
  box.innerHTML = '';
  const rows = o.rows; const selId = adminSel[o.key];
  const selRow = rows.find(r => r.id === selId) || null;
  const nameField = o.nameField || 'name'; const sortable = o.sortable !== false;
  const cs = el('div', 'chips');
  const offN = rows.filter(r => r.active === false).length; const showOff = adminShowOff.has(o.key);
  rows.filter(r => showOff || r.active !== false || (selRow && selRow.id === r.id)).forEach(r => {
    const b = el('button', 'chip' + (r.active === false ? ' off' : '') + (selRow && selRow.id === r.id ? ' sel' : ''), o.label(r));
    b.type = 'button'; b.onclick = () => { adminSel[o.key] = r.id; if (o.onSelect) o.onSelect(r); chipEditor(box, o); };
    cs.appendChild(b);
  });
  if (!rows.length) cs.appendChild(el('span', 'hint', '（還沒有項目）'));
  box.appendChild(cs);
  if (offN) {
    const tgl = el('button', 'btn ghost small', showOff ? `收起已停用（${offN}）` : `顯示已停用（${offN}）`); tgl.type = 'button';
    tgl.onclick = () => { showOff ? adminShowOff.delete(o.key) : adminShowOff.add(o.key); chipEditor(box, o); }; box.appendChild(tgl);
  }
  if (selRow) {
    const ed = el('div', 'inline-add');
    const inp = el('input'); inp.type = 'text'; inp.value = selRow[nameField] ?? ''; inp.title = '名稱'; ed.appendChild(inp);
    let so = null;
    if (sortable) { so = el('input'); so.type = 'number'; so.value = selRow.sort ?? 0; so.title = '排序'; so.placeholder = '排序'; so.style.flex = '0 0 72px'; ed.appendChild(so); }
    const save = el('button', 'btn ghost small', '儲存'); save.onclick = () => guard(save, async () => {
      const v = inp.value.trim(); if (!v) throw new Error('名稱不能空白');
      const patch = { [nameField]: v }; if (so) patch.sort = Number(so.value) || 0;
      await q(sb.from(o.table).update(patch).eq('id', selRow.id)); await reloadAdmin(); toast('已更新');
    });
    const tg = el('button', 'btn ghost small', selRow.active === false ? '啟用' : '停用'); tg.onclick = () => guard(tg, async () => {
      await q(sb.from(o.table).update({ active: selRow.active === false }).eq('id', selRow.id)); await reloadAdmin(); toast(selRow.active === false ? '已啟用' : '已停用');
    });
    const del = el('button', 'btn danger small', '刪除'); del.onclick = () => {
      if (!del.dataset.arm) { del.dataset.arm = '1'; del.textContent = '確定刪除？'; setTimeout(() => { delete del.dataset.arm; del.textContent = '刪除'; }, 4000); return; }
      guard(del, async () => {
        const { error } = await sb.from(o.table).delete().eq('id', selRow.id);
        if (error) {
          if (error.code === '23503' || /foreign key|violates/i.test(error.message)) throw new Error('「' + o.label(selRow) + '」已有缺失紀錄或下層資料在使用，不能刪除；請改用「停用」。');
          throw error;
        }
        adminSel[o.key] = null; await reloadAdmin(); toast('已刪除');
      });
    };
    ed.append(save, tg, del); box.appendChild(ed);
    if (o.merge) {                                    // 合併：A 和 B 其實是同一個，把 A 的紀錄全部改掛到 B，再刪掉 A
      const others = rows.filter(r => r.id !== selRow.id);
      const mr = el('div', 'inline-add'); const ms = el('select'); fillSelect(ms, others, null, '合併到…（選擇保留的那個）', r => o.label(r) + (r.active === false ? '（已停用）' : ''));
      const mb = el('button', 'btn ghost small', '合併'); mb.onclick = () => {
        if (!ms.value) { toast('先選要合併到哪一個'); return; }
        const tgt = others.find(r => String(r.id) === ms.value);
        if (!mb.dataset.arm) { mb.dataset.arm = '1'; mb.textContent = `確定把「${o.label(selRow)}」併入「${o.label(tgt)}」？`; setTimeout(() => { delete mb.dataset.arm; mb.textContent = '合併'; }, 5000); return; }
        guard(mb, async () => {
          for (const ref of o.merge.refs) await q(sb.from(ref[0]).update({ [ref[1]]: tgt.id }).eq(ref[1], selRow.id));
          if (o.merge.extra) await o.merge.extra(selRow, tgt);
          await q(sb.from(o.table).delete().eq('id', selRow.id));
          adminSel[o.key] = tgt.id; await reloadAdmin(); toast(`已合併，「${o.label(selRow)}」的紀錄都改成「${o.label(tgt)}」`);
        });
      };
      mr.append(ms, mb); box.appendChild(mr);
      box.appendChild(el('p', 'hint', '合併：兩個其實是同一個時用。選中的這個會消失，它所有舊紀錄改掛到你選的那個。'));
    }
    box.appendChild(el('p', 'hint', (sortable ? '排序：數字小的排前面。' : '') + '停用＝填寫時不再出現但保留舊紀錄；刪除＝只有從未被使用的項目能刪。'));
  }
  const ad = el('div', 'inline-add'); const ai = el('input'); ai.type = 'text'; ai.placeholder = o.placeholder || '新增…（可用「、」一次輸入多個）'; ad.appendChild(ai);
  const ab = el('button', 'btn small', '新增'); ab.onclick = () => guard(ab, async () => {
    const names = splitNames(ai.value); if (!names.length) throw new Error('請先輸入名稱');
    const dup = names.filter(n => rows.some(r => String(r[nameField] ?? '') === n));
    if (dup.length) throw new Error('「' + dup.join('、') + '」已經有了' + (rows.some(r => r.active === false && dup.includes(String(r[nameField]))) ? '（在「已停用」裡，按「顯示已停用」再啟用）' : '，不用重複新增'));
    await o.onAdd(names); await reloadAdmin(); toast(`已新增 ${names.length} 筆`);
  });
  ad.appendChild(ab); box.appendChild(ad);
}
function group(key, title, sub) {
  const d = el('details', 'admin-group'); d.open = adminOpen.has(key);
  d.addEventListener('toggle', () => { d.open ? adminOpen.add(key) : adminOpen.delete(key); });
  const s = el('summary'); s.style.cursor = 'pointer'; s.style.fontWeight = '700'; s.textContent = title;
  if (sub) s.appendChild(el('span', 'sub', '　' + sub));
  d.appendChild(s);
  const body = el('div', 'stack'); body.style.marginTop = '10px'; d.appendChild(body);
  return { d, body };
}

function simpleGroup(t, title, sub) {
  const root = $('admin-root');
  const g = group(t, title, sub); root.appendChild(g.d); const box = el('div', 'stack'); g.body.appendChild(box);
  chipEditor(box, { key: t, table: t, onSelect: t === 'inspect_types' && M.list('zones').length ? () => renderAdmin() : null, merge: t === 'repair_methods' ? { refs: [['defects', 'repair_method_id']] } : null, rows: M.list(t, false), label: r => r.name,
    onAdd: names => q(sb.from(t).insert(names.map((n, i) => ({ name: n, sort: nextSort(S.m[t]) + i })))),
    placeholder: '新增' + title });
  if (t === 'inspect_types') {   // 哪些檢查類型複驗合格後還要客戶簽認
    const sb2 = el('div', 'stack'); sb2.appendChild(el('label', 'f', '複驗合格後還要「客戶簽認」才結案的檢查類型'));
    const row = el('div', 'row'); row.style.gap = '14px';
    M.list('inspect_types').forEach(r => {
      const lab = el('label', 'hint'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = !!r.need_sign;
      ck.onchange = () => guard(ck, async () => {
        const { error } = await sb.from('inspect_types').update({ need_sign: ck.checked }).eq('id', r.id);
        if (error) { ck.checked = !ck.checked; throw (/need_sign/.test(error.message) ? new Error('要先到 Supabase 執行 7_待簽認.sql') : error); }
        await reloadAdmin(); toast('已更新');
      });
      lab.append(ck, document.createTextNode(' ' + r.name)); row.appendChild(lab);
    });
    sb2.appendChild(row); g.body.appendChild(sb2);
    const tz = M.get('inspect_types', adminSel.inspect_types);
    if (tz) zoneChips(g.body, 'inspect_types', tz);
  }
}

function renderAdmin() {
  const root = $('admin-root'); root.innerHTML = '';
  root.appendChild(el('div', 'banner', '清單都在這裡自己改，不用找廠商。新增或停用後，填寫頁馬上跟著變。'));
  const siteId = S.sel.siteId;
  renderExcelAdmin(root);
  renderImportAdmin(root);

  // 順序跟選戶畫面一致：案場 → 檢查類型 → 棟別／樓層 → 戶別
  simpleGroup('sites', '案場', '多個案場時，選戶畫面最上面的選單');
  { const g = group('zones', '專有戶／公設', '選戶畫面第一層'); root.appendChild(g.d);
    if (S.noZones) g.body.appendChild(el('div', 'banner', '還沒建立這一層：' + ZONE_SQL + ' 一次。'));
    else {
      const box = el('div', 'stack'); g.body.appendChild(box);
      chipEditor(box, { key: 'zones', table: 'zones', onSelect: () => renderAdmin(), rows: M.list('zones', false), label: r => r.name,
        onAdd: names => q(sb.from('zones').insert(names.map((n, i) => ({ name: n, sort: nextSort(S.m.zones) + i })))), placeholder: '新增區分' });
      const z = M.get('zones', adminSel.zones);
      if (z) {
        const row = el('div', 'inline-add'); const inp = el('input'); inp.type = 'text'; inp.value = z.unit_label || '戶別';
        const sv = el('button', 'btn ghost small', '儲存'); sv.onclick = () => guard(sv, async () => {
          const v = inp.value.trim(); if (!v) throw new Error('不能空白'); await q(sb.from('zones').update({ unit_label: v }).eq('id', z.id)); await reloadAdmin(); toast('已更新');
        });
        g.body.appendChild(el('label', 'f', `${z.name} 的第 5 層叫什麼（例：戶別、使用空間）`)); row.append(inp, sv); g.body.appendChild(row);
      }
      g.body.appendChild(el('p', 'hint', '檢查類型、工項在各自的清單裡勾選屬於哪一區；棟別在「棟別與樓層」選。'));
    } }
  simpleGroup('inspect_types', '檢查類型', '點一個可設定用在專有戶或公設');

  // 1 棟別與樓層
  { const g = group('bld', '棟別與樓層', '選戶畫面的棟別、樓層'); root.appendChild(g.d);
    const box = el('div', 'stack'); g.body.appendChild(box);
    chipEditor(box, { key: 'bld', table: 'buildings', onSelect: () => renderAdmin(), rows: M.list('buildings', false).filter(b => b.site_id === siteId), label: r => r.name + zoneTag(r),
      onAdd: names => q(sb.from('buildings').insert(names.map((n, i) => ({ site_id: siteId, name: n, floors: [], sort: nextSort(S.m.buildings) + i })))),
      placeholder: '新增棟別，例：G棟' });
    const b = M.get('buildings', adminSel.bld);
    if (b) {
      if (M.list('zones').length) {
        const zr = el('div', 'stack'); zr.appendChild(el('label', 'f', `${b.name} 屬於`)); const zc = el('div', 'chips'); zr.appendChild(zc);
        M.list('zones').forEach(z => {
          const c = el('button', 'chip' + (M.zoneOf(b) === z.id ? ' on' : ''), z.name); c.type = 'button';
          c.onclick = () => guard(c, async () => { await q(sb.from('buildings').update({ zone_id: z.id }).eq('id', b.id)); await reloadAdmin(); });
          zc.appendChild(c);
        });
        g.body.appendChild(zr);
      }
      const fl = el('div', 'stack'); fl.appendChild(el('label', 'f', `${b.name} 的樓層（這格才是設定；用「、」分隔，照順序，例：B1、1F、2F）`));
      const fi = el('input'); fi.type = 'text'; fi.value = b.floors.join('、'); fl.appendChild(fi);
      const sv = el('button', 'btn small', '儲存樓層'); sv.onclick = () => guard(sv, async () => {
        const floors = splitNames(fi.value.replace(/\s+/g, '、')); await q(sb.from('buildings').update({ floors }).eq('id', b.id)); await reloadAdmin(); toast('樓層已更新');
      });
      fl.appendChild(sv);
      // 小工具：一次產生連續樓層，填進上面那格（按了還是要按「儲存樓層」）
      const nums = b.floors.map(f => parseInt(f)).filter(n => !isNaN(n));
      const gen = el('details'); const gs = el('summary', 'hint', '小工具：一次填入連續樓層'); gs.style.cursor = 'pointer'; gen.appendChild(gs);
      const row = el('div', 'inline-add'); row.style.marginTop = '6px';
      const a = el('input'); a.type = 'number'; a.value = nums.length ? Math.min(...nums) : 1; a.min = 1; const z = el('input'); z.type = 'number'; z.value = nums.length ? Math.max(...nums) : 1;
      const gb = el('button', 'btn ghost small', '填入上面那格'); gb.type = 'button';
      gb.onclick = () => { const lo = Number(a.value), hi = Number(z.value); const out = []; for (let i = lo; i <= hi; i++) out.push(i + 'F'); fi.value = out.join('、'); fi.focus(); };
      row.append(a, el('span', 'hint', '～'), z, gb); gen.appendChild(row); fl.appendChild(gen);
      g.body.appendChild(fl);
    } }

  // 2 戶別
  { const g = group('unit', '戶別／使用空間', '公設的使用空間也在這裡建'); root.appendChild(g.d);
    const blds = M.list('buildings').filter(b => b.site_id === siteId);
    if (!blds.find(b => b.id === adminSel.unitBld)) adminSel.unitBld = blds[0] && blds[0].id;
    const sel = el('select'); fillSelect(sel, blds, adminSel.unitBld, null, b => b.name + zoneTag(b)); sel.onchange = () => { adminSel.unitBld = Number(sel.value); adminSel.unit = null; renderAdmin(); };
    g.body.appendChild(sel);
    const box = el('div', 'stack'); g.body.appendChild(box);
    chipEditor(box, { key: 'unit', table: 'units', nameField: 'code', onSelect: () => renderAdmin(), rows: S.m.units.filter(u => u.building_id === adminSel.unitBld).sort(bySort), label: r => r.code,
      onAdd: names => q(sb.from('units').insert(names.map((n, i) => ({ building_id: adminSel.unitBld, code: n, sort: nextSort(S.m.units.filter(u => u.building_id === adminSel.unitBld)) + i })))),
      placeholder: '新增戶別，例：A9' });
    const su = S.m.units.find(x => x.id === adminSel.unit); if (su) { unitFloorsEditor(g.body, su); unitSpacesEditor(g.body, su); }
    // 空間別總清單（新增、改名、圖面代號、排序、停用、合併）收在戶別裡面
    { const nd = el('details'); nd.open = adminOpen.has('space'); nd.addEventListener('toggle', () => { nd.open ? adminOpen.add('space') : adminOpen.delete('space'); });
      const ns = el('summary', null, '編輯空間別總清單（新增、改名、圖面代號、排序、停用）'); ns.style.cssText = 'cursor:pointer;font-weight:700;margin-top:10px'; nd.appendChild(ns);
      const nb = el('div', 'stack'); nb.style.marginTop = '8px'; nd.appendChild(nb); g.body.appendChild(nd);
      const rows = S.m.spaces.slice().sort(bySort);
      const typeId = (rows[0] || {}).inspect_type_id || (M.list('inspect_types', false)[0] || {}).id;
      const box2 = el('div', 'stack'); nb.appendChild(box2);
      chipEditor(box2, { key: 'space', table: 'spaces', rows, label: r => (r.code && r.code !== '0' ? r.code + ' ' : '') + r.name, merge: { refs: [['defects', 'space_id']], extra: async (a, b) => {
          const marks = S.m.plan_spaces; const done = new Set(marks.filter(m => m.space_id === b.id).map(m => m.plan_id));
          for (const m of marks.filter(m => m.space_id === a.id && !done.has(m.plan_id))) await q(sb.from('plan_spaces').update({ space_id: b.id }).eq('id', m.id));
          await q(sb.from('plan_spaces').delete().eq('space_id', a.id));
          const have = new Set(S.m.unit_spaces.filter(m => m.space_id === b.id).map(m => m.unit_id));
          for (const m of S.m.unit_spaces.filter(m => m.space_id === a.id && !have.has(m.unit_id))) await q(sb.from('unit_spaces').insert({ unit_id: m.unit_id, space_id: b.id }));
        } },
        onAdd: names => q(sb.from('spaces').insert(names.map((n, k) => ({ inspect_type_id: typeId, name: n, code: '', sort: nextSort(rows) + k })))),
        placeholder: '新增空間別，例：玄關' }); } }


  // 4 工項與缺失內容與廠商對應
  { const g = group('cat', '工項、缺失內容、預設廠商'); root.appendChild(g.d);
    g.body.appendChild(el('label', 'f', '工項（點一個來編輯它的缺失內容與廠商）'));
    const cbox = el('div', 'stack'); g.body.appendChild(cbox);
    chipEditor(cbox, { key: 'cat', table: 'categories', onSelect: () => renderAdmin(), rows: M.list('categories', false), label: r => r.name + (M.list('zones').length > 1 && (r.zone_ids || []).length === 1 ? `（${M.name('zones', r.zone_ids[0])}）` : ''),
      onAdd: names => q(sb.from('categories').insert(names.map((n, i) => ({ name: n, sort: nextSort(S.m.categories) + i })))),
      placeholder: '新增工項，例：20木地板' });
    const c = M.get('categories', adminSel.cat);
    if (c) {
      zoneChips(g.body, 'categories', c);
      g.body.appendChild(el('label', 'f', `${c.name} 的缺失內容`));
      const ibox = el('div', 'stack'); g.body.appendChild(ibox);
      chipEditor(ibox, { key: 'item', table: 'items', merge: { refs: [['defects', 'item_id']] }, rows: S.m.items.filter(i => i.category_id === c.id).sort(bySort), label: r => r.name,
        onAdd: names => q(sb.from('items').insert(names.map((n, i) => ({ category_id: c.id, name: n, sort: nextSort(S.m.items.filter(x => x.category_id === c.id)) + i })))),
        placeholder: '新增缺失內容' });
      g.body.appendChild(el('label', 'f', `${c.name} 的預設廠商（點選＝加入／移除；可多家）`));
      const vb = el('div', 'chips'); g.body.appendChild(vb);
      const mapped = new Set(S.m.category_vendors.filter(x => x.category_id === c.id).map(x => x.vendor_id));
      M.list('vendors').forEach(v => {
        const b = el('button', 'chip' + (mapped.has(v.id) ? ' on' : ''), v.name); b.type = 'button';
        b.onclick = () => guard(b, async () => {
          if (mapped.has(v.id)) await q(sb.from('category_vendors').delete().eq('category_id', c.id).eq('vendor_id', v.id));
          else await q(sb.from('category_vendors').insert({ category_id: c.id, vendor_id: v.id, sort: nextSort(S.m.category_vendors.filter(x => x.category_id === c.id)) }));
          await reloadAdmin();
        });
        vb.appendChild(b);
      });
      if (!M.list('vendors').length) vb.appendChild(el('span', 'hint', '還沒有廠商，請先到下面「廠商」新增。'));
      g.body.appendChild(el('p', 'hint', '預設廠商會變成填寫時「修繕廠商」的按鈕。'));
    } }

  // 5 廠商
  { const g = group('vendor', '廠商'); root.appendChild(g.d); const box = el('div', 'stack'); g.body.appendChild(box);
    chipEditor(box, { key: 'vendor', table: 'vendors', sortable: false,
      merge: { refs: [['defects', 'fix_vendor_id'], ['defects', 'resp_vendor_id']], extra: async (a, b) => {
        const have = new Set(S.m.category_vendors.filter(m => m.vendor_id === b.id).map(m => m.category_id));
        for (const m of S.m.category_vendors.filter(m => m.vendor_id === a.id && !have.has(m.category_id)))
          await q(sb.from('category_vendors').insert({ category_id: m.category_id, vendor_id: b.id, sort: m.sort }));
        await q(sb.from('category_vendors').delete().eq('vendor_id', a.id));
      } }, rows: M.list('vendors', false), label: r => r.name,
      onAdd: names => q(sb.from('vendors').insert(names.map(n => ({ name: n })))),
      placeholder: '新增廠商全名' }); }

  // 6 修繕方式
  simpleGroup('repair_methods', '修繕方式', '填寫時的「修繕方式」按鈕');

  // 7 平面圖
  renderPlanAdmin(root);

  // 8 帳號
  renderUserAdmin(root);
}

// ================= 平面圖 =================
function planName(p) { return p; }
async function uploadPlan(unit, variant, file) {
  const ext = (file.name.match(/\.(png|jpe?g|webp)$/i) || [, 'png'])[1].toLowerCase();
  const path = `${unit.code}${variant === '標準層' ? '' : '-' + variant}_${Date.now()}.${ext}`;
  const up = await sb.storage.from('plans').upload(path, file, { contentType: file.type || 'image/' + (ext === 'jpg' ? 'jpeg' : ext), upsert: true });
  if (up.error) throw up.error;
  const old = S.m.plans.find(p => p.unit_id === unit.id && p.variant === variant);
  if (old) {
    const { error } = await sb.from('plans').update({ path }).eq('id', old.id);
    if (error) { await sb.storage.from('plans').remove([path]); throw error; }
    await removeFiles('plans', [old.path]);
  } else {
    const { error } = await sb.from('plans').insert({ unit_id: unit.id, variant, path });
    if (error) { await sb.storage.from('plans').remove([path]); if (/check constraint|plans_variant/i.test(error.message)) throw new Error('要先到 Supabase 執行 4_樓層專屬圖.sql 一次，才能上傳各樓層專屬圖。'); throw error; }
  }
}
function renderPlanAdmin(root) {
  const g = group('plan', '平面圖', '每戶一張，2F 另一張'); root.appendChild(g.d);
  const nPlans = S.m.plans.length, nUnits = M.list('units', false).length;
  g.body.appendChild(el('div', 'hint', `目前已上傳 ${nPlans} 張（戶別共 ${nUnits} 戶）。`));
  // 批次匯入
  const bulk = el('div', 'stack'); bulk.appendChild(el('label', 'f', '批次匯入（檔名＝戶別，例：A1.png、A1-2F.png）'));
  const bi = el('input'); bi.type = 'file'; bi.multiple = true; bi.accept = 'image/*'; bulk.appendChild(bi);
  const log = el('div', 'sublist'); bulk.appendChild(log); g.body.appendChild(bulk);
  bi.onchange = async () => {
    const files = [...bi.files]; bi.value = ''; log.innerHTML = ''; let okN = 0;
    const units = M.list('units', false);
    for (const f of files) {
      const m = f.name.match(/^([A-Za-z]+\d+)(?:[-_ ]?(\d+F|B\d+F?|RF|PR|R\d+))?\.(png|jpe?g|webp)$/i);
      const row = el('div', 'r'); const lab = el('span', 'grow', f.name); const st = el('span', 'tag', '處理中…'); row.append(lab, st); log.appendChild(row);
      if (!m) { st.textContent = '檔名看不懂'; continue; }
      const hits = units.filter(u => u.code.toUpperCase() === m[1].toUpperCase());
      if (!hits.length) { st.textContent = `找不到戶別 ${m[1]}`; continue; }
      if (hits.length > 1) { st.textContent = `有 ${hits.length} 棟都叫 ${m[1]}，請到下方該戶個別上傳`; continue; }
      try { await uploadPlan(hits[0], m[2] ? m[2].toUpperCase() : '標準層', f); st.textContent = '完成'; st.classList.add('ok'); okN++; }
      catch (e) { st.textContent = '失敗：' + errMsg(e); }
    }
    await loadMaster(); toast(`成功 ${okN} / ${files.length} 張`); renderAdmin();
  };
  // 單戶管理
  g.body.appendChild(el('hr'));
  const blds = M.list('buildings').filter(b => b.site_id === S.sel.siteId);
  if (!blds.find(b => b.id === adminSel.plBld)) adminSel.plBld = blds[0] && blds[0].id;
  const sb1 = el('select'); fillSelect(sb1, blds, adminSel.plBld, null); sb1.onchange = () => { adminSel.plBld = Number(sb1.value); adminSel.plUnit = null; renderAdmin(); };
  const units = M.unitsOf(adminSel.plBld);
  if (!units.find(u => u.id === adminSel.plUnit)) adminSel.plUnit = units[0] && units[0].id;
  const su = el('select'); fillSelect(su, units, adminSel.plUnit, null, u => {
    const have = S.m.plans.filter(p => p.unit_id === u.id).length; return `${u.code}（${have ? have + ' 張' : '尚無圖'}）`;
  }); su.onchange = () => { adminSel.plUnit = Number(su.value); renderAdmin(); };
  const r1 = el('div', 'row'); r1.append(sb1, su); r1.querySelectorAll('select').forEach(s => { s.style.flex = '1'; s.style.minWidth = '120px'; });
  g.body.appendChild(r1);
  const unit = M.get('units', adminSel.plUnit);
  if (unit) {
    const marksBox = el('div', 'stack');
    const bld = M.get('buildings', unit.building_id);
    const fl = bld ? bld.floors : [];
    const addRow = (parent, variant, title) => {
      const p = S.m.plans.find(x => x.unit_id === unit.id && x.variant === variant);
      const r = el('div', 'r'); r.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:6px 0';
      r.appendChild(el('b', null, title));
      r.appendChild(el('span', 'tag' + (p ? ' ok' : ''), p ? '已上傳' : '未上傳'));
      const lab = el('label', 'btn ghost small', p ? '更換圖' : '上傳圖'); const fi = el('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none'; lab.appendChild(fi);
      fi.onchange = () => guard(lab, async () => { const f = fi.files[0]; if (!f) return; await uploadPlan(unit, variant, f); await reloadAdmin(); toast('已上傳'); });
      r.appendChild(lab);
      if (p) { const mb = el('button', 'btn ghost small', '標記空間位置'); mb.onclick = () => { adminSel.markPlan = p.id; renderAdmin(); }; r.appendChild(mb); }
      parent.appendChild(r);
    };
    const range = a => a.length > 4 ? a[0] + '～' + a[a.length - 1] : a.join('、');
    addRow(g.body, '標準層', `${unit.code} 共用圖（沒有專屬圖的樓層用這張${fl.length ? '：' + range(fl) : ''}）`);
    // 各樓層格局不同時，可以替那一層另外上傳專屬圖；填寫時優先用專屬圖
    const has2F = fl.includes('2F');
    if (has2F) addRow(g.body, '2F', `${unit.code} 2F 專屬圖`);
    const rest = fl.filter(f => f !== '2F');
    if (rest.length) {
      const dt = el('details'); const nUp = rest.filter(f => S.m.plans.some(x => x.unit_id === unit.id && x.variant === f)).length;
      dt.open = adminSel.floorPlansOpen === unit.id; dt.addEventListener('toggle', () => { adminSel.floorPlansOpen = dt.open ? unit.id : null; });
      const sm = el('summary', 'hint', `其他樓層專屬圖（選填，已傳 ${nUp} 張）`); sm.style.cursor = 'pointer'; dt.appendChild(sm);
      rest.forEach(f => addRow(dt, f, `${unit.code} ${f} 專屬圖`)); g.body.appendChild(dt);
    }
    g.body.appendChild(marksBox);
    const mp = S.m.plans.find(p => p.id === adminSel.markPlan && p.unit_id === unit.id);
    if (mp) renderMarkEditor(marksBox, mp);
  }
}
async function renderMarkEditor(box, plan) {
  box.appendChild(el('label', 'f', '點下面的空間，再到圖上點位置，在圖上放該空間的標記（有圖面代號顯示代號，沒有顯示名稱）。這戶有哪些空間，請到「戶別」設定'));
  const spaces = M.list('spaces').filter(s => s.name !== '全室');
  const chipsBox = el('div', 'chips'); box.appendChild(chipsBox);
  const wrap = el('div', 'plan'); const img = el('img'); img.alt = '平面圖'; wrap.appendChild(img); box.appendChild(wrap);
  const marks = S.m.plan_spaces.filter(m => m.plan_id === plan.id);
  const draw = () => {
    wrap.querySelectorAll('.mark').forEach(x => x.remove());
    S.m.plan_spaces.filter(m => m.plan_id === plan.id).forEach(m => {
      const sp = M.get('spaces', m.space_id); if (!sp) return;
      const d = el('div', 'mark', sp.code && sp.code !== '0' ? sp.code : sp.name); d.style.left = m.x * 100 + '%'; d.style.top = m.y * 100 + '%'; wrap.appendChild(d);
    });
    chipsBox.innerHTML = '';
    spaces.forEach(s => {
      const has = S.m.plan_spaces.some(m => m.plan_id === plan.id && m.space_id === s.id);
      const b = el('button', 'chip' + (adminSel.mkSpace === s.id ? ' on' : ''), `${s.code && s.code !== '0' ? s.code + ' ' : ''}${s.name}${has ? ' ✓' : ''}`); b.type = 'button';
      b.onclick = () => { adminSel.mkSpace = s.id; draw(); }; chipsBox.appendChild(b);
    });
    const cl = el('button', 'btn ghost small', '移除所選空間的標記'); cl.type = 'button';
    cl.onclick = () => guard(cl, async () => {
      if (!adminSel.mkSpace) throw new Error('先選一個空間');
      await q(sb.from('plan_spaces').delete().eq('plan_id', plan.id).eq('space_id', adminSel.mkSpace));
      S.m.plan_spaces = await q(sb.from('plan_spaces').select('*')); draw();
    });
    chipsBox.appendChild(cl);
  };
  wrap.onclick = async e => {
    if (!adminSel.mkSpace) { toast('先選一個空間'); return; }
    const r = img.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    try {
      const ex = marks.concat(S.m.plan_spaces).find(m => m.plan_id === plan.id && m.space_id === adminSel.mkSpace);
      if (ex) await q(sb.from('plan_spaces').update({ x, y }).eq('id', ex.id));
      else await q(sb.from('plan_spaces').insert({ plan_id: plan.id, space_id: adminSel.mkSpace, x, y }));
      S.m.plan_spaces = await q(sb.from('plan_spaces').select('*')); draw();
    } catch (err) { toast(errMsg(err)); }
  };
  draw();
  img.src = await signedUrl('plans', plan.path);
}

// ================= 帳號 =================
function renderUserAdmin(root) {
  const g = group('user', '帳號', '角色、停用'); root.appendChild(g.d);
  g.body.appendChild(el('div', 'banner', '新增帳號：到 Supabase 後台 Authentication → Users → Add user，建好後這裡就會出現，可改名字、設管理者、離職時停用。廠商帳號：角色選「廠商」並選是哪一家，他只會看到修繕廠商是自己的缺失，只能拍修繕後照片、按修繕完成。'));
  const list = el('div', 'sublist'); g.body.appendChild(list);
  S.m.profiles.slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).forEach(p => {
    const self = p.id === S.user.id;
    const r = el('div', 'r'); const nm = el('input'); nm.type = 'text'; nm.value = p.name || ''; nm.placeholder = '顯示名稱'; nm.style.flex = '1'; nm.style.minWidth = '110px';
    const em = el('span', 'hint', p.email || ''); em.style.width = '100%';
    const role = el('select'); [['user', '一般'], ['admin', '管理者'], ['vendor', '廠商']].forEach(([v, l]) => { const o = el('option', null, l); o.value = v; role.appendChild(o); }); role.value = p.role; role.style.width = 'auto';
    const ven = el('select'); fillSelect(ven, M.list('vendors'), p.vendor_id, '（選哪家廠商）'); ven.style.width = 'auto'; ven.hidden = p.role !== 'vendor';
    role.onchange = () => { ven.hidden = role.value !== 'vendor'; };
    const lab = el('label', 'hint'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = p.active; lab.append(ck, document.createTextNode(' 啟用'));
    if (self) { role.disabled = true; ck.disabled = true; }
    const sv = el('button', 'btn small', '儲存'); sv.onclick = () => guard(sv, async () => {
      if (role.value === 'vendor' && !ven.value) throw new Error('廠商帳號要選是哪一家廠商');
      const patch = { name: nm.value.trim(), role: role.value, active: ck.checked };
      if (role.value === 'vendor' || p.vendor_id != null) patch.vendor_id = role.value === 'vendor' ? Number(ven.value) : null;
      const { error } = await sb.from('profiles').update(patch).eq('id', p.id);
      if (error) throw (/profiles_role_check|vendor_id/.test(error.message) ? new Error('要先到 Supabase 執行 6_廠商帳號.sql，才能設定廠商帳號') : error);
      await reloadAdmin(); toast('已更新帳號');
    });
    r.append(nm, role, ven, lab, sv, em); list.appendChild(r);
  });
}
