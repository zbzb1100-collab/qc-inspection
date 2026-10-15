/* 管理：所有清單、平面圖、帳號都在這裡自己改（只有管理者看得到） */
const adminSel = {};              // 各編輯器目前選到的項目
const adminOpen = new Set(['bld']);
const splitNames = s => s.split(/[,，、\n]+/).map(x => x.trim()).filter(Boolean);
const nextSort = rows => rows.reduce((m, r) => Math.max(m, r.sort ?? 0), 0) + 1;
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
async function reloadAdmin() { await loadMaster(); renderAdmin(); }

// 通用「點選 → 改名／停用／啟用」清單編輯器
function chipEditor(box, o) {
  box.innerHTML = '';
  const rows = o.rows; const selId = adminSel[o.key];
  const selRow = rows.find(r => r.id === selId) || null;
  const cs = el('div', 'chips');
  rows.forEach(r => {
    const b = el('button', 'chip' + (r.active === false ? ' off' : '') + (selRow && selRow.id === r.id ? ' sel' : ''), o.label(r));
    b.type = 'button'; b.onclick = () => { adminSel[o.key] = r.id; if (o.onSelect) o.onSelect(r); chipEditor(box, o); };
    cs.appendChild(b);
  });
  if (!rows.length) cs.appendChild(el('span', 'hint', '（還沒有項目）'));
  box.appendChild(cs);
  if (selRow) {
    const ed = el('div', 'inline-add'); const inp = el('input'); inp.type = 'text'; inp.value = selRow.name ?? selRow.code; ed.appendChild(inp);
    const save = el('button', 'btn ghost small', '改名'); save.onclick = () => guard(save, async () => {
      const v = inp.value.trim(); if (!v) throw new Error('名稱不能空白'); await o.onSave(selRow, v); await reloadAdmin(); toast('已更新');
    });
    const tg = el('button', 'btn ghost small', selRow.active === false ? '啟用' : '停用'); tg.onclick = () => guard(tg, async () => {
      await o.onToggle(selRow); await reloadAdmin(); toast(selRow.active === false ? '已啟用' : '已停用');
    });
    ed.appendChild(save); ed.appendChild(tg); box.appendChild(ed);
    box.appendChild(el('p', 'hint', '停用＝新的填寫不會再出現，但舊紀錄保留；可隨時再啟用。'));
  }
  const ad = el('div', 'inline-add'); const ai = el('input'); ai.type = 'text'; ai.placeholder = o.placeholder || '新增…（可用「、」一次輸入多個）'; ad.appendChild(ai);
  const ab = el('button', 'btn small', '新增'); ab.onclick = () => guard(ab, async () => {
    const names = splitNames(ai.value); if (!names.length) throw new Error('請先輸入名稱');
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
const toggleActive = t => r => q(sb.from(t).update({ active: r.active === false }).eq('id', r.id));
const rename = t => (r, v) => q(sb.from(t).update(r.code != null && r.name == null ? { code: v } : { name: v }).eq('id', r.id));

function renderAdmin() {
  const root = $('admin-root'); root.innerHTML = '';
  root.appendChild(el('div', 'banner', '清單都在這裡自己改，不用找廠商。新增或停用後，填寫頁馬上跟著變。'));
  const siteId = S.sel.siteId;

  // 1 棟別與樓層
  { const g = group('bld', '棟別與樓層'); root.appendChild(g.d);
    const box = el('div', 'stack'); g.body.appendChild(box);
    chipEditor(box, { key: 'bld', onSelect: () => renderAdmin(), rows: M.list('buildings', false).filter(b => b.site_id === siteId), label: r => r.name,
      onAdd: names => q(sb.from('buildings').insert(names.map((n, i) => ({ site_id: siteId, name: n, floors: [], sort: nextSort(S.m.buildings) + i })))),
      onSave: rename('buildings'), onToggle: toggleActive('buildings'), placeholder: '新增棟別，例：G棟' });
    const b = M.get('buildings', adminSel.bld);
    if (b) {
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
  { const g = group('unit', '戶別'); root.appendChild(g.d);
    const blds = M.list('buildings').filter(b => b.site_id === siteId);
    if (!blds.find(b => b.id === adminSel.unitBld)) adminSel.unitBld = blds[0] && blds[0].id;
    const sel = el('select'); fillSelect(sel, blds, adminSel.unitBld, null); sel.onchange = () => { adminSel.unitBld = Number(sel.value); adminSel.unit = null; renderAdmin(); };
    g.body.appendChild(sel);
    const box = el('div', 'stack'); g.body.appendChild(box);
    chipEditor(box, { key: 'unit', rows: S.m.units.filter(u => u.building_id === adminSel.unitBld).sort(bySort), label: r => r.code,
      onAdd: names => q(sb.from('units').insert(names.map((n, i) => ({ building_id: adminSel.unitBld, code: n, sort: nextSort(S.m.units.filter(u => u.building_id === adminSel.unitBld)) + i })))),
      onSave: rename('units'), onToggle: toggleActive('units'), placeholder: '新增戶別，例：A9' }); }

  // 3 空間別
  { const g = group('space', '空間別'); root.appendChild(g.d);
    const types = M.list('inspect_types', false);
    if (!types.find(t => t.id === adminSel.spType)) adminSel.spType = (types.find(t => t.id === S.sel.typeId) || types[0] || {}).id;
    const sel = el('select'); fillSelect(sel, types, adminSel.spType, null); sel.onchange = () => { adminSel.spType = Number(sel.value); adminSel.space = null; renderAdmin(); };
    g.body.appendChild(el('label', 'f', '檢查類型')); g.body.appendChild(sel);
    const rows = S.m.spaces.filter(s => s.inspect_type_id === adminSel.spType).sort(bySort);
    const box = el('div', 'stack'); g.body.appendChild(box);
    chipEditor(box, { key: 'space', rows, label: r => (r.code && r.code !== '0' ? r.code + ' ' : '') + r.name,
      onAdd: async names => {
        const used = new Set(rows.map(r => r.code)); let i = 0;
        const rowsNew = names.map((n, k) => { while (used.has(String.fromCharCode(65 + i))) i++; const code = String.fromCharCode(65 + i); used.add(code); return { inspect_type_id: adminSel.spType, name: n, code, sort: nextSort(rows) + k }; });
        await q(sb.from('spaces').insert(rowsNew));
      },
      onSave: (r, v) => q(sb.from('spaces').update({ name: v }).eq('id', r.id)), onToggle: toggleActive('spaces'), placeholder: '新增空間別，例：玄關' });
    g.body.appendChild(el('p', 'hint', '字母是平面圖上標示的空間編號，新增時自動給下一個字母。')); }

  // 4 工項與缺失內容與廠商對應
  { const g = group('cat', '工項、缺失內容、預設廠商'); root.appendChild(g.d);
    g.body.appendChild(el('label', 'f', '① 工項（點一個來編輯它的缺失內容與廠商）'));
    const cbox = el('div', 'stack'); g.body.appendChild(cbox);
    chipEditor(cbox, { key: 'cat', onSelect: () => renderAdmin(), rows: M.list('categories', false), label: r => r.name,
      onAdd: names => q(sb.from('categories').insert(names.map((n, i) => ({ name: n, sort: nextSort(S.m.categories) + i })))),
      onSave: rename('categories'), onToggle: toggleActive('categories'), placeholder: '新增工項，例：20木地板' });
    const c = M.get('categories', adminSel.cat);
    if (c) {
      g.body.appendChild(el('label', 'f', `② ${c.name} 的缺失內容`));
      const ibox = el('div', 'stack'); g.body.appendChild(ibox);
      chipEditor(ibox, { key: 'item', rows: S.m.items.filter(i => i.category_id === c.id).sort(bySort), label: r => r.name,
        onAdd: names => q(sb.from('items').insert(names.map((n, i) => ({ category_id: c.id, name: n, sort: nextSort(S.m.items.filter(x => x.category_id === c.id)) + i })))),
        onSave: rename('items'), onToggle: toggleActive('items'), placeholder: '新增缺失內容' });
      g.body.appendChild(el('label', 'f', `③ ${c.name} 的預設廠商（點選＝加入／移除；可多家）`));
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
    chipEditor(box, { key: 'vendor', rows: M.list('vendors', false), label: r => r.name,
      onAdd: names => q(sb.from('vendors').insert(names.map(n => ({ name: n })))),
      onSave: rename('vendors'), onToggle: toggleActive('vendors'), placeholder: '新增廠商全名' }); }

  // 6 其他清單
  { const g = group('misc', '其他清單', '修繕方式、檢查類型、案場'); root.appendChild(g.d);
    [['repair_methods', '修繕方式'], ['inspect_types', '檢查類型'], ['sites', '案場']].forEach(([t, title]) => {
      g.body.appendChild(el('label', 'f', title)); const box = el('div', 'stack'); g.body.appendChild(box);
      chipEditor(box, { key: t, rows: M.list(t, false), label: r => r.name,
        onAdd: names => q(sb.from(t).insert(names.map((n, i) => ({ name: n, sort: nextSort(S.m[t]) + i })))),
        onSave: rename(t), onToggle: toggleActive(t), placeholder: '新增' + title });
    }); }

  // 7 平面圖
  renderPlanAdmin(root);

  // 8 帳號
  renderUserAdmin(root);
}

// ================= 平面圖 =================
function planName(p) { return p; }
async function uploadPlan(unit, variant, file) {
  const ext = (file.name.match(/\.(png|jpe?g|webp)$/i) || [, 'png'])[1].toLowerCase();
  const path = `${unit.code}${variant === '2F' ? '-2F' : ''}_${Date.now()}.${ext}`;
  const up = await sb.storage.from('plans').upload(path, file, { contentType: file.type || 'image/' + (ext === 'jpg' ? 'jpeg' : ext), upsert: true });
  if (up.error) throw up.error;
  const old = S.m.plans.find(p => p.unit_id === unit.id && p.variant === variant);
  if (old) {
    await q(sb.from('plans').update({ path }).eq('id', old.id));
    await sb.storage.from('plans').remove([old.path]);
  } else await q(sb.from('plans').insert({ unit_id: unit.id, variant, path }));
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
      const m = f.name.match(/^([A-Za-z]+\d+)(?:[-_ ]?(2F))?\.(png|jpe?g|webp)$/i);
      const row = el('div', 'r'); const lab = el('span', 'grow', f.name); const st = el('span', 'tag', '處理中…'); row.append(lab, st); log.appendChild(row);
      if (!m) { st.textContent = '檔名看不懂'; continue; }
      const hits = units.filter(u => u.code.toUpperCase() === m[1].toUpperCase());
      if (!hits.length) { st.textContent = `找不到戶別 ${m[1]}`; continue; }
      try { await uploadPlan(hits[0], m[2] ? '2F' : '標準層', f); st.textContent = '完成' + (hits.length > 1 ? '（有多棟同名戶別，放在第一個）' : ''); st.classList.add('ok'); okN++; }
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
    const has2F = !bld || bld.floors.includes('2F');
    ['標準層', '2F'].forEach(variant => {
      if (variant === '2F' && !has2F) return;             // 這棟沒有 2F（例如店舖）就不顯示 2F 圖那列
      const p = S.m.plans.find(x => x.unit_id === unit.id && x.variant === variant);
      const r = el('div', 'r'); r.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line);padding:6px 0';
      r.appendChild(el('b', null, `${unit.code} ${variant === '2F' ? '2F 圖' : (has2F ? '標準層（3F 以上）' : `平面圖（${bld && bld.floors.length ? bld.floors.join('、') : '全部樓層'}）`)}`));
      r.appendChild(el('span', 'tag' + (p ? ' ok' : ''), p ? '已上傳' : '未上傳'));
      const lab = el('label', 'btn ghost small', p ? '更換圖' : '上傳圖'); const fi = el('input'); fi.type = 'file'; fi.accept = 'image/*'; fi.style.display = 'none'; lab.appendChild(fi);
      fi.onchange = () => guard(lab, async () => { const f = fi.files[0]; if (!f) return; await uploadPlan(unit, variant, f); await reloadAdmin(); toast('已上傳'); });
      r.appendChild(lab);
      if (p) { const mb = el('button', 'btn ghost small', '標記空間位置'); mb.onclick = () => { adminSel.markPlan = p.id; renderAdmin(); }; r.appendChild(mb); }
      g.body.appendChild(r);
    });
    g.body.appendChild(marksBox);
    const mp = S.m.plans.find(p => p.id === adminSel.markPlan && p.unit_id === unit.id);
    if (mp) renderMarkEditor(marksBox, mp);
  }
}
async function renderMarkEditor(box, plan) {
  box.appendChild(el('label', 'f', '點下面的空間，再到圖上點位置，就會在圖上放該空間的字母編號'));
  const types = M.list('inspect_types'); const t = adminSel.mkType && types.find(x => x.id === adminSel.mkType) ? adminSel.mkType : (types.find(x => x.id === S.sel.typeId) || types[0] || {}).id;
  const spaces = M.spacesOf(t).filter(s => s.code && s.code !== '0');
  const chipsBox = el('div', 'chips'); box.appendChild(chipsBox);
  const wrap = el('div', 'plan'); const img = el('img'); img.alt = '平面圖'; wrap.appendChild(img); box.appendChild(wrap);
  const marks = S.m.plan_spaces.filter(m => m.plan_id === plan.id);
  const draw = () => {
    wrap.querySelectorAll('.mark').forEach(x => x.remove());
    S.m.plan_spaces.filter(m => m.plan_id === plan.id).forEach(m => {
      const sp = M.get('spaces', m.space_id); if (!sp) return;
      const d = el('div', 'mark', sp.code); d.style.left = m.x * 100 + '%'; d.style.top = m.y * 100 + '%'; wrap.appendChild(d);
    });
    chipsBox.innerHTML = '';
    spaces.forEach(s => {
      const has = S.m.plan_spaces.some(m => m.plan_id === plan.id && m.space_id === s.id);
      const b = el('button', 'chip' + (adminSel.mkSpace === s.id ? ' on' : ''), `${s.code} ${s.name}${has ? ' ✓' : ''}`); b.type = 'button';
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
  g.body.appendChild(el('div', 'banner', '新增帳號：到 Supabase 後台 Authentication → Users → Add user，建好後這裡就會出現，可改名字、設管理者、離職時停用。'));
  const list = el('div', 'sublist'); g.body.appendChild(list);
  S.m.profiles.slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '')).forEach(p => {
    const self = p.id === S.user.id;
    const r = el('div', 'r'); const nm = el('input'); nm.type = 'text'; nm.value = p.name || ''; nm.placeholder = '顯示名稱'; nm.style.flex = '1'; nm.style.minWidth = '110px';
    const em = el('span', 'hint', p.email || ''); em.style.width = '100%';
    const role = el('select'); [['user', '一般'], ['admin', '管理者']].forEach(([v, l]) => { const o = el('option', null, l); o.value = v; role.appendChild(o); }); role.value = p.role; role.style.width = 'auto';
    const lab = el('label', 'hint'); const ck = el('input'); ck.type = 'checkbox'; ck.checked = p.active; lab.append(ck, document.createTextNode(' 啟用'));
    if (self) { role.disabled = true; ck.disabled = true; }
    const sv = el('button', 'btn small', '儲存'); sv.onclick = () => guard(sv, async () => {
      await q(sb.from('profiles').update({ name: nm.value.trim(), role: role.value, active: ck.checked }).eq('id', p.id)); await reloadAdmin(); toast('已更新帳號');
    });
    r.append(nm, role, lab, sv, em); list.appendChild(r);
  });
}
