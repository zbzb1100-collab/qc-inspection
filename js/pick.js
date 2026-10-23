/* 選戶畫面 + 填寫畫面（平面圖點位） */
const SEL_KEY = 'qc-sel';
function loadSel() { try { return JSON.parse(localStorage.getItem(SEL_KEY) || '{}'); } catch (e) { return {}; } }
function saveSel() { try { localStorage.setItem(SEL_KEY, JSON.stringify(S.sel)); } catch (e) { /* 無痕模式等 */ } }

function normalizeSel() {
  const s = S.sel;
  const sites = M.list('sites');
  if (!sites.find(x => x.id === s.siteId)) s.siteId = sites[0] && sites[0].id;
  const zones = M.list('zones');
  if (!zones.find(x => x.id === s.zoneId)) s.zoneId = zones[0] ? zones[0].id : null;
  const types = M.typesOf(s.zoneId);
  if (!types.find(x => x.id === s.typeId)) s.typeId = types[0] && types[0].id;
  const blds = M.buildingsOf(s.siteId, s.zoneId);
  if (!blds.find(x => x.id === s.bldId)) s.bldId = blds[0] && blds[0].id;
  const b = M.get('buildings', s.bldId);
  const floors = (b ? b.floors : []);
  if (!floors.includes(s.floor)) s.floor = floors[0] || null;
  const units = M.unitsOf(s.bldId, s.floor);
  if (!units.find(x => x.id === s.unitId)) s.unitId = null;
}

let pickToken = 0;
async function renderPick() {
  normalizeSel(); drawRecent();
  const s = S.sel;
  const sites = M.list('sites');
  $('site-wrap').hidden = sites.length <= 1;
  fillSelect($('site'), sites, s.siteId, null);
  const zones = M.list('zones');
  $('zone-wrap').hidden = zones.length <= 1;
  chips($('zone'), zones, s.zoneId, r => { s.zoneId = r.id; s.unitId = null; saveSel(); renderPick(); });
  const ulab = M.unitLabel(s.zoneId);
  $('unit-label').textContent = ulab;
  chips($('itype'), M.typesOf(s.zoneId), s.typeId, r => { s.typeId = r.id; saveSel(); renderPick(); }, { empty: '這一區還沒有檢查類型，請管理者到「管理」勾選。' });
  chips($('bld'), M.buildingsOf(s.siteId, s.zoneId), s.bldId, r => { s.bldId = r.id; s.unitId = null; saveSel(); renderPick(); }, { empty: sites.length ? '這一區還沒有棟別，請管理者到「管理」新增。' : '你的帳號還沒開通任何案場，請找管理者到「管理 → 帳號」勾選可用案場。' });
  const b = M.get('buildings', s.bldId);
  const fb = $('floor'); fb.innerHTML = '';
  (b ? b.floors : []).forEach(f => {
    const c = el('button', 'chip' + (f === s.floor ? ' on' : ''), f); c.type = 'button';
    c.onclick = () => { s.floor = f; s.unitId = null; saveSel(); renderPick(); }; fb.appendChild(c);
  });
  if (!(b ? b.floors : []).length) fb.appendChild(el('span', 'hint', '此棟尚未設定樓層，請管理者到「管理」新增。'));
  const ub = $('units'); ub.innerHTML = '';
  const units = M.unitsOf(s.bldId, s.floor);
  units.forEach(u => {
    const btn = el('button', u.id === s.unitId ? 'on' : '', u.code); btn.type = 'button'; btn.dataset.uid = u.id;
    btn.onclick = () => { s.unitId = u.id; saveSel(); renderPick(); };
    ub.appendChild(btn);
  });
  if (!units.length) ub.appendChild(el('span', 'hint', `這層還沒有${ulab}，請管理者到「管理」新增。`));
  // 未結案數（背景載入）
  const tok = ++pickToken;
  if (s.bldId && s.floor && s.typeId) {
    const { data } = await sb.from('defects').select('unit_id,status')
      .eq('building_id', s.bldId).eq('floor', s.floor).eq('inspect_type_id', s.typeId).neq('status', 'closed').limit(5000);
    if (tok !== pickToken || !data) return;
    const cnt = {}; data.forEach(d => { cnt[d.unit_id] = (cnt[d.unit_id] || 0) + 1; });
    ub.querySelectorAll('button').forEach(btn => {
      const c = cnt[btn.dataset.uid]; if (c) btn.appendChild(el('span', 'n', '待處理 ' + c));
    });
  }
}
$('site').onchange = e => { S.sel.siteId = Number(e.target.value); S.sel.bldId = null; S.sel.unitId = null; saveSel(); renderPick(); };
$('go').onclick = () => {
  if (!S.sel.unitId) { toast('請先選' + M.unitLabel(S.sel.zoneId)); return; }
  if (!S.sel.floor) { toast('請先選樓層'); return; }
  rememberRecent(); S.fillFilter = null;
  show('fill');
};
// 最近檢查過的戶（每台裝置各自記，最多 6 戶），點一下直接進填寫頁
const RECENT_KEY = 'qc-recent';
function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
function rememberRecent() {
  const s = S.sel, k = r => [r.siteId, r.typeId, r.unitId, r.floor].join('|');
  const me = { siteId: s.siteId, zoneId: s.zoneId, typeId: s.typeId, bldId: s.bldId, floor: s.floor, unitId: s.unitId };
  const list = [me, ...loadRecent().filter(r => k(r) !== k(me))].slice(0, 6);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* 無痕模式等 */ }
}
function drawRecent() {
  const box = $('recent'); box.innerHTML = '';
  const list = loadRecent().filter(r => M.get('units', r.unitId) && M.get('buildings', r.bldId) && M.get('inspect_types', r.typeId) && M.list('sites').some(x => x.id === r.siteId));
  $('recent-wrap').hidden = !list.length;
  list.forEach(r => {
    const b = el('button', 'chip', `${M.name('buildings', r.bldId)} ${r.floor} ${M.unitCode(r.unitId)}`);
    b.type = 'button'; b.title = M.name('inspect_types', r.typeId);
    b.appendChild(el('small', 'hint', '　' + M.name('inspect_types', r.typeId)));
    b.onclick = () => { Object.assign(S.sel, r); saveSel(); rememberRecent(); S.fillFilter = null; show('fill'); };
    box.appendChild(b);
  });
}

// ---------- 填寫 ----------
function pickPlan(unitId, floor) {
  const plans = S.m.plans.filter(p => p.unit_id === unitId);
  const own = plans.find(p => p.variant === floor);       // 這層有專屬圖就用專屬圖
  if (own) return own;
  return plans.find(p => p.variant === '標準層') || null;
}
let fillToken = 0;
async function renderFill() {
  const s = S.sel; const tok = ++fillToken; S.placing = null; paintPlacing();
  $('add-nopos').hidden = isVendor();
  const unit = M.get('units', s.unitId), b = M.get('buildings', s.bldId);
  if (!unit || !b) { show('pick'); return; }
  $('unitname').textContent = `${b.name} ${s.floor} ${unit.code}`;
  const plan = pickPlan(unit.id, s.floor);
  S.curPlan = plan;
  $('plannote').textContent = '';
  const planBox = $('plan');
  planBox.hidden = !plan;
  planBox.querySelectorAll('.pin,.mark').forEach(p => p.remove());
  $('marklegend').textContent = '';
  if (!plan) { $('plannote').textContent = '　（這戶還沒有平面圖，管理者可在「管理 → 平面圖」上傳）'; }
  else {
    $('planimg').onload = () => drawPins();
    const url = await signedUrl('plans', plan.path);
    if (tok !== fillToken) return;
    $('planimg').src = url;
  }
  const { data, error } = await sb.from('defects').select('*')
    .eq('unit_id', s.unitId).eq('floor', s.floor).eq('inspect_type_id', s.typeId).order('id');
  if (tok !== fillToken) return;
  if (error) { toast(errMsg(error)); return; }
  S.unitDefects = data;
  drawPins(); drawList();
  // 同戶同樓層、其他檢查類型的缺失（填寫頁只顯示目前檢查類型，避免混在一起）
  const { data: oth } = await sb.from('defects').select('inspect_type_id')
    .eq('unit_id', s.unitId).eq('floor', s.floor).neq('inspect_type_id', s.typeId).limit(500);
  if (tok !== fillToken || !oth || !oth.length) return;
  const by = {}; oth.forEach(d => { by[d.inspect_type_id] = (by[d.inspect_type_id] || 0) + 1; });
  const box = $('dlist');
  Object.keys(by).forEach(tid => {
    const b = el('button', 'btn ghost block', `此戶另有 ${by[tid]} 筆「${M.name('inspect_types', Number(tid))}」的缺失，點此切換查看`); b.type = 'button';
    b.onclick = () => { s.typeId = Number(tid); saveSel(); renderFill(); };
    box.appendChild(b);
  });
}
function drawPins() {
  const plan = $('plan'); fitMainPlan();
  plan.querySelectorAll('.pin,.mark').forEach(p => p.remove());
  const pl = S.curPlan;
  if (pl) {
    const marks = S.m.plan_spaces.filter(m => m.plan_id === pl.id);
    const legend = [];
    marks.forEach(m => {
      const sp = M.get('spaces', m.space_id); if (!sp) return;
      const hasCode = sp.code && sp.code !== '0';
      const d = el('div', 'mark', hasCode ? sp.code : sp.name); d.style.left = (m.x * 100) + '%'; d.style.top = (m.y * 100) + '%'; plan.appendChild(d);
      if (hasCode) legend.push(`${sp.code}＝${sp.name}`);
    });
    $('marklegend').textContent = legend.join('　');
  }
  S.unitDefects.forEach((d, i) => {
    if (d.x == null || d.plan_id == null) return;
    const p = el('button', 'pin ' + d.status, String(i + 1)); p.type = 'button';
    p.style.left = (d.x * 100) + '%'; p.style.top = (d.y * 100) + '%';
    p.onclick = e => { e.stopPropagation(); openDefect(d, { no: i + 1, onDone: renderFill, canPlace: true, onPlace: startPlacing }); };
    plan.appendChild(p);
  });
}
function drawUnitSign() {   // 整戶一次簽認：客戶通常是對整張清單簽名
  const box = $('unitsign'); box.innerHTML = '';
  const rows = S.unitDefects.filter(d => d.status === 'signing');
  box.hidden = !rows.length || isVendor(); if (box.hidden) return;
  box.appendChild(el('b', null, `本戶有 ${rows.length} 筆待簽認`));
  // 簽名前讓客戶看清楚這次簽的是哪幾筆
  const nos = {}; S.unitDefects.forEach((d, i) => { nos[d.id] = i + 1; });
  const cover = el('details'); cover.open = rows.length <= 6;
  cover.appendChild(el('summary', null, `這次簽認涵蓋的 ${rows.length} 筆`));
  rows.forEach(d => cover.appendChild(el('div', 'hint', `#${nos[d.id]}　${M.name('spaces', d.space_id) || '全區'}　${M.name('categories', d.category_id)}／${M.name('items', d.item_id)}` +
    (d.close_type === '不修' ? `（不修：${d.close_reason || ''}）` : ''))));
  box.appendChild(cover);
  const r = el('div', 'row');
  const nm = el('input'); nm.type = 'text'; nm.placeholder = '簽認人（選填）'; nm.style.flex = '1'; nm.style.minWidth = '140px';
  const dt = el('input'); dt.type = 'date'; dt.value = today(); dt.style.flex = '1'; dt.style.minWidth = '140px';
  r.append(nm, dt); box.appendChild(r);
  const go = el('button', 'btn block', `整戶簽名，${rows.length} 筆一起結案`); box.appendChild(go);
  go.onclick = () => guard(go, async () => {
    const blob = await openSignPad(`請客戶簽名（本戶 ${rows.length} 筆一起結案）`); if (!blob) return;
    const name = nm.value.trim() || null; let n = 0, signPath = null; const done = [];
    for (const d of rows) {
      const ph = await uploadPhoto(d.id, 'sign', blob).catch(e => { throw new Error(errMsg(e) + `（已完成 ${n} 筆）`); });
      signPath = signPath || ph.path;
      const { data, error } = await sb.from('defects').update({ status: 'closed', close_type: d.close_type || '複驗合格', close_reason: d.close_reason || null, signed_name: name, signed_date: dt.value || today() })
        .eq('id', d.id).eq('status', 'signing').select('id');
      if (error) throw new Error(errMsg(error) + `（已完成 ${n} 筆）`);
      n += data.length; if (data.length) done.push(d);
    }
    await recordSign(done, name, dt.value || today(), signPath, nos);
    toast(`已簽認結案 ${n} 筆`); renderFill();
  });
}
// 上次簽認後有新增或重新開案的缺失：提示要再請客戶簽一次
async function drawResign() {
  const box = $('resign'); box.hidden = true; const s = S.sel, tok = fillToken;
  if (isVendor() || !needSign(s.typeId)) return;
  const { data, error } = await sb.from('sign_records').select('at,signed_date,signed_name,defect_ids').eq('unit_id', s.unitId).eq('inspect_type_id', s.typeId)
    .eq('floor', s.floor).order('at', { ascending: false }).limit(20);
  if (error || !data || !data.length || tok !== fillToken) return;
  const signed = new Set(data.flatMap(r => r.defect_ids)), last = data[0];
  // 重新開案的不用重簽（複驗合格就直接結案），只提醒簽認後才新增的
  const added = S.unitDefects.filter(d => d.status !== 'closed' && !signed.has(d.id) && d.created_at > last.at).length;
  if (!added) return;
  box.textContent = `上次簽認（${last.signed_date || fmtTime(last.at)}${last.signed_name ? '，' + last.signed_name : ''}）之後新增 ${added} 筆，處理完要再請客戶簽認。`;
  box.hidden = false;
}
// 頁首統計：點一下只看那個狀態，再點一次看全部
const FILL_TILES = [[null, '全部'], ['todo', '待修'], ['fixed', '待複驗'], ['signing', '待簽認'], ['closed', '結案']];
function drawFillSum() {
  const box = $('fillsum'); box.innerHTML = ''; const all = S.unitDefects;
  FILL_TILES.forEach(([k, n]) => {
    const c = k ? all.filter(d => d.status === k).length : all.length;
    if (k === 'signing' && !c && !needSign(S.sel.typeId)) return;
    const b = el('button', (k || 'all') + ((S.fillFilter ?? null) === k ? ' on' : '')); b.type = 'button';
    b.append(el('b', null, String(c)), el('span', null, n));
    b.onclick = () => { S.fillFilter = S.fillFilter === k || !k ? null : k; drawList(); };
    box.appendChild(b);
  });
  box.style.gridTemplateColumns = `repeat(${box.children.length},1fr)`;
}
function drawList() {
  drawUnitSign(); drawResign(); drawFillSum();
  const f = S.fillFilter, shown = S.unitDefects.filter(d => !f || d.status === f);
  $('cnt').textContent = f ? `（${shown.length}／${S.unitDefects.length}）` : `（${S.unitDefects.length}）`;
  $('fillfilter-note').textContent = f ? `只看「${FILL_TILES.find(t => t[0] === f)[1]}」，點上方「全部」看全部` : '';
  const box = $('dlist'); box.innerHTML = '';
  if (!S.unitDefects.length) box.appendChild(el('p', 'hint', '這戶目前沒有缺失紀錄。'));
  else if (!shown.length) box.appendChild(el('p', 'hint', '這個狀態沒有缺失。'));
  S.unitDefects.forEach((d, i) => {
    if (f && d.status !== f) return;
    const it = el('div', 'item'); it.tabIndex = 0;
    it.appendChild(el('div', 'no ' + d.status, String(i + 1)));
    const t = el('div', 't');
    t.appendChild(el('b', null, `${M.name('categories', d.category_id) || '（未選工項）'}　${M.name('items', d.item_id)}`));
    t.appendChild(el('small', null, `${M.name('spaces', d.space_id) || '未選空間'}　修繕：${M.name('vendors', d.fix_vendor_id) || '—'}　責任：${M.name('vendors', d.resp_vendor_id) || '—'}`));
    it.appendChild(t); it.appendChild(el('span', 'status ' + d.status, statusText(d)));
    const open = () => openDefect(d, { no: i + 1, onDone: renderFill, canPlace: true, onPlace: startPlacing });
    it.onclick = open; it.onkeydown = e => { if (e.key === 'Enter') open(); };
    box.appendChild(it);
  });
}
function newDefectCtx(x, y) {
  const s = S.sel;
  return {
    site_id: s.siteId, inspect_type_id: s.typeId, building_id: s.bldId, floor: s.floor, unit_id: s.unitId,
    plan_id: x == null ? null : (S.curPlan && S.curPlan.id), x: x ?? null, y: y ?? null
  };
}
function startPlacing(id) {
  if (!S.curPlan) { toast('這戶沒有平面圖，無法標位置'); return; }
  S.placing = id; paintPlacing();
  $('plan').scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function paintPlacing() {
  const b = $('placebanner'); b.hidden = !S.placing; b.textContent = '';
  if (!S.placing) return;
  const d = S.unitDefects.find(x => x.id === S.placing);
  b.append(`請在平面圖上點一下，標出「${d ? (M.name('items', d.item_id) || '此缺失') : '此缺失'}」的位置　`);
  const c = el('button', 'iconbtn', '取消'); c.type = 'button'; c.onclick = e => { e.stopPropagation(); S.placing = null; paintPlacing(); }; b.appendChild(c);
}
$('plan').onclick = async e => {
  if (isVendor() && !e.target.closest('.pin')) return;   // 廠商不能新增缺失
  if (S.placing && !e.target.closest('.pin')) {
    const r = $('planimg').getBoundingClientRect(); if (!r.width) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const id = S.placing; S.placing = null; paintPlacing();
    const { error } = await sb.from('defects').update({ plan_id: S.curPlan.id, x, y }).eq('id', id);
    if (error) { toast(errMsg(error)); return; }
    toast('已標上位置'); renderFill(); return;
  }
  if (e.target.closest('.pin')) return;
  const r = $('planimg').getBoundingClientRect(); if (!r.width) return;
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  openDefect(null, { no: S.unitDefects.length + 1, create: newDefectCtx(x, y), onDone: renderFill });
};
$('add-nopos').onclick = () => openDefect(null, { no: S.unitDefects.length + 1, create: newDefectCtx(null, null), onDone: renderFill });
$('back').onclick = () => { S.placing = null; paintPlacing(); show('pick'); };
