/* 選戶畫面 + 填寫畫面（平面圖點位） */
const SEL_KEY = 'qc-sel';
function loadSel() { try { return JSON.parse(localStorage.getItem(SEL_KEY) || '{}'); } catch (e) { return {}; } }
function saveSel() { try { localStorage.setItem(SEL_KEY, JSON.stringify(S.sel)); } catch (e) { /* 無痕模式等 */ } }

function normalizeSel() {
  const s = S.sel;
  const sites = M.list('sites');
  if (!sites.find(x => x.id === s.siteId)) s.siteId = sites[0] && sites[0].id;
  const types = M.list('inspect_types');
  if (!types.find(x => x.id === s.typeId)) s.typeId = types[0] && types[0].id;
  const blds = M.buildingsOf(s.siteId);
  if (!blds.find(x => x.id === s.bldId)) s.bldId = blds[0] && blds[0].id;
  const b = M.get('buildings', s.bldId);
  const floors = b ? b.floors : [];
  if (!floors.includes(s.floor)) s.floor = floors[0] || null;
  const units = M.unitsOf(s.bldId);
  if (!units.find(x => x.id === s.unitId)) s.unitId = null;
}

let pickToken = 0;
async function renderPick() {
  normalizeSel();
  const s = S.sel;
  const sites = M.list('sites');
  $('site-wrap').hidden = sites.length <= 1;
  fillSelect($('site'), sites, s.siteId, null);
  chips($('itype'), M.list('inspect_types'), s.typeId, r => { s.typeId = r.id; saveSel(); renderPick(); });
  chips($('bld'), M.buildingsOf(s.siteId), s.bldId, r => { s.bldId = r.id; s.unitId = null; saveSel(); renderPick(); });
  const b = M.get('buildings', s.bldId);
  const fb = $('floor'); fb.innerHTML = '';
  (b ? b.floors : []).forEach(f => {
    const c = el('button', 'chip' + (f === s.floor ? ' on' : ''), f); c.type = 'button';
    c.onclick = () => { s.floor = f; saveSel(); renderPick(); }; fb.appendChild(c);
  });
  if (!b || !b.floors.length) fb.appendChild(el('span', 'hint', '此棟尚未設定樓層，請管理者到「管理」新增。'));
  const ub = $('units'); ub.innerHTML = '';
  const units = M.unitsOf(s.bldId);
  units.forEach(u => {
    const btn = el('button', u.id === s.unitId ? 'on' : '', u.code); btn.type = 'button'; btn.dataset.uid = u.id;
    btn.onclick = () => { s.unitId = u.id; saveSel(); renderPick(); };
    ub.appendChild(btn);
  });
  if (!units.length) ub.appendChild(el('span', 'hint', '此棟尚未建立戶別。'));
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
  if (!S.sel.unitId) { toast('請先選戶別'); return; }
  if (!S.sel.floor) { toast('請先選樓層'); return; }
  show('fill');
};

// ---------- 填寫 ----------
function pickPlan(unitId, floor) {
  const plans = S.m.plans.filter(p => p.unit_id === unitId);
  if (floor === '2F') { const p2 = plans.find(p => p.variant === '2F'); if (p2) return p2; }
  return plans.find(p => p.variant === '標準層') || null;
}
let fillToken = 0;
async function renderFill() {
  const s = S.sel; const tok = ++fillToken;
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
}
function drawPins() {
  const plan = $('plan');
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
    p.onclick = e => { e.stopPropagation(); openDefect(d, { no: i + 1, onDone: renderFill }); };
    plan.appendChild(p);
  });
}
function drawList() {
  $('cnt').textContent = `（${S.unitDefects.length}）`;
  const box = $('dlist'); box.innerHTML = '';
  if (!S.unitDefects.length) box.appendChild(el('p', 'hint', '這戶目前沒有缺失紀錄。'));
  S.unitDefects.forEach((d, i) => {
    const it = el('div', 'item'); it.tabIndex = 0;
    it.appendChild(el('div', 'no ' + d.status, String(i + 1)));
    const t = el('div', 't');
    t.appendChild(el('b', null, `${M.name('categories', d.category_id) || '（未選工項）'}　${M.name('items', d.item_id)}`));
    t.appendChild(el('small', null, `${M.name('spaces', d.space_id) || '未選空間'}　修繕：${M.name('vendors', d.fix_vendor_id) || '—'}　責任：${M.name('vendors', d.resp_vendor_id) || '—'}`));
    it.appendChild(t); it.appendChild(el('span', 'status ' + d.status, STATUS[d.status]));
    const open = () => openDefect(d, { no: i + 1, onDone: renderFill });
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
$('plan').onclick = e => {
  if (e.target.closest('.pin')) return;
  const r = $('planimg').getBoundingClientRect(); if (!r.width) return;
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  openDefect(null, { no: S.unitDefects.length + 1, create: newDefectCtx(x, y), onDone: renderFill });
};
$('add-nopos').onclick = () => openDefect(null, { no: S.unitDefects.length + 1, create: newDefectCtx(null, null), onDone: renderFill });
$('back').onclick = () => show('pick');
