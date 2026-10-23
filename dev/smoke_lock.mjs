// 結案鎖定：已結案不能改、不能加刪照片；管理者重新開案要填原因
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const root = new URL('..', import.meta.url).pathname;
const mock = fs.readFileSync(root + 'dev/mock-supabase.js', 'utf8');
const results = []; const fail = [];
const ok = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail.push(m); };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
async function open(email) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.addInitScript(mock);
  await page.addInitScript(() => {
    const T = window.__db.T;
    const base = { site_id: 1, inspect_type_id: 1, building_id: 1, floor: '8F', unit_id: 1, space_id: 2, category_id: 1, item_id: 1, fix_vendor_id: 1, resp_vendor_id: 1,
      created_by: 'u-staff', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', closed_at: '2026-10-02T00:00:00Z', closed_by: 'u-staff' };
    T.defects.push({ id: 1, ...base, status: 'closed', close_type: '複驗合格', description: '牆面裂縫' });
    T.defect_photos.push({ id: 1, defect_id: 1, kind: 'after', path: '1/a.jpg', created_by: 'u-staff' });
  });
  await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file://')) return r.continue(); if (u.includes('xlsx') || u.includes('supabase')) return r.fulfill({ contentType: 'application/javascript', body: '' }); return r.fulfill({ contentType: 'text/css', body: '' }); });
  await page.goto('file://' + root + 'index.html');
  await page.fill('#l-email', email); await page.fill('#l-pass', 'pw'); await page.click('#l-go');
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#floor .chip:has-text("8F")'); await page.click('#units button:has-text("A1")');
  await page.evaluate(() => { const c = document.querySelector('#showclosed'); if (c && !c.checked) c.click(); });
  await page.click('#go'); await page.waitForTimeout(300);
  return page;
}
async function openDefect(page) {
  await page.evaluate(() => openDefect(window.__db.T.defects[0], { onDone() {} }));
  await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(300);
}
let page = await open('staff@x.com'); await openDefect(page);
ok(!(await page.isVisible('#sh-save')) && !(await page.isVisible('#sh-del')), '一般人員：已結案沒有儲存、刪除');
ok(await page.locator('#sh-cat .chip').first().isDisabled() && await page.locator('#sh-desc').isDisabled(), '欄位都鎖住');
ok(await page.locator('#sh-afterphotos label').count() === 0 && await page.locator('#sh-photos label').count() === 0, '不能加照片');
await page.click('#sh-afterphotos .ph img'); await page.waitForTimeout(100);
ok(!(await page.isVisible('#viewer-del')), '大圖沒有刪除鈕');
await page.click('#viewer');
ok(!(await page.isVisible('#sh-reopen')) && (await page.textContent('#sh-closeinfo')).includes('找管理者重新開案'), '一般人員沒有重新開案，提示找管理者');
ok(page.errors.length === 0, '一般人員 JS 錯誤：' + page.errors.join('|'));
page = await open('boss@x.com'); await openDefect(page);
ok(await page.isVisible('#sh-reopen') && (await page.textContent('#sh-reopen')).includes('重新開案'), '管理者有「重新開案」');
await page.click('#sh-reopen');
ok(await page.isVisible('#sh-reopen-reason') && await page.isVisible('#sh-reopen-go'), '按下先出現原因欄');
await page.click('#sh-reopen-go'); await page.waitForTimeout(200);
ok((await page.evaluate(() => window.__db.T.defects[0].status)) === 'closed', '沒填原因不會開案');
await page.fill('#sh-reopen-reason', '住戶反映又裂了'); await page.click('#sh-reopen-go'); await page.waitForTimeout(300);
const d = await page.evaluate(() => window.__db.T.defects[0]);
ok(d.status === 'todo' && d.reopen_reason === '住戶反映又裂了', '填原因後退回待修並記原因');
ok(page.errors.length === 0, '管理者 JS 錯誤：' + page.errors.join('|'));
console.log(results.join('\n')); await browser.close(); process.exit(fail.length ? 1 : 0);
