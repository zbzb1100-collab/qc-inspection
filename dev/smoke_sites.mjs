// 案場權限：帳號頁可勾可用案場；待開通預設勾目前案場；沒開通案場的人看到提示
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
  const T = window.__db.T; T.sites.push({ id: 2, name: '第二案場', sort: 2, active: true });
  T.profiles.push({ id: 'u-new', name: '王小明', email: 'new@x.com', role: 'user', active: false, pending: true, created_at: '2026-10-23' });
  T.user_sites = [{ user_id: 'u-staff', site_id: 1 }];
};
let page = await open('boss@x.com', init);
await page.click('#t-admin'); await page.click('#adm-tabs button[data-tab=user]'); await page.waitForTimeout(200);
const newRow = page.locator('.sublist .r').first();
ok((await newRow.textContent()).includes('可用案場') && await newRow.locator('input[data-site="1"]').isChecked() && !(await newRow.locator('input[data-site="2"]').isChecked()), '待開通的人預設勾目前案場');
const staffRow = page.locator('.sublist .r', { hasText: 'staff@x.com' });
await staffRow.locator('input[data-site="1"]').uncheck();
await staffRow.locator('button:has-text("儲存")').click(); await page.waitForTimeout(200);
ok((await page.textContent('#toast')).includes('至少勾一個'), '啟用中的一般帳號至少要勾一個案場');
await page.locator('.sublist .r', { hasText: 'staff@x.com' }).locator('input[data-site="2"]').check();
await page.locator('.sublist .r', { hasText: 'staff@x.com' }).locator('button:has-text("儲存")').click(); await page.waitForTimeout(300);
const us = await page.evaluate(() => window.__db.T.user_sites.filter(x => x.user_id === 'u-staff').map(x => x.site_id).sort());
ok(us.join(',') === '2', '儲存後只開通第二案場：' + us);
ok(await page.locator('.sublist .r', { hasText: 'boss@x.com' }).locator('input[data-site="1"]').isDisabled(), '管理者的案場勾選鎖住（看得到全部）');
ok(page.errors.length === 0, 'JS 錯誤：' + page.errors.join('|'));
page = await open('staff@x.com', () => { window.__db.T.sites.length = 0; });
ok((await page.textContent('#bld')).includes('還沒開通任何案場'), '沒有案場的人看到找管理者的提示');
ok(page.errors.length === 0, 'JS 錯誤：' + page.errors.join('|'));
console.log(results.join('\n')); await browser.close(); process.exit(fail.length ? 1 : 0);
