/* 管理：所有清單、平面圖、帳號都在這裡自己改（只有管理者看得到）
   上面分頁，一頁只做一件事；清單都是表格：名稱直接點來改，右邊是排序、停用、更多（合併、刪除） */
const adminSel = {};              // 各編輯器目前選到的項目
const adminOpen = new Set();
const adminShowOff = new Set();      // 哪些清單目前展開顯示「已停用」的項目
let adminTab = 'struct';
const splitNames = s => s.split(/[,，、\n]+/).map(x => x.trim()).filter(Boolean);
const nextSort = rows => rows.reduce((m, r) => Math.max(m, r.sort ?? 0), 0) + 1;
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
async function reloadAdmin() { await loadMaster(); renderAdmin(); }
async function adminSave(fn, revert, msg = '已儲存') {   // 表格裡的勾選、改名：存檔後重畫；失敗就還原並顯示原因
  try { await fn(); await reloadAdmin(); if (msg) toast(msg); }
  catch (e) { if (revert) revert(); toast(errMsg(e)); }
}
async function setUnitSpaces(unitIds, spaceIds) {      // 把這些戶的空間別整組換成 spaceIds
  await q(sb.from('unit_spaces').delete().in('unit_id', unitIds));
  const rows = []; unitIds.forEach(u => spaceIds.forEach(sp => rows.push({ unit_id: u, space_id: sp })));
  for (let i = 0; i < rows.length; i += 500) await q(sb.from('unit_spaces').insert(rows.slice(i, i + 500)));
}
// 連續樓層縮成範圍給人看：2F、3F…19F → 2F~19F（存回去時 parseFloors 會再展開）
function compressFloors(fl) {
  const sp = f => { const m = String(f).match(/^(\D*)(\d+)(\D*)$/); return m && { p: m[1], n: Number(m[2]), s: m[3] }; };
  const out = []; let i = 0;
  while (i < fl.length) {
    let j = i; const a = sp(fl[i]);
    if (a) { let st = null; while (j + 1 < fl.length) { const b = sp(fl[j + 1]), c = sp(fl[j]); if (!b || b.p !== a.p || b.s !== a.s) break; const d = b.n - c.n; if (Math.abs(d) !== 1 || (st != null && d !== st)) break; st = d; j++; } }
    if (j - i >= 2) out.push(fl[i] + '~' + fl[j]); else out.push(...fl.slice(i, j + 1));
    i = j + 1;
  }
  return out.join('、');
}

// ---------- 專有戶／公設 ----------
const ZONE_SQL = '要先到 Supabase 執行 12_專有公設.sql';
const adminZone = () => { const zs = M.list('zones'); if (!zs.find(z => z.id === adminSel.zones)) adminSel.zones = zs[0] ? zs[0].id : null; return adminSel.zones; };
const zoneNew = () => adminZone() ? { zone_ids: [adminZone()] } : {};
// 「公設也用」這類勾選欄：r.zone_ids 空的＝每區都有
function zoneCols(table, nameOf) {
  const cur = adminZone(); if (!cur) return [];
  return M.list('zones').filter(z => z.id !== cur).map(z => ({
    head: `${z.name}也用`, cell: r => {
      const ids = (r.zone_ids || []).length ? r.zone_ids : M.list('zones').map(x => x.id);
      return checkCell(ids.includes(z.id), on => adminSave(() => q(sb.from(table).update({ zone_ids: on ? [...new Set([...ids, z.id])] : ids.filter(x => x !== z.id) }).eq('id', r.id))),
        `${nameOf(r)} 也用在${z.name}`);
    } }));
}
function checkCell(checked, onChange, title, cls) {
  const c = el('input', cls); c.type = 'checkbox'; c.checked = checked; if (title) c.title = title;
  c.onchange = () => onChange(c.checked, () => { c.checked = !c.checked; });
  return c;
}

// ---------- 通用表格清單 ----------
// o = { key, table, rows, nameField?, nameHead?, placeholder, onAdd(names, addVals), sortable?, merge?, cols?:[{head, cell(r), vertical?}],
//       detail?(r)→元素（點「展開」才出現在這列下面）, detailLabel?, more?(r, box)（「更多」裡多放的東西）, addFields?:[{placeholder, width}], hint? }
function listTable(box, o) {
  const nf = o.nameField || 'name', sortable = o.sortable !== false, cols = o.cols || [];
  const offN = o.rows.filter(r => r.active === false).length, showOff = adminShowOff.has(o.key);
  const rows = o.rows.filter(r => showOff || r.active !== false);
  const wrap = el('div', 'lt-wrap'); const t = el('table', 'lt'); wrap.appendChild(t); box.appendChild(wrap);
  const hr = el('tr'); hr.appendChild(el('th', 'nm', o.nameHead || '名稱（點一下就能改）'));
  hr.appendChild(el('th', null, ''));
  cols.forEach(c => { const th = el('th', c.vertical ? 'vt' : null); if (c.headEl) th.appendChild(c.headEl); else th.textContent = c.head; hr.appendChild(th); });
  if (o.detail) hr.appendChild(el('th', null, ''));
  const thead = el('thead'); thead.appendChild(hr); t.appendChild(thead);
  const tb = el('tbody'); t.appendChild(tb);
  const span = 2 + cols.length + (o.detail ? 1 : 0);
  if (!rows.length) { const tr = el('tr'); const td = el('td', 'empty', '（還沒有項目，在下面新增）'); td.colSpan = span; tr.appendChild(td); tb.appendChild(tr); }
  rows.forEach((r, i) => {
    const tr = el('tr', r.active === false ? 'off' : null); tr.dataset.name = r[nf] ?? '';
    const nm = el('td', 'nm'); const inp = el('input'); inp.type = 'text'; inp.value = r[nf] ?? ''; inp.title = '點一下就能改名，改完按 Enter';
    inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
    inp.onchange = () => adminSave(async () => { const v = inp.value.trim(); if (!v) throw new Error('名稱不能空白'); await q(sb.from(o.table).update({ [nf]: v }).eq('id', r.id)); },
      () => { inp.value = r[nf] ?? ''; }, '已改名');
    nm.appendChild(inp); if (r.active === false) nm.appendChild(el('span', 'tag', '已停用')); { const note = o.nameNote && o.nameNote(r); if (note) nm.appendChild(el('div', 'hint warn', note)); } tr.appendChild(nm);
    const tools = el('td', 'tools');
    if (sortable) {
      const up = el('button', 'ib', '↑'), dn = el('button', 'ib', '↓'); up.title = '往前移'; dn.title = '往後移'; up.disabled = i === 0; dn.disabled = i === rows.length - 1;
      up.onclick = () => adminSave(() => moveRow(o.table, rows, i, -1), null, ''); dn.onclick = () => adminSave(() => moveRow(o.table, rows, i, 1), null, '');
      tools.append(up, dn);
    }
    const tg = el('button', 'ib', r.active === false ? '啟用' : '停用'); tg.title = r.active === false ? '重新啟用' : (o.zoned ? '停用：每一區都不再出現，舊紀錄保留' : '停用：填寫時不再出現，舊紀錄保留');
    tg.onclick = () => adminSave(() => q(sb.from(o.table).update({ active: r.active === false }).eq('id', r.id)), null, r.active === false ? '已啟用' : '已停用');
    const mo = el('button', 'ib', '更多'); mo.title = '合併、刪除';
    const moreKey = 'more_' + o.key; mo.onclick = () => { adminSel[moreKey] = adminSel[moreKey] === r.id ? null : r.id; renderAdmin(); };
    const cur = adminZone();
    if (o.zoned && cur && M.list('zones').length > 1) {      // 從目前這一區拿掉（另一區不受影響）
      const zn = M.name('zones', cur), rm = el('button', 'ib', '移除'); rm.title = `從${zn}移除`;
      rm.onclick = () => {
        if (!rm.dataset.arm) { rm.dataset.arm = '1'; rm.textContent = `確定從${zn}移除？`; rm.classList.add('on'); setTimeout(() => { if (rm.isConnected) { delete rm.dataset.arm; rm.textContent = '移除'; rm.classList.remove('on'); } }, 4000); return; }
        guard(rm, async () => {
          const ids = (r.zone_ids || []).length ? r.zone_ids : M.list('zones').map(z => z.id), rest = ids.filter(z => z !== cur);
          if (rest.length) { await q(sb.from(o.table).update({ zone_ids: rest }).eq('id', r.id)); await reloadAdmin(); toast(`已從${zn}移除（${rest.map(z => M.name('zones', z)).join('、')}仍保留）`); return; }
          const { error } = await sb.from(o.table).delete().eq('id', r.id);
          if (error) {
            if (!(error.code === '23503' || /foreign key|violates/i.test(error.message))) throw error;
            await q(sb.from(o.table).update({ active: false }).eq('id', r.id)); await reloadAdmin(); toast(`「${r[nf]}」已有缺失紀錄，改成停用（舊紀錄保留）`); return;
          }
          await reloadAdmin(); toast(`已刪除「${r[nf]}」`);
        });
      };
      tools.appendChild(rm);
    }
    tools.append(tg, mo); tr.appendChild(tools);
    cols.forEach(c => { const td = el('td', c.cls || null); const v = c.cell(r); if (v != null) td.append(v); tr.appendChild(td); });
    if (o.detail) {
      const td = el('td'); const open = adminSel['det_' + o.key] === r.id;
      const b = el('button', 'ib' + (open ? ' on' : ''), (o.detailLabel ? o.detailLabel(r) : '展開') + (open ? ' ▴' : ' ▾'));
      b.onclick = () => { adminSel['det_' + o.key] = open ? null : r.id; renderAdmin(); };
      td.appendChild(b); tr.appendChild(td);
    }
    tb.appendChild(tr);
    if (adminSel[moreKey] === r.id) tb.appendChild(moreRow(o, r, span));
    if (o.detail && adminSel['det_' + o.key] === r.id) {
      const dr = el('tr', 'detail'); const td = el('td'); td.colSpan = span; td.appendChild(o.detail(r)); dr.appendChild(td); tb.appendChild(dr);
    }
  });
  if (offN) {
    const tgl = el('button', 'btn ghost small', showOff ? `收起已停用的（${offN}）` : `顯示已停用的（${offN}）`); tgl.type = 'button';
    tgl.onclick = () => { showOff ? adminShowOff.delete(o.key) : adminShowOff.add(o.key); renderAdmin(); }; box.appendChild(tgl);
  }
  // 新增
  const ad = el('div', 'lt-add'); const ai = el('input'); ai.type = 'text'; ai.placeholder = o.placeholder || '新增…（可用「、」一次輸入多個）'; ad.appendChild(ai);
  const extra = (o.addFields || []).map(f => { const x = el('input'); x.type = 'text'; x.placeholder = f.placeholder; if (f.width) x.style.flex = `0 1 ${f.width}`; ad.appendChild(x); return x; });
  const ab = el('button', 'btn small', '新增');
  const doAdd = () => guard(ab, async () => {
    const names = splitNames(ai.value); if (!names.length) throw new Error('請先輸入名稱');
    const dup = names.filter(n => o.rows.some(r => String(r[nf] ?? '') === n));
    if (dup.length) throw new Error('「' + dup.join('、') + '」已經有了' + (o.rows.some(r => r.active === false && dup.includes(String(r[nf]))) ? '（是停用的，按「顯示已停用的」再按啟用）' : '，不用重複新增'));
    await o.onAdd(names, extra.map(x => x.value.trim())); await reloadAdmin(); toast(`已新增 ${names.length} 筆`);
  });
  ab.onclick = doAdd; ai.onkeydown = e => { if (e.key === 'Enter') doAdd(); };
  ad.appendChild(ab); box.appendChild(ad);
  if (o.hint) box.appendChild(el('p', 'hint', o.hint));
}
async function moveRow(table, rows, i, d) {        // 跟上一個／下一個對調，整串重新編號，不用自己填排序數字
  const j = i + d; if (j < 0 || j >= rows.length) return;
  const a = rows.slice(); [a[i], a[j]] = [a[j], a[i]];
  await Promise.all(a.map((r, k) => r.sort === k + 1 ? null : q(sb.from(table).update({ sort: k + 1 }).eq('id', r.id))));
}
function moreRow(o, r, span) {
  const nf = o.nameField || 'name', label = r[nf];
  const tr = el('tr', 'more'); const td = el('td'); td.colSpan = span; tr.appendChild(td); const box = el('div', 'stack'); td.appendChild(box);
  if (o.more) o.more(r, box);
  if (o.merge) {                                    // 合併：A 和 B 其實是同一個，把 A 的紀錄全部改掛到 B，再刪掉 A
    const others = o.rows.filter(x => x.id !== r.id);
    const mr = el('div', 'inline-add'); const ms = el('select'); fillSelect(ms, others, null, `把「${label}」合併到…`, x => x[nf] + (x.active === false ? '（已停用）' : ''));
    const mb = el('button', 'btn ghost small', '合併'); mb.onclick = () => {
      if (!ms.value) { toast('先選要合併到哪一個'); return; }
      const tgt = others.find(x => String(x.id) === ms.value);
      if (!mb.dataset.arm) { mb.dataset.arm = '1'; mb.textContent = `確定併入「${tgt[nf]}」？`; setTimeout(() => { delete mb.dataset.arm; mb.textContent = '合併'; }, 5000); return; }
      guard(mb, async () => {
        for (const ref of o.merge.refs) await q(sb.from(ref[0]).update({ [ref[1]]: tgt.id }).eq(ref[1], r.id));
        if (o.merge.extra) await o.merge.extra(r, tgt);
        await q(sb.from(o.table).delete().eq('id', r.id));
        adminSel['more_' + o.key] = null; await reloadAdmin(); toast(`已合併，「${label}」的紀錄都改成「${tgt[nf]}」`);
      });
    };
    mr.append(ms, mb); box.appendChild(mr);
    box.appendChild(el('p', 'hint', '合併：兩個其實是同一個時用。這一個會消失，它所有舊紀錄改掛到你選的那個。'));
  }
  const delTxt = o.zoned && adminZone() && M.list('zones').length > 1 ? `整筆刪除「${label}」（每一區都刪）` : `刪除「${label}」`;
  const del = el('button', 'btn danger small', delTxt); del.onclick = () => {
    if (!del.dataset.arm) { del.dataset.arm = '1'; del.textContent = '再按一次確定刪除'; setTimeout(() => { delete del.dataset.arm; del.textContent = delTxt; }, 4000); return; }
    guard(del, async () => {
      const { error } = await sb.from(o.table).delete().eq('id', r.id);
      if (error) {
        if (error.code === '23503' || /foreign key|violates/i.test(error.message)) throw new Error(`「${label}」已有缺失紀錄或下層資料在用，不能刪除；請改按「停用」。`);
        throw error;
      }
      adminSel['more_' + o.key] = null; await reloadAdmin(); toast('已刪除');
    });
  };
  const dr = el('div', 'row'); dr.append(del, el('span', 'hint', '只有從來沒用過的才能刪；用過的請按「停用」。')); box.appendChild(dr);
  return tr;
}

// 區塊：標題＋「出現在填寫頁哪裡」一句話
function section(root, title, where, id) {
  const d = el('section', 'adm-sec'); if (id) d.id = id;
  d.appendChild(el('h3', null, title)); if (where) d.appendChild(el('div', 'where', where));
  const body = el('div', 'stack'); d.appendChild(body); root.appendChild(d); return body;
}
// 舊的折疊區塊（Excel、匯入、平面圖、帳號沿用）：現在每個分頁直接攤開
function group(key, title, sub) {
  const d = el('section', 'adm-sec'); const h = el('h3', null, title); d.appendChild(h);
  if (sub) d.appendChild(el('div', 'where', sub));
  const body = el('div', 'stack'); d.appendChild(body);
  return { d, body };
}
// 選棟：一排大按鈕
function bldPicker(body, key, blds) {
  if (!blds.find(b => b.id === adminSel[key])) adminSel[key] = blds[0] && blds[0].id;
  const cs = el('div', 'chips bld-pick');
  blds.forEach(b => { const c = el('button', 'chip' + (b.id === adminSel[key] ? ' on' : ''), M.bldLabel(b, blds)); c.type = 'button'; c.onclick = () => { adminSel[key] = b.id; renderAdmin(); }; cs.appendChild(c); });
  if (!blds.length) cs.appendChild(el('span', 'hint', '這一區還沒有棟別，請先到「選戶架構」新增。'));
  body.appendChild(cs);
  return M.get('buildings', adminSel[key]);
}

// ================= 主畫面 =================
const ADMIN_TABS = [['struct', '選戶架構'], ['space', '空間別'], ['cat', '工項與缺失'], ['vendor', '廠商'], ['plan', '平面圖'], ['user', '帳號'], ['batch', '批次匯入'], ['other', '其他']];
function renderAdmin() {
  const root = $('admin-root'); root.innerHTML = '';
  const tabs = el('div', 'adm-tabs'); tabs.id = 'adm-tabs';
  ADMIN_TABS.forEach(([k, n]) => { const b = el('button', adminTab === k ? 'on' : null, n); b.type = 'button'; b.dataset.tab = k; b.onclick = () => { adminTab = k; renderAdmin(); $('admin-root').closest('main')?.scrollTo(0, 0); }; tabs.appendChild(b); });
  root.appendChild(tabs);
  if (['struct', 'space', 'cat', 'plan'].includes(adminTab)) zoneBar(root);
  ({ struct: tabStruct, space: tabSpace, cat: tabCat, vendor: tabVendor, plan: renderPlanAdmin, user: renderUserAdmin, other: tabOther,
     batch: r => { renderExcelAdmin(r); renderImportAdmin(r); } })[adminTab](root);
}
function zoneBar(root) {
  if (S.noZones) { root.appendChild(el('div', 'banner', '還沒分「專有戶／公設」：' + ZONE_SQL + ' 一次。')); return; }
  const zs = M.list('zones'); if (zs.length < 2) return;
  const zid = adminZone();
  const bar = el('div', 'zone-bar'); bar.appendChild(el('span', 'lbl', '正在設定'));
  const seg = el('div', 'seg'); seg.id = 'adm-zone';
  zs.forEach(z => { const b = el('button', z.id === zid ? 'on' : null, z.name); b.type = 'button'; b.onclick = () => { adminSel.zones = z.id; renderAdmin(); }; seg.appendChild(b); });
  bar.appendChild(seg); bar.appendChild(el('span', 'hint', `下面只顯示${M.name('zones', zid)}的項目，新增的也放在${M.name('zones', zid)}`));
  root.appendChild(bar);
}

// ---------- 選戶架構：檢查類型 → 棟別、樓層 → 戶別 ----------
function tabStruct(root) {
  const siteId = S.sel.siteId, zid = adminZone(), ulab = zid ? M.unitLabel(zid) : '戶別';
  root.appendChild(el('div', 'flow', `選戶畫面依序選：檢查類型 → 棟別 → 樓層 → ${ulab}。由上往下設定。`));

  // 檢查類型
  { const body = section(root, '檢查類型', '選戶畫面最上面的按鈕，例：交屋檢查、第三方驗收', 'sec-type');
    const cols = [{ head: '複驗後要客戶簽認', cell: r => checkCell(!!r.need_sign, (on, back) => adminSave(async () => {
      const { error } = await sb.from('inspect_types').update({ need_sign: on }).eq('id', r.id);
      if (error) throw (/need_sign/.test(error.message) ? new Error('要先到 Supabase 執行 7_待簽認.sql') : error);
    }, back), `${r.name} 複驗後要客戶簽認`) }, ...zoneCols('inspect_types', r => r.name)];
    listTable(body, { key: 'inspect_types', table: 'inspect_types', zoned: true, rows: M.list('inspect_types', false).filter(r => M.inZone(r, zid)), cols,
      onAdd: names => q(sb.from('inspect_types').insert(names.map((n, i) => ({ name: n, sort: nextSort(S.m.inspect_types) + i, ...zoneNew() })))),
      placeholder: '新增檢查類型' }); }

  // 棟別與樓層
  { const body = section(root, '棟別與樓層', '選戶畫面的「棟別」按鈕，選了棟才出現它的樓層', 'sec-bld');
    const blds = M.list('buildings', false).filter(b => b.site_id === siteId && (!zid || M.bldZone(b) === zid));
    const floorCell = b => {
      const w = el('div', 'fl-cell'); const fi = el('input'); fi.type = 'text'; fi.value = compressFloors(b.floors); fi.placeholder = '例：B1F~B3F、1F~19F、RF';
      fi.onkeydown = e => { if (e.key === 'Enter') fi.blur(); };
      fi.onchange = () => adminSave(async () => {
        const floors = parseFloors(fi.value); if (floors.bad.length) throw new Error(`「${floors.bad.join('、')}」沒辦法自動展開，請一層一層列出，例：R1F、R2F、PRF`);
        if (!floors.length) throw new Error('至少要有一層');
        await q(sb.from('buildings').update({ floors: [...new Set(floors)] }).eq('id', b.id));
      }, () => { fi.value = compressFloors(b.floors); }, '樓層已更新');
      w.append(fi, el('span', 'hint', `${b.floors.length} 層`)); return w;
    };
    const others = M.list('zones').filter(z => z.id !== zid);
    listTable(body, { key: 'bld', table: 'buildings', rows: blds, cols: [{ head: '樓層（可寫範圍，用「、」分隔）', cell: floorCell, cls: 'wide' }],
      more: others.length ? (b, box) => {
        const r = el('div', 'row'); r.appendChild(el('span', 'hint', '這棟其實屬於：'));
        others.forEach(z => { const mb = el('button', 'btn ghost small', `移到${z.name}`); mb.onclick = () => guard(mb, async () => { await q(sb.from('buildings').update({ zone_id: z.id }).eq('id', b.id)); adminSel.more_bld = null; await reloadAdmin(); toast(`已移到${z.name}`); }); r.appendChild(mb); });
        box.appendChild(r); box.appendChild(el('p', 'hint', `兩區都需要「${b.name}」的話，到另一區再新增一個同名的棟，各自設樓層。`));
      } : null,
      addFields: [{ placeholder: '樓層，例：2F~19F', width: '200px' }],
      onAdd: (names, [fl]) => { const floors = parseFloors(fl); if (floors.bad.length) throw new Error(`「${floors.bad.join('、')}」沒辦法自動展開`);
        return q(sb.from('buildings').insert(names.map((n, i) => ({ site_id: siteId, name: n, floors: [...floors], sort: nextSort(S.m.buildings) + i, ...(zid ? { zone_id: zid } : {}) })))); },
      placeholder: '新增棟別，例：G棟' }); }

  // 戶別／使用空間：一張表，列＝戶別，欄＝樓層，打勾＝這層有
  { const body = section(root, ulab, `選了棟別、樓層之後出現的「${ulab}」按鈕；勾選它在哪幾層`, 'sec-unit');
    const blds = M.list('buildings').filter(b => b.site_id === siteId && (!zid || M.bldZone(b) === zid));
    const b = bldPicker(body, 'unitBld', blds);
    if (b) {
      const all = b.floors;
      const eff = u => (u.floors || []).length ? all.filter(f => u.floors.includes(f)) : all;
      const setFloors = (u, fl) => q(sb.from('units').update({ floors: fl.length === all.length ? [] : fl.length ? fl : ['無'] }).eq('id', u.id));   // 一層都不勾存「無」（空的＝每層都有）
      const cols = [{ head: '全選／全不選', cls: 'allcol', cell: u => {
        const on = eff(u).length === all.length;
        return checkCell(on, (v, back) => adminSave(() => setFloors(u, v ? all : []), back, v ? `${u.code} 每層都勾` : `${u.code} 全部取消`), `${u.code} 全選／全不選`);
      } }].concat(all.map(f => ({ head: f, cell: u => checkCell(eff(u).includes(f), (v, back) => {
        const fl = all.filter(x => x === f ? v : eff(u).includes(x));
        adminSave(() => setFloors(u, fl), back, '');
      }, `${u.code} ${f}`) })));
      listTable(body, { key: 'unit', table: 'units', nameField: 'code', nameHead: `${ulab}（點一下就能改名）`, nameNote: u => eff(u).length ? '' : '沒勾樓層，選戶時不會出現', rows: S.m.units.filter(u => u.building_id === b.id).sort(bySort), cols,
        addFields: [{ placeholder: '在哪幾層（空白＝每層都有），例：1F', width: '240px' }],
        onAdd: (names, [fl]) => { const floors = parseFloors(fl); if (floors.bad.length) throw new Error(`「${floors.bad.join('、')}」沒辦法自動展開`);
          const bad = floors.filter(f => !all.includes(f)); if (bad.length) throw new Error(`${b.name} 沒有 ${bad.join('、')}，請先在上面「棟別與樓層」加上`);
          return q(sb.from('units').insert(names.map((n, i) => ({ building_id: b.id, code: n, sort: nextSort(S.m.units.filter(u => u.building_id === b.id)) + i, ...(floors.length && floors.length < all.length ? { floors: all.filter(f => floors.includes(f)) } : {}) })))); },
        placeholder: zid ? `新增${ulab}，例：${ulab === '戶別' ? 'A9' : '藝術大廳'}` : '新增戶別，例：A9',
        hint: '打勾＝這一層的選戶畫面會出現它。' });
    } }
}

// ---------- 空間別 ----------
function tabSpace(root) {
  const zid = adminZone(), ulab = zid ? M.unitLabel(zid) : '戶別';
  const allSp = S.m.spaces.slice().sort(bySort);
  { const body = section(root, '空間別清單', '填寫缺失時第一排的「空間」按鈕，例：玄關、主臥、全室', 'sec-space');
    const rows = allSp.filter(sp => M.inZone(sp, zid));
    const typeId = (allSp[0] || {}).inspect_type_id || (M.list('inspect_types', false)[0] || {}).id;   // 舊欄位，資料庫還要求有值
    const codeCell = sp => { const i = el('input', 'code-in'); i.type = 'text'; i.value = sp.code && sp.code !== '0' ? sp.code : ''; i.placeholder = '—'; i.title = '平面圖上顯示的代號（選填）';
      i.onkeydown = e => { if (e.key === 'Enter') i.blur(); };
      i.onchange = () => adminSave(() => q(sb.from('spaces').update({ code: i.value.trim() }).eq('id', sp.id)), () => { i.value = sp.code || ''; }); return i; };
    listTable(body, { key: 'space', table: 'spaces', zoned: !S.noSpaceZones, rows, cols: [{ head: '圖面代號', cell: codeCell }, ...(S.noSpaceZones ? [] : zoneCols('spaces', r => r.name))],
      merge: { refs: [['defects', 'space_id']], extra: async (a, b) => {
        const marks = S.m.plan_spaces; const done = new Set(marks.filter(m => m.space_id === b.id).map(m => m.plan_id));
        for (const m of marks.filter(m => m.space_id === a.id && !done.has(m.plan_id))) await q(sb.from('plan_spaces').update({ space_id: b.id }).eq('id', m.id));
        await q(sb.from('plan_spaces').delete().eq('space_id', a.id));
        const have = new Set(S.m.unit_spaces.filter(m => m.space_id === b.id).map(m => m.unit_id));
        for (const m of S.m.unit_spaces.filter(m => m.space_id === a.id && !have.has(m.unit_id))) await q(sb.from('unit_spaces').insert({ unit_id: m.unit_id, space_id: b.id }));
      } },
      onAdd: names => { const dup = names.filter(n => allSp.some(sp => sp.name === n)); if (dup.length) throw new Error('「' + dup.join('、') + '」另一區已經有了，請切到那一區，在它那一列勾「也用」');
        return q(sb.from('spaces').insert(names.map((n, k) => ({ inspect_type_id: typeId, name: n, code: '', sort: nextSort(allSp) + k, ...(zid && !S.noSpaceZones ? { zone_ids: [zid] } : {}) })))); },
      placeholder: '新增空間別，例：玄關、主臥' }); }

  // 每戶有哪些空間：列＝戶別，欄＝空間別
  { const body = section(root, `每個${ulab}有哪些空間`, `打勾＝填寫這個${ulab}時會出現這個空間；按欄位名稱可整欄勾選／取消`, 'sec-unitspace');
    if (S.noUnitSpaces) { body.appendChild(el('div', 'banner', '還沒建立「每戶空間別」資料表：請到 Supabase SQL Editor 執行 3_戶別空間.sql 一次。')); return; }
    const blds = M.list('buildings').filter(b => b.site_id === S.sel.siteId && (!zid || M.bldZone(b) === zid));
    const b = bldPicker(body, 'spBld', blds); if (!b) return;
    const units = M.list('units').filter(u => u.building_id === b.id);
    const sps = M.list('spaces').filter(sp => M.inZone(sp, zid));
    const bound = u => S.m.unit_spaces.filter(m => m.unit_id === u.id).map(m => m.space_id);
    const eff = u => { const b0 = bound(u); return new Set(b0.length ? b0 : M.spacesFor(u.id, null).map(s => s.id)); };
    const wrap = el('div', 'lt-wrap'); const t = el('table', 'lt matrix'); wrap.appendChild(t);
    const hr = el('tr'); hr.appendChild(el('th', 'nm', ulab));
    sps.forEach(sp => { const th = el('th', 'vt'); const hb = el('button', 'colbtn', sp.name); hb.type = 'button'; hb.title = `整欄：${sp.name}`;
      hb.onclick = () => { const on = !units.every(u => bound(u).includes(sp.id));   /* 淡色（還沒設定）的算沒勾：按一下就整欄正式勾上 */ adminSave(async () => { for (const u of units) { const s = eff(u); on ? s.add(sp.id) : s.delete(sp.id); await setUnitSpaces([u.id], [...s]); } }, null, on ? `全部勾上「${sp.name}」` : `全部取消「${sp.name}」`); };
      th.appendChild(hb); hr.appendChild(th); });
    const th = el('thead'); th.appendChild(hr); t.appendChild(th); const tb = el('tbody'); t.appendChild(tb);
    units.forEach(u => {
      const auto = !bound(u).length, s = eff(u); const tr = el('tr', auto ? 'auto' : null);
      const nm = el('td', 'nm'); nm.appendChild(el('b', null, u.code)); if (auto) nm.appendChild(el('div', 'hint', '還沒設定，先照這樣顯示')); tr.appendChild(nm);
      sps.forEach(sp => { const td = el('td'); td.appendChild(checkCell(s.has(sp.id), (v, back) => { const n = new Set(s); if (auto && !v) { adminSave(() => setUnitSpaces([u.id], [...n]), null, `${u.code} 已確認，再點一次可取消`); return; }   // 淡色（還沒設定）的勾：第一次點是確認成正式設定，不是取消
        v ? n.add(sp.id) : n.delete(sp.id); if (!n.size) { back(); toast(`${u.code} 至少要留一個空間`); return; } adminSave(() => setUnitSpaces([u.id], [...n]), back, ''); }, `${u.code} ${sp.name}`)); tr.appendChild(td); });
      tb.appendChild(tr);
    });
    if (!units.length) { const tr = el('tr'); const td = el('td', 'empty', `這棟還沒有${ulab}`); td.colSpan = sps.length + 1; tr.appendChild(td); tb.appendChild(tr); }
    body.appendChild(wrap);
    if (units.some(u => !bound(u).length)) body.appendChild(el('p', 'hint', '淡色的勾是還沒設定、系統先照平面圖標記（沒標記就是全部）顯示的。點一下淡色的勾就變成正式設定（深色），再點一次才是取消。'));
  }
}

// ---------- 工項、缺失內容、預設廠商 ----------
function tabCat(root) {
  const zid = adminZone();
  const body = section(root, '工項', '填寫缺失時的「工項」按鈕；按「缺失內容」可設定它底下的缺失與預設廠商', 'sec-cat');
  const detail = c => {
    const box = el('div', 'stack');
    box.appendChild(el('label', 'f', zid ? `${c.name} 在${M.name('zones', zid)}的缺失內容（只影響${M.name('zones', zid)}，另一區有自己的一份）` : `${c.name} 的缺失內容`));
    if (S.noItemZones && !S.noZones) box.appendChild(el('div', 'banner', '缺失內容還不能分專有戶／公設：請到 Supabase 執行 18_缺失內容各區一份.sql 一次。'));
    listTable(box, { key: 'item', table: 'items', merge: { refs: [['defects', 'item_id']] }, rows: S.m.items.filter(i => i.category_id === c.id && M.itemIn(i, zid)).sort(bySort),
      onAdd: names => q(sb.from('items').insert(names.map((n, i) => ({ category_id: c.id, name: n, sort: nextSort(S.m.items.filter(x => x.category_id === c.id)) + i, ...(S.noItemZones || !zid ? {} : { zone_id: zid, zone_ids: [zid] }) })))),
      placeholder: '新增缺失內容（可用「、」一次輸入多個）' });
    box.appendChild(el('label', 'f', `${c.name} 的預設廠商（點選＝加入／移除，可多家；填寫時變成「修繕廠商」按鈕）`));
    const vb = el('div', 'chips'); box.appendChild(vb);
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
    if (!M.list('vendors').length) vb.appendChild(el('span', 'hint', '還沒有廠商，請先到「廠商」分頁新增。'));
    return box;
  };
  listTable(body, { key: 'cat', table: 'categories', zoned: true, rows: M.list('categories', false).filter(c => M.inZone(c, zid)), cols: [
      { head: '預設廠商', cls: 'left', cell: c => el('span', 'hint', M.vendorsOfCat(c.id).map(v => v.name).join('、') || '—') }, ...zoneCols('categories', r => r.name)],
    detail, detailLabel: c => `缺失內容 ${S.m.items.filter(i => i.category_id === c.id && i.active !== false && M.itemIn(i, zid)).length}`,
    onAdd: names => q(sb.from('categories').insert(names.map((n, i) => ({ name: n, sort: nextSort(S.m.categories) + i, ...zoneNew() })))),
    placeholder: '新增工項，例：木地板工程' });
}

// ---------- 廠商、修繕方式 ----------
function tabVendor(root) {
  { const body = section(root, '廠商', '填寫時的「修繕廠商」「責任廠商」；請用全名', 'sec-vendor');
    listTable(body, { key: 'vendor', table: 'vendors', sortable: false, cols: [{ head: '是哪些工項的預設廠商', cls: 'left', cell: v => el('span', 'hint',
        S.m.category_vendors.filter(m => m.vendor_id === v.id).map(m => M.name('categories', m.category_id)).filter(Boolean).join('、') || '—') }],
      merge: { refs: [['defects', 'fix_vendor_id'], ['defects', 'resp_vendor_id']], extra: async (a, b) => {
        const have = new Set(S.m.category_vendors.filter(m => m.vendor_id === b.id).map(m => m.category_id));
        for (const m of S.m.category_vendors.filter(m => m.vendor_id === a.id && !have.has(m.category_id)))
          await q(sb.from('category_vendors').insert({ category_id: m.category_id, vendor_id: b.id, sort: m.sort }));
        await q(sb.from('category_vendors').delete().eq('vendor_id', a.id));
      } }, rows: M.list('vendors', false).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
      onAdd: names => q(sb.from('vendors').insert(names.map(n => ({ name: n })))),
      placeholder: '新增廠商全名', hint: '要指定某個工項預設哪家廠商，到「工項與缺失」分頁按該工項的「缺失內容」。' }); }
  { const body = section(root, '修繕方式', '填寫時的「修繕方式」按鈕，例：修補、更換', 'sec-method');
    listTable(body, { key: 'repair_methods', table: 'repair_methods', rows: M.list('repair_methods', false), merge: { refs: [['defects', 'repair_method_id']] },
      onAdd: names => q(sb.from('repair_methods').insert(names.map((n, i) => ({ name: n, sort: nextSort(S.m.repair_methods) + i })))), placeholder: '新增修繕方式' }); }
}

// ---------- 其他：案場、專有戶／公設 ----------
function tabOther(root) {
  { const body = section(root, '案場', '有多個案場時，選戶畫面最上面的選單', 'sec-site');
    listTable(body, { key: 'sites', table: 'sites', rows: M.list('sites', false),
      onAdd: names => q(sb.from('sites').insert(names.map((n, i) => ({ name: n, sort: nextSort(S.m.sites) + i })))), placeholder: '新增案場' }); }
  { const body = section(root, '專有戶／公設', '選戶畫面選完案場後的第一排按鈕；右邊可改這一區的「戶別」叫什麼', 'sec-zone');
    if (S.noZones) { body.appendChild(el('div', 'banner', '還沒建立這一層：' + ZONE_SQL + ' 一次。')); return; }
    const labCell = z => { const i = el('input'); i.type = 'text'; i.value = z.unit_label || '戶別'; i.onkeydown = e => { if (e.key === 'Enter') i.blur(); };
      i.onchange = () => adminSave(async () => { const v = i.value.trim(); if (!v) throw new Error('不能空白'); await q(sb.from('zones').update({ unit_label: v }).eq('id', z.id)); }, () => { i.value = z.unit_label; }); return i; };
    listTable(body, { key: 'zones', table: 'zones', rows: M.list('zones', false), cols: [{ head: '這一區的戶別叫做', cell: labCell }],
      onAdd: names => q(sb.from('zones').insert(names.map((n, i) => ({ name: n, sort: nextSort(S.m.zones) + i })))), placeholder: '新增區分' }); }
}

// ================= 平面圖 =================
function planName(p) { return p; }
async function uploadPlan(unit, variant, file) {
  const ext = (file.name.match(/\.(png|jpe?g|webp)$/i) || [, 'png'])[1].toLowerCase();
  // 雲端檔名只能用英數字：中文名稱的使用空間（例：藝術大廳）會被拒絕，所以用編號＋時間命名，畫面上還是顯示原本名稱
  const safe = x => String(x).replace(/[^A-Za-z0-9_-]/g, '') || 'x';
  const path = `u${unit.id}-${safe(unit.code)}${variant === '標準層' ? '' : '-' + safe(variant)}_${Date.now()}.${ext}`;
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
  const g = group('plan', '平面圖', '填寫頁看到的圖。每戶一張共用圖，格局不同的樓層（例如 2F）可另外傳專屬圖'); root.appendChild(g.d);
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
  const zid = adminZone(); const blds = M.list('buildings').filter(b => b.site_id === S.sel.siteId && (!zid || M.bldZone(b) === zid));
  if (!blds.find(b => b.id === adminSel.plBld)) adminSel.plBld = blds[0] && blds[0].id;
  const sb1 = el('select'); fillSelect(sb1, blds, adminSel.plBld, null, b => M.bldLabel(b, blds)); sb1.onchange = () => { adminSel.plBld = Number(sb1.value); adminSel.plUnit = null; renderAdmin(); };
  const units = M.unitsOf(adminSel.plBld);
  if (!units.find(u => u.id === adminSel.plUnit)) adminSel.plUnit = units[0] && units[0].id;
  const su = el('select'); fillSelect(su, units, adminSel.plUnit, null, u => {
    const have = S.m.plans.filter(p => p.unit_id === u.id).length; return `${u.code}（${have ? have + ' 張' : '尚無圖'}）`;
  }); su.onchange = () => { adminSel.plUnit = Number(su.value); renderAdmin(); };
  const r1 = el('div', 'row'); r1.append(sb1, su); r1.querySelectorAll('select').forEach(s => { s.style.flex = '1'; s.style.minWidth = '120px'; });
  g.body.appendChild(r1);
  const unit = M.get('units', adminSel.plUnit);
  if (adminSel.planErr) g.body.appendChild(el('div', 'banner err', adminSel.planErr + '。請把這段文字截圖給 Claude。'));
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
      fi.onchange = () => guard(lab, async () => {
        const f = fi.files[0]; if (!f) return; adminSel.planErr = null;
        try { await uploadPlan(unit, variant, f); }
        catch (e) { adminSel.planErr = `「${f.name}」上傳失敗：${errMsg(e)}（${e.statusCode || e.status || ''} ${e.error || ''}）`; renderAdmin(); throw e; }
        await reloadAdmin(); toast('已上傳');
      });
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
  box.appendChild(el('label', 'f', '點下面的空間，再到圖上點位置，在圖上放該空間的標記（有圖面代號顯示代號，沒有顯示名稱）。這戶有哪些空間，請到「空間別」分頁設定'));
  const uz = M.unitZone(M.get('units', plan.unit_id)); const spaces = M.list('spaces').filter(s => s.name !== '全室' && M.inZone(s, uz));
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
  const g = group('user', '帳號', '誰能登入、是一般／管理者／廠商；離職的取消「啟用」'); root.appendChild(g.d);
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
