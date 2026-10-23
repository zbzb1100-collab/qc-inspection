/* 登入、畫面切換、啟動 */
const SCREENS = ['pick', 'fill', 'report', 'jobs', 'admin'];
function show(name) {
  SCREENS.forEach(s => { $('s-' + s).hidden = s !== name; $('t-' + s).classList.toggle('on', s === name); });
  document.querySelector('main').scrollTop = 0;
  const b = S.sel && M.get('buildings', S.sel.bldId), u = S.sel && M.get('units', S.sel.unitId);
  $('crumb').textContent = { pick: '選戶', fill: b && u ? `${b.name} ${S.sel.floor} ${u.code}` : '填寫', report: '報表', jobs: '驗屋報告', admin: '管理' }[name];
  const run = { pick: renderPick, fill: renderFill, report: async () => { initReportFilters(); await runReport(); }, jobs: renderJobs, admin: async () => renderAdmin() }[name];
  Promise.resolve(run()).catch(e => { console.error(e); toast(errMsg(e)); });
}
SCREENS.forEach(s => $('t-' + s).onclick = () => {
  if (s === 'fill' && !S.sel.unitId) { toast('請先在「選戶」選好戶別'); return; }
  show(s);
});

function showLogin(msg, ok) {
  $('app').hidden = true; $('login').hidden = false; $('l-err').textContent = msg || ''; $('l-err').classList.toggle('ok', !!ok); $('l-pass').value = '';
}
try { const m = localStorage.getItem('qc-email'); if (m) { $('l-email').value = m; $('l-remember').checked = true; } } catch (e) {}
$('l-eye').onclick = () => { const p = $('l-pass'), show = p.type === 'password'; p.type = show ? 'text' : 'password'; $('l-eye').classList.toggle('on', show); $('l-eye').setAttribute('aria-label', show ? '隱藏密碼' : '顯示密碼'); };
$('login-form').onsubmit = async e => {
  e.preventDefault();
  const btn = $('l-go'); $('l-err').textContent = ''; $('l-err').classList.remove('ok');
  await guard(btn, async () => {
    const { data, error } = await sb.auth.signInWithPassword({ email: $('l-email').value.trim(), password: $('l-pass').value });
    if (error) { $('l-err').textContent = /Invalid login/i.test(error.message) ? '帳號或密碼錯誤' : errMsg(error); return; }
    try { if ($('l-remember').checked) localStorage.setItem('qc-email', $('l-email').value.trim()); else localStorage.removeItem('qc-email'); } catch (e) {}
    await enter(data.user);
  });
};
// 申請帳號：建好的帳號先停用（19_申請帳號.sql），管理者在後台「帳號」開通
const showApply = on => { $('login-form').hidden = on; $('apply-form').hidden = !on; $('a-err').textContent = ''; (on ? $('a-name') : $('l-email')).focus(); };
$('l-apply').onclick = () => { $('a-email').value = $('l-email').value.trim(); showApply(true); };
$('a-back').onclick = () => showApply(false);
$('apply-form').onsubmit = async e => {
  e.preventDefault();
  const err = $('a-err'); err.textContent = '';
  const name = $('a-name').value.trim(), email = $('a-email').value.trim(), pw = $('a-pass').value;
  if (pw !== $('a-pass2').value) { err.textContent = '兩次輸入的密碼不一樣'; return; }
  await guard($('a-go'), async () => {
    const { data, error } = await sb.auth.signUp({ email, password: pw, options: { data: { name } } });
    if (error) {
      err.textContent = /already|registered|exists/i.test(error.message) ? '這個 Email 已經申請過了，請直接登入，或請管理者幫你開通。'
        : /not allowed|disabled/i.test(error.message) ? '目前沒有開放申請，請聯絡管理者。'
        : /password/i.test(error.message) ? '密碼太簡單，至少要 6 碼。' : errMsg(error);
      return;
    }
    if (data && data.session) await sb.auth.signOut();   // 申請完不要直接登入，等開通
    ['a-name', 'a-pass', 'a-pass2'].forEach(id => { $(id).value = ''; });
    $('l-email').value = email; showApply(false);
    showLogin(`已送出申請（${email}）。請等管理者開通後，再用這組 Email 和密碼登入。`, true);
  });
};
let logoutArm = 0;
$('userbtn').onclick = async () => {
  const b = $('userbtn');
  if (!logoutArm) { logoutArm = setTimeout(() => { logoutArm = 0; b.textContent = S.profile ? S.profile.name || S.profile.email : ''; }, 3000); b.textContent = '登出？'; return; }
  clearTimeout(logoutArm); logoutArm = 0; await sb.auth.signOut(); S.user = null; showLogin();
};

async function enter(user) {
  S.user = user;
  try { await loadMaster(); }
  catch (e) { console.error(e); showLogin('讀取資料失敗：' + errMsg(e)); await sb.auth.signOut(); return; }
  S.profile = S.m.profiles.find(p => p.id === user.id);
  if (!S.profile || !S.profile.active) {
    await sb.auth.signOut(); showLogin(S.profile && S.profile.pending ? '帳號申請已收到，還在等管理者開通。' : '這個帳號已停用或尚未啟用，請聯絡管理者。'); return;
  }
  S.sel = loadSel(); normalizeSel();
  $('login').hidden = true; $('app').hidden = false;
  $('userbtn').textContent = S.profile.name || S.profile.email || '我';
  $('t-admin').hidden = !isAnySiteAdmin();
  { const w = isAnySiteAdmin() ? S.m.profiles.filter(p => p.pending && !p.active).length : 0; if (w) setTimeout(() => toast(`有 ${w} 個帳號申請等你開通（管理 → 帳號）`), 600); }
  $('t-jobs').hidden = isVendor();
  show(isVendor() ? 'report' : 'pick');   // 廠商一進來就看自己的缺失清單
}

(async function boot() {
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) await enter(data.session.user); else showLogin();
  } catch (e) { console.error(e); showLogin('無法連線：' + errMsg(e)); }
})();

// 外觀：每台裝置各自記住
const SKINS = [['pro', '專業藍', '#2f5b8f'], ['soft', '清爽圓角', '#3478d4'], ['m3', 'Material', '#0f7c99'], ['tech', '科技感（深色）', '#22d3ee']];
function setSkin(k) {
  document.documentElement.dataset.skin = k;
  try { localStorage.setItem('qc-skin', k); } catch (e) {}
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = k === 'tech' ? '#0d1626' : '#ffffff';
}
$('skinbtn').onclick = e => {
  e.stopPropagation(); const p = $('skinpick');
  if (!p.hidden) { p.hidden = true; return; }
  p.innerHTML = '';
  SKINS.forEach(([k, name, c]) => {
    const b = el('button', document.documentElement.dataset.skin === k ? 'on' : null); const dot = el('i'); dot.style.background = c;
    b.append(dot, name); b.onclick = () => { setSkin(k); p.hidden = true; }; p.appendChild(b);
  });
  p.hidden = false;
};
document.addEventListener('click', e => { const p = $('skinpick'); if (!p.hidden && !p.contains(e.target)) p.hidden = true; });
setSkin(document.documentElement.dataset.skin || 'pro');
