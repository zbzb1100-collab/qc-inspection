// 廠商帳號畫面測試（權限本身由資料庫把關，這裡只測畫面）
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const root = new URL('..', import.meta.url).pathname;
const mock = fs.readFileSync(root + 'dev/mock-supabase.js', 'utf8');
const results = []; const fail = [];
const ok = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail.push(m); };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(mock);
await page.addInitScript(() => {
  const T = window.__db.T;
  T.profiles.push({ id: 'u-ven', name: '太隆', email: 'ven@x.com', role: 'vendor', vendor_id: 1, active: true, created_at: '2026-01-03' });
  T.defects.push({ id: 1, site_id: 1, inspect_type_id: 1, building_id: 1, floor: '8F', unit_id: 1, space_id: 2, category_id: 1, item_id: 1, fix_vendor_id: 1, resp_vendor_id: 1,
    status: 'todo', description: '窗框滲水', created_by: 'u-staff', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' });
});
await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file://')) return r.continue(); if (u.includes('xlsx') || u.includes('supabase')) return r.fulfill({ contentType: 'application/javascript', body: '' }); return r.fulfill({ contentType: 'text/css', body: '' }); });
await page.goto('file://' + root + 'index.html');
await page.fill('#l-email', 'ven@x.com'); await page.fill('#l-pass', 'pw'); await page.click('#l-go');
await page.waitForSelector('#app:not([hidden])');
await page.waitForTimeout(400);
ok(!(await page.locator('#s-report').isHidden()), '廠商登入直接到報表');
ok(await page.locator('#t-admin').isHidden(), '廠商看不到管理');
await page.locator('#rtable tr').first().click(); await page.waitForSelector('#sheet:not([hidden])');
ok(await page.locator('#sh-cat .chip').first().isDisabled(), '缺失內容不能改');
ok(await page.locator('#sh-desc').isDisabled(), '說明不能改');
ok(await page.locator('#sh-save').isHidden() && await page.locator('#sh-del').isHidden() && await page.locator('#sh-nofix').isHidden(), '沒有儲存/刪除/不修');
ok(await page.locator('#sh-photos label').count() === 0, '不能加修繕前照片');
ok(await page.locator('#sh-afterphotos label').count() === 1 && await page.locator('#sh-fixed').isVisible(), '可以拍修繕後照片、按①');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
await page.locator('#sh-afterphotos input').setInputFiles([{ name: 'a.png', mimeType: 'image/png', buffer: png }]); await page.waitForTimeout(300);
await page.click('#sh-fixed'); await page.waitForSelector('#sheet', { state: 'hidden' });
const d = await page.evaluate(() => window.__db.T.defects[0]);
ok(d.status === 'fixed', '回報修繕完成');
await page.locator('#rtable tr').first().click(); await page.waitForSelector('#sheet:not([hidden])');
ok(await page.locator('#sh-pass').isHidden() && await page.locator('#sh-reopen').isHidden(), '已修繕後廠商不能複驗/退回');
await page.click('#sh-cancel');
// 填寫頁不能新增
await page.click('#t-pick'); await page.click('#floor .chip:has-text("8F")'); await page.click('#units button:has-text("A1")'); await page.click('#go');
await page.waitForTimeout(300);
ok(await page.locator('#add-nopos').isHidden(), '填寫頁沒有新增按鈕');
ok(errors.length === 0, 'JS 錯誤：' + errors.join('|'));
console.log(results.join('\n')); await browser.close(); process.exit(fail.length ? 1 : 0);
