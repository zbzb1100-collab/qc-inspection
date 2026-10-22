/* 共用：資料庫連線、主資料、小工具 */
const $ = id => document.getElementById(id);
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
const sb = window.supabase.createClient(window.QC_CONFIG.url, window.QC_CONFIG.key, {
  auth: { persistSession: true, autoRefreshToken: true }
});

// ---- 全域狀態 ----
const S = {
  user: null,        // auth user
  profile: null,     // {id,name,role,active}
  m: {},             // 主資料（各清單）
  sel: {},           // 選戶畫面的選擇
  unitDefects: [],   // 目前這戶的缺失
};
const isAdmin = () => S.profile && S.profile.role === 'admin' && S.profile.active;
const isVendor = () => !!S.profile && S.profile.role === 'vendor';   // 廠商帳號：只看自己的缺失、只能回報修繕完成

const MASTER_TABLES = ['sites', 'inspect_types', 'buildings', 'units', 'spaces', 'categories', 'items',
  'vendors', 'category_vendors', 'repair_methods', 'plans', 'plan_spaces', 'profiles'];

async function loadMaster() {
  const res = await Promise.all(MASTER_TABLES.map(n => sb.from(n).select('*')));
  res.forEach((r, i) => {
    if (r.error) throw new Error(MASTER_TABLES[i] + '：' + r.error.message);
    S.m[MASTER_TABLES[i]] = r.data || [];
  });
  // 每戶空間別（新增的表；還沒建表時不要讓整個系統壞掉）
  const us = await sb.from('unit_spaces').select('*');
  S.m.unit_spaces = us.error ? [] : (us.data || []); S.noUnitSpaces = !!us.error;
  // 專有戶／公設（12_專有公設.sql；還沒執行時就當作只有一區，畫面跟以前一樣）
  const zs = await sb.from('zones').select('*');
  S.m.zones = zs.error ? [] : (zs.data || []); S.noZones = !!zs.error;
  S.noSpaceZones = S.noZones || (S.m.spaces.length > 0 && !('zone_ids' in S.m.spaces[0]));   // 16_空間別分區.sql 還沒執行
  S.noItemZones = S.noZones || (S.m.items.length > 0 && !('zone_id' in S.m.items[0]));       // 18_缺失內容各區一份.sql 還沒執行
}
const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name ?? a.code ?? '').localeCompare(String(b.name ?? b.code ?? ''), 'zh-Hant', { numeric: true });
const act = rows => rows.filter(r => r.active !== false);
const M = {
  list: (t, onlyActive = true) => (onlyActive ? act(S.m[t]) : S.m[t]).slice().sort(bySort),
  get: (t, id) => S.m[t].find(r => r.id === id),
  name: (t, id) => { const r = M.get(t, id); return r ? (r.name ?? r.code) : ''; },
  unitCode: id => { const u = M.get('units', id); return u ? u.code : ''; },
  userName: id => { const p = S.m.profiles.find(p => p.id === id); return p ? (p.name || p.email || '') : ''; },
  itemsOf: (cid, zid) => M.list('items').filter(i => i.category_id === cid && M.itemIn(i, zid)),   // zid 有給：只列這一區的缺失內容
  // 缺失內容各區一份（items.zone_id）；還沒執行 18 的舊資料照 zone_ids，再舊的每區都有
  itemIn: (i, zid) => !zid || (i.zone_id != null ? i.zone_id === zid : M.inZone(i, zid)),
  vendorsOfCat: cid => S.m.category_vendors.filter(cv => cv.category_id === cid).sort((a, b) => a.sort - b.sort)
    .map(cv => M.get('vendors', cv.vendor_id)).filter(v => v && v.active !== false),
  // 空間別是一份總清單（可分專有戶／公設）；每戶設定了哪些空間，填寫時就只出現那些（＋全室）。這戶沒設定時，改看平面圖標記；都沒有就顯示這一區全部。
  spacesFor: (unitId, floor, keepId) => {
    const zid = M.unitZone(M.get('units', unitId)), all = M.list('spaces').filter(sp => M.inZone(sp, zid) || sp.id === keepId); const plan = typeof pickPlan === 'function' ? pickPlan(unitId, floor) : null;
    const bound = new Set(S.m.unit_spaces.filter(m => m.unit_id === unitId).map(m => m.space_id));
    if (bound.size) return all.filter(sp => bound.has(sp.id) || sp.id === keepId);         // 這戶有設定：只出現勾選的
    const ids = new Set(plan ? S.m.plan_spaces.filter(m => m.plan_id === plan.id).map(m => m.space_id) : []);
    if (!ids.size) return all;
    return all.filter(sp => ids.has(sp.id) || sp.name === '全室' || sp.id === keepId);
  },
  // floor 有給：只列這層有的戶別／使用空間（沒設定樓層＝每層都有）
  unitsOf: (bid, floor) => M.list('units').filter(u => u.building_id === bid && (floor == null || !(u.floors || []).length || u.floors.includes(floor))),
  buildingsOf: (sid, zid) => M.list('buildings').filter(b => b.site_id === sid && (zid == null || M.bldZone(b) === zid)),
  // 專有戶／公設：一棟只屬一區（沒設定＝第一區），兩區可以各有同名的棟；戶別跟著棟；檢查類型、工項可屬多區（沒勾＝每區都有）
  bldZone: b => b ? (b.zone_id || (M.list('zones')[0] || {}).id || null) : null,
  // 兩區有同名的棟時，名稱後面加註區分（例：A棟（公設））
  bldLabel: (b, list) => b.name + (list.some(x => x !== b && x.name === b.name) ? `（${M.name('zones', M.bldZone(b))}）` : ''),
  unitZone: u => u ? M.bldZone(M.get('buildings', u.building_id)) : null,
  inZone: (r, zid) => !zid || !(r.zone_ids || []).length || r.zone_ids.includes(zid),
  typesOf: zid => M.list('inspect_types').filter(t => M.inZone(t, zid)),
  catsOf: zid => M.list('categories').filter(c => M.inZone(c, zid)),
  unitLabel: zid => (M.get('zones', zid) || {}).unit_label || '戶別',
};

// ---- 小工具 ----
// 樓層輸入：逗號、頓號、空白、句點、斜線都當分隔；只打數字的補 F（1.2.R → 1F、2F、R）
// 範圍用 ~：B1F~B3F → B1F、B2F、B3F；1~19 → 1F…19F。數字前後文字不同（R1F~PRF）就沒辦法展開，回傳 bad
function parseFloors(str) {
  const out = [], bad = [];
  const fix = x => /^\d+$/.test(x) ? x + 'F' : x;
  String(str || '').split(/[,，、\s.。．\/／;；]+/).map(x => x.trim()).filter(Boolean).forEach(tok => {
    const r = tok.split(/[~～]/);
    if (r.length === 1) { out.push(fix(tok)); return; }
    const m1 = fix(r[0]).match(/^(\D*)(\d+)(\D*)$/), m2 = fix(r[1]).match(/^(\D*)(\d+)(\D*)$/);
    if (r.length !== 2 || !m1 || !m2 || m1[1] !== m2[1] || m1[3] !== m2[3]) { bad.push(tok); return; }
    const a = Number(m1[2]), b = Number(m2[2]), st = a <= b ? 1 : -1;
    for (let i = a; st > 0 ? i <= b : i >= b; i += st) out.push(m1[1] + i + m1[3]);
  });
  out.bad = bad; return out;
}
function toast(m) {
  const t = $('toast'); t.textContent = m; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200);
}
const pad = n => String(n).padStart(2, '0');
function today(plusDays = 0) {                       // 本地日期（台灣時間），不用 UTC
  const d = new Date(); d.setDate(d.getDate() + plusDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function chips(box, rows, currentId, onpick, opt = {}) {
  box.innerHTML = '';
  rows.forEach(r => {
    const b = el('button', 'chip' + (r.id === currentId ? ' on' : ''), opt.label ? opt.label(r) : (r.name ?? r.code));
    b.type = 'button'; b.onclick = () => onpick(r); box.appendChild(b);
  });
  if (!rows.length && opt.empty) box.appendChild(el('span', 'hint', opt.empty));
}
function fillSelect(sel, rows, current, firstLabel, label = r => r.name ?? r.code) {
  sel.innerHTML = '';
  if (firstLabel != null) { const o = el('option', null, firstLabel); o.value = ''; sel.appendChild(o); }
  rows.forEach(r => { const o = el('option', null, label(r)); o.value = r.id; sel.appendChild(o); });
  sel.value = current == null ? '' : String(current);
}
function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return '連不上雲端，請確認網路。';
  if (/row-level security|permission denied/i.test(m)) return '沒有這個操作的權限。';
  if (/duplicate key|unique constraint/i.test(m)) return '已經有同名的項目了（可能在「已停用」裡）。';
  return m;
}
async function guard(btn, fn) {          // 按鈕處理：防連點、顯示錯誤
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1'; const old = btn.innerHTML; btn.classList.add('busy');
  btn.innerHTML = '<span class="spin"></span>處理中…';
  try { return await fn(); }
  catch (e) { console.warn(e); toast(errMsg(e)); }
  finally { delete btn.dataset.busy; btn.classList.remove('busy'); btn.innerHTML = old; }
}

// ---- 私有檔案的暫時網址（登入者才拿得到）----
const urlCache = new Map();           // key → { url, exp }；網址 8 小時有效，7 小時後重新簽
async function signedUrls(bucket, paths) {
  const now = Date.now(); const fresh = p => { const c = urlCache.get(bucket + '/' + p); return c && c.exp > now; };
  const need = [...new Set(paths.filter(p => p && !fresh(p)))];
  if (need.length) {
    const { data, error } = await sb.storage.from(bucket).createSignedUrls(need, 60 * 60 * 8);
    if (error) throw error;
    (data || []).forEach(d => { if (d.signedUrl) urlCache.set(bucket + '/' + d.path, { url: d.signedUrl, exp: now + 7 * 3600e3 }); });
  }
  return paths.map(p => (urlCache.get(bucket + '/' + p) || {}).url || '');
}
// 上傳照片後寫資料表；資料表寫入失敗就把剛上傳的檔刪掉，不留孤兒檔
async function uploadPhoto(defectId, kind, blob) {
  const path = `${defectId}/${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`;
  const up = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (up.error) throw up.error;
  const ins = await sb.from('defect_photos').insert({ defect_id: defectId, kind, path, created_by: S.user.id }).select().single();
  if (ins.error) { await sb.storage.from('photos').remove([path]); throw ins.error; }
  return ins.data;
}
// 刪雲端檔案；失敗只提示，不擋主要動作
async function removeFiles(bucket, paths) {
  if (!paths.length) return;
  const { error } = await sb.storage.from(bucket).remove(paths);
  if (error) { console.warn(error); toast('資料已刪除，但雲端檔案沒刪乾淨（不影響使用）'); }
}
const PHOTO_PICK_MAX = 20, PHOTO_FILE_MAX = 40 * 1024 * 1024;
const signedUrl = async (bucket, path) => (await signedUrls(bucket, [path]))[0];

// ---- 照片壓縮（長邊 1280px、JPEG）----
function compressImage(file, maxSide = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('照片處理失敗')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張照片')); };
    img.src = url;
  });
}

// ---- 分頁抓全部（預設一次最多 1000 筆）----
async function fetchAll(makeQuery) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await makeQuery().range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

// 看大圖；onDelete 有給才出現「刪除」，要按兩次才算數
function showViewer(url, onDelete) {
  $('viewer-img').src = url; $('viewer').hidden = false;
  const d = $('viewer-del'); d.hidden = !onDelete; delete d.dataset.arm; d.textContent = '刪除這張照片';
  d.onclick = e => {
    e.stopPropagation();
    if (!d.dataset.arm) { d.dataset.arm = '1'; d.textContent = '再按一次確定刪除'; return; }
    $('viewer').hidden = true; onDelete();
  };
}
$('viewer').onclick = e => { if (e.target.id !== 'viewer-del') $('viewer').hidden = true; };

const STATUS = { todo: '待修', fixed: '已修繕', signing: '待簽認', closed: '結案' };
const isNofix = d => d.status === 'fixed' && d.close_type === '不修';   // 提出不修、等複驗確認
const statusText = d => isNofix(d) ? '不修待確認' : STATUS[d.status];
const needSign = typeId => !!(M.get('inspect_types', typeId) || {}).need_sign;   // 這個檢查類型複驗後要客戶簽認

// 簽名板：回傳簽名 JPEG（白底黑字），取消回傳 null
function openSignPad(title) {
  const ov = $('signpad'), cv = $('sp-canvas');
  $('sp-title').textContent = title || '請客戶在框內簽名';
  ov.hidden = false;
  const r = cv.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const g = cv.getContext('2d');
  const clear = () => { g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); inked = 0; };
  let inked = 0, last = null; clear();
  g.strokeStyle = '#111'; g.lineWidth = 2.6 * dpr; g.lineCap = 'round'; g.lineJoin = 'round';
  const pt = e => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * dpr, (e.clientY - b.top) * dpr]; };
  cv.onpointerdown = e => { e.preventDefault(); cv.setPointerCapture(e.pointerId); last = pt(e); g.beginPath(); g.arc(last[0], last[1], g.lineWidth / 2, 0, 7); g.fillStyle = '#111'; g.fill(); inked++; };
  cv.onpointermove = e => { if (!last) return; const p = pt(e); g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); inked += Math.hypot(p[0] - last[0], p[1] - last[1]); last = p; };
  cv.onpointerup = cv.onpointercancel = () => { last = null; };
  return new Promise(res => {
    const end = v => { ov.hidden = true; cv.onpointerdown = cv.onpointermove = cv.onpointerup = cv.onpointercancel = null; res(v); };
    $('sp-clear').onclick = clear;
    $('sp-cancel').onclick = () => end(null);
    $('sp-ok').onclick = () => {
      if (inked < 30 * dpr) { toast('請先簽名'); return; }
      const w = Math.min(cv.width, 1000), h = Math.round(cv.height * w / cv.width);   // 存檔不超過 1000px 寬
      const o = document.createElement('canvas'); o.width = w; o.height = h; o.getContext('2d').drawImage(cv, 0, 0, w, h);
      o.toBlob(b => end(b), 'image/jpeg', 0.85);
    };
  });
}

// 平面圖顯示大小：寬度填滿，但高度不超過畫面的一定比例（直長的圖不會拉很長）
function fitPlan(box, img, vh) {
  const fit = () => {
    if (!img.naturalWidth || box.hidden) return;
    box.style.width = '';
    const full = box.parentElement.clientWidth; if (!full) return;   // 畫面還沒顯示
    const maxH = Math.max(260, window.innerHeight * vh);
    box.style.width = Math.min(full, maxH * img.naturalWidth / img.naturalHeight) + 'px';
  };
  img.addEventListener('load', fit); window.addEventListener('resize', fit);
  return fit;
}
const fitMainPlan = fitPlan($('plan'), $('planimg'), 0.6);
const fitMiniPlan = fitPlan($('sh-mini'), $('sh-miniimg'), 0.32);
