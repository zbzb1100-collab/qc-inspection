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

const MASTER_TABLES = ['sites', 'inspect_types', 'buildings', 'units', 'spaces', 'categories', 'items',
  'vendors', 'category_vendors', 'repair_methods', 'plans', 'plan_spaces', 'profiles'];

async function loadMaster() {
  const res = await Promise.all(MASTER_TABLES.map(n => sb.from(n).select('*')));
  res.forEach((r, i) => {
    if (r.error) throw new Error(MASTER_TABLES[i] + '：' + r.error.message);
    S.m[MASTER_TABLES[i]] = r.data || [];
  });
}
const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name ?? a.code ?? '').localeCompare(String(b.name ?? b.code ?? ''), 'zh-Hant', { numeric: true });
const act = rows => rows.filter(r => r.active !== false);
const M = {
  list: (t, onlyActive = true) => (onlyActive ? act(S.m[t]) : S.m[t]).slice().sort(bySort),
  get: (t, id) => S.m[t].find(r => r.id === id),
  name: (t, id) => { const r = M.get(t, id); return r ? (r.name ?? r.code) : ''; },
  unitCode: id => { const u = M.get('units', id); return u ? u.code : ''; },
  userName: id => { const p = S.m.profiles.find(p => p.id === id); return p ? (p.name || p.email || '') : ''; },
  itemsOf: cid => M.list('items').filter(i => i.category_id === cid),
  vendorsOfCat: cid => S.m.category_vendors.filter(cv => cv.category_id === cid).sort((a, b) => a.sort - b.sort)
    .map(cv => M.get('vendors', cv.vendor_id)).filter(v => v && v.active !== false),
  // 空間別是一份總清單；這戶的平面圖上標過哪些空間，填寫時就只出現那些（＋全室）。這戶還沒標就全部顯示。
  spacesFor: (unitId, floor, keepId) => {
    const all = M.list('spaces'); const plan = typeof pickPlan === 'function' ? pickPlan(unitId, floor) : null;
    const ids = new Set(plan ? S.m.plan_spaces.filter(m => m.plan_id === plan.id).map(m => m.space_id) : []);
    if (!ids.size) return all;
    return all.filter(sp => ids.has(sp.id) || sp.name === '全室' || sp.id === keepId);
  },
  unitsOf: bid => M.list('units').filter(u => u.building_id === bid),
  buildingsOf: sid => M.list('buildings').filter(b => b.site_id === sid),
};

// ---- 小工具 ----
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
const urlCache = new Map();
async function signedUrls(bucket, paths) {
  const need = [...new Set(paths.filter(p => p && !urlCache.has(bucket + '/' + p)))];
  if (need.length) {
    const { data, error } = await sb.storage.from(bucket).createSignedUrls(need, 60 * 60 * 8);
    if (error) throw error;
    (data || []).forEach(d => { if (d.signedUrl) urlCache.set(bucket + '/' + d.path, d.signedUrl); });
  }
  return paths.map(p => urlCache.get(bucket + '/' + p) || '');
}
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

function showViewer(url) { $('viewer-img').src = url; $('viewer').hidden = false; }
$('viewer').onclick = () => { $('viewer').hidden = true; };

const STATUS = { todo: '待修', fixed: '已修繕', closed: '結案' };
