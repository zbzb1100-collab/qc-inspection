/* 登入、畫面切換、啟動 */
const SCREENS = ['pick', 'fill', 'report', 'admin'];
function show(name) {
  SCREENS.forEach(s => { $('s-' + s).hidden = s !== name; $('t-' + s).classList.toggle('on', s === name); });
  document.querySelector('main').scrollTop = 0;
  const b = S.sel && M.get('buildings', S.sel.bldId), u = S.sel && M.get('units', S.sel.unitId);
  $('crumb').textContent = { pick: '選戶', fill: b && u ? `${b.name} ${S.sel.floor} ${u.code}` : '填寫', report: '報表', admin: '管理' }[name];
  const run = { pick: renderPick, fill: renderFill, report: async () => { initReportFilters(); await runReport(); }, admin: async () => renderAdmin() }[name];
  Promise.resolve(run()).catch(e => { console.error(e); toast(errMsg(e)); });
}
SCREENS.forEach(s => $('t-' + s).onclick = () => {
  if (s === 'fill' && !S.sel.unitId) { toast('請先在「選戶」選好戶別'); return; }
  show(s);
});

function showLogin(msg) {
  $('app').hidden = true; $('login').hidden = false; $('l-err').textContent = msg || ''; $('l-pass').value = '';
}
$('login-form').onsubmit = async e => {
  e.preventDefault();
  const btn = $('l-go'); $('l-err').textContent = '';
  await guard(btn, async () => {
    const { data, error } = await sb.auth.signInWithPassword({ email: $('l-email').value.trim(), password: $('l-pass').value });
    if (error) { $('l-err').textContent = /Invalid login/i.test(error.message) ? '帳號或密碼錯誤' : errMsg(error); return; }
    await enter(data.user);
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
    await sb.auth.signOut(); showLogin('這個帳號已停用或尚未啟用，請聯絡管理者。'); return;
  }
  S.sel = loadSel(); normalizeSel();
  $('login').hidden = true; $('app').hidden = false;
  $('userbtn').textContent = S.profile.name || S.profile.email || '我';
  $('t-admin').hidden = !isAdmin();
  show('pick');
}

(async function boot() {
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) await enter(data.session.user); else showLogin();
  } catch (e) { console.error(e); showLogin('無法連線：' + errMsg(e)); }
})();
