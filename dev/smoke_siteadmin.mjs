// 清單各案場一份、案管理者（27）
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const root = new URL('..', import.meta.url).pathname;
const mock = fs.readFileSync(root + 'dev/mock-supabase.js', 'utf8');
const results = []; const fail = [];
const ok = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail.push(m); };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
async function open(email, init) {
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.addInitScript(mock); if (init) await page.addInitScript(init);
  await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file://')) return r.continue(); if (u.includes('xlsx') || u.includes('supabase')) return r.fulfill({ contentType: 'application/javascript', body: '' }); return r.fulfill({ contentType: 'text/css', body: '' }); });
  await page.goto('file://' + root + 'index.html');
  await page.fill('#l-email', email); await page.fill('#l-pass', 'pw'); await page.click('#l-go');
  await page.waitForSelector('#app:not([hidden])'); await page.waitForTimeout(300);
  return page;
}
const init = () => {
  const T = window.__db.T; T.sites.push({ id: 2, name: '平實公宅', sort: 2, active: true });
  ['inspect_types', 'spaces', 'categories', 'items', 'category_vendors', 'repair_methods'].forEach(t => T[t].forEach(r => { r.site_id = 1; }));
  T.inspect_types.push({ id: 50, site_id: 2, name: '自主檢查', sort: 1, active: true });
  T.categories.push({ id: 60, site_id: 2, name: '泥作工程', sort: 1, active: true });
  T.items.push({ id: 70, site_id: 2, category_id: 60, name: '空心', sort: 1, active: true });
  T.buildings.push({ id: 9, site_id: 2, name: 'Z棟', floors: ['3F'], sort: 1, active: true });
  T.user_sites = [{ user_id: 'u-staff', site_id: 1, is_admin: true }, { user_id: 'u-staff', site_id: 2, is_admin: false }]; T.user_vendors = [];
};
let page = await open('staff@x.com', init);
ok(await page.isVisible('#t-admin'), '案管理者看得到「管理」');
ok(await page.evaluate(() => M.list('categories').map(c => c.name).join(',')) === '01防水,10油漆', '武東二段只看到自己的工項');
await page.click('#t-admin'); await page.click('#adm-tabs button[data-tab=cat]'); await page.waitForTimeout(200);
ok((await page.textContent('#admin-root')).includes('正在設定：武東二段'), '後台寫明正在設定哪個案場');
await page.locator('.lt-add input').last().fill('新工項'); await page.locator('.lt-add button').last().click(); await page.waitForTimeout(300);
const nc = await page.evaluate(() => window.__db.T.categories.find(c => c.name === '新工項'));
ok(nc && nc.site_id === 1, '新增的工項掛在目前案場');
await page.click('#adm-tabs button[data-tab=vendor]'); await page.waitForTimeout(200);
ok(await page.locator('#sec-vendor .lt input').first().evaluate(i => i.readOnly) && await page.locator('#sec-vendor .lt button:has-text("更多")').count() === 0, '案管理者不能改廠商名稱、合併');
await page.click('#adm-tabs button[data-tab=other]'); await page.waitForTimeout(200);
ok((await page.textContent('#admin-root')).includes('請找總管理者'), '案場設定只給總管理者');
await page.click('#adm-tabs button[data-tab=user]'); await page.waitForTimeout(200);
ok(await page.locator('.sublist input[data-site="2"]').count() === 0, '案管理者只看得到自己管的案場勾選');
ok(await page.locator('.sublist select option[value=admin]').count() === 0 || (await page.locator('.sublist .r', { hasText: 'boss@x.com' }).count()) <= 1, '不能把人設成總管理者');
await page.click('#t-pick'); await page.selectOption('#site', '2'); await page.waitForTimeout(300);
ok(await page.evaluate(() => M.list('categories').map(c => c.name).join(',')) === '泥作工程', '換到平實公宅，清單跟著換');
await page.click('#t-admin'); await page.waitForTimeout(200);
ok((await page.textContent('#admin-root')).includes('不是「平實公宅」的案管理者'), '不是自己管的案場不能改');
ok(page.errors.length === 0, 'JS 錯誤：' + page.errors.join('|'));
// 總管理者：每個案場可以勾案管理者
page = await open('boss@x.com', init);
await page.click('#t-admin'); await page.click('#adm-tabs button[data-tab=user]'); await page.waitForTimeout(200);
const row = page.locator('.sublist .r', { hasText: 'staff@x.com' });
ok(await row.locator('select').first().inputValue() === 'siteadmin' && await row.locator('input[data-siteadm="1"]').isChecked() && !(await row.locator('input[data-siteadm="2"]').isChecked()), '帳號頁顯示誰是哪個案場的案管理者');
await row.locator('input[data-siteadm="2"]').check(); await row.locator('button:has-text("儲存")').click(); await page.waitForTimeout(300);
const us = await page.evaluate(() => window.__db.T.user_sites.filter(x => x.user_id === 'u-staff' && x.is_admin).map(x => x.site_id).sort().join(','));
ok(us === '1,2', '總管理者把他設成兩個案場的案管理者：' + us);
ok(page.errors.length === 0, 'JS 錯誤：' + page.errors.join('|'));
// 一般人改成案管理者：角色選單直接選，預設勾目前案場
{
  await page.evaluate(() => { window.__db.T.profiles.push({ id: 'u-x', name: '新人', email: 'x@x.com', role: 'user', active: true, created_at: '2026-10-24' }); window.__db.T.user_sites.push({ user_id: 'u-x', site_id: 1, is_admin: false }); });
  await page.evaluate(() => reloadAdmin()); await page.waitForTimeout(300);
  const rx = page.locator('.sublist .r', { hasText: 'x@x.com' });
  await rx.locator('select').first().selectOption('siteadmin');
  ok(await rx.locator('input[data-siteadm="1"]').isChecked(), '角色選「案管理者」自動勾目前案場');
  await rx.locator('button:has-text("儲存")').click(); await page.waitForTimeout(300);
  const px = await page.evaluate(() => [window.__db.T.profiles.find(p => p.id === 'u-x').role, window.__db.T.user_sites.find(x => x.user_id === 'u-x' && x.site_id === 1).is_admin]);
  ok(px[0] === 'user' && px[1] === true, '存成一般＋武東二段案管理者：' + px);
  ok(page.errors.length === 0, 'JS 錯誤：' + page.errors.join('|'));
}
console.log(results.join('\n')); await browser.close(); process.exit(fail.length ? 1 : 0);
