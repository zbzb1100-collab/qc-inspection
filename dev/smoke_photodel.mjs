// 照片軟刪除：刪除只標記、不刪檔；管理者可在「已刪除的照片」還原
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
  T.defects.push({ id: 1, site_id: 1, inspect_type_id: 1, building_id: 1, floor: '8F', unit_id: 1, space_id: 2, category_id: 1, item_id: 1, fix_vendor_id: 1, resp_vendor_id: 1,
    created_by: 'u-boss', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', status: 'todo', description: 'a' });
  T.defect_photos.push({ id: 1, defect_id: 1, kind: 'before', path: '1/a.jpg', created_by: 'u-boss' },
    { id: 2, defect_id: 1, kind: 'before', path: '1/old.jpg', created_by: 'u-boss', deleted_at: '2026-10-02T00:00:00Z', deleted_by: 'u-boss' });
  window.__removed = []; const st = window.__mockSb.storage.from('photos'); const rm = st.remove;
});
await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file://')) return r.continue(); if (u.includes('xlsx') || u.includes('supabase')) return r.fulfill({ contentType: 'application/javascript', body: '' }); return r.fulfill({ contentType: 'text/css', body: '' }); });
await page.goto('file://' + root + 'index.html');
await page.fill('#l-email', 'boss@x.com'); await page.fill('#l-pass', 'pw'); await page.click('#l-go');
await page.waitForSelector('#app:not([hidden])');
await page.click('#floor .chip:has-text("8F")'); await page.click('#units button:has-text("A1")'); await page.click('#go');
await page.waitForSelector('#dlist .item');
await page.locator('#dlist .item').nth(0).click(); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(300);
ok(await page.locator('#sh-photos .ph').count() === 1, '已刪除的照片不出現在一般照片區');
ok(await page.isVisible('#sh-trash') && (await page.textContent('#sh-trashsum')).includes('1 張'), '管理者看到「已刪除的照片 1 張」');
await page.click('#sh-photos .ph img'); await page.click('#viewer-del'); await page.click('#viewer-del');
await page.click('#sh-save'); await page.waitForTimeout(300);
const ph = await page.evaluate(() => window.__db.T.defect_photos);
ok(ph.length === 2 && ph.find(p => p.id === 1).deleted_at, '刪除照片只標記，紀錄還在');
await page.locator('#dlist .item').nth(0).click(); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(300);
ok(await page.locator('#sh-photos .ph').count() === 0 && (await page.textContent('#sh-trashsum')).includes('2 張'), '重開後兩張都在已刪除區');
await page.click('#sh-trash summary'); await page.locator('#sh-trashimg .btn').first().click(); await page.waitForTimeout(300);
ok(await page.locator('#sh-photos .ph').count() === 1 && (await page.evaluate(() => window.__db.T.defect_photos.filter(p => !p.deleted_at).length)) === 1, '按還原後照片回來');
ok(errors.length === 0, 'JS 錯誤：' + errors.join('|'));
console.log(results.join('\n')); await browser.close(); process.exit(fail.length ? 1 : 0);
