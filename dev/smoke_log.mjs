// 修改歷程：表單下方可展開，顯示誰在什麼時候把哪個欄位從什麼改成什麼
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
  const base = { site_id: 1, inspect_type_id: 1, building_id: 1, floor: '8F', unit_id: 1, space_id: 2, category_id: 1, item_id: 1, fix_vendor_id: 1, resp_vendor_id: 1,
    created_by: 'u-staff', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' };
  T.defects.push({ id: 1, ...base, status: 'fixed', description: '牆面裂縫' });
  T.defect_logs = [
    { id: 1, defect_id: 1, action: '新增', changes: { status: 'todo' }, by_user: 'u-staff', at: '2026-10-01T01:00:00Z' },
    { id: 2, defect_id: 1, action: '修改', changes: { description: ['牆裂', '牆面裂縫'], status: ['todo', 'fixed'], x: [0.2, 0.3], y: [0.4, 0.5], updated_at: ['a', 'b'] }, by_user: 'u-staff', at: '2026-10-02T01:00:00Z' },
    { id: 3, defect_id: 1, action: '刪除照片', changes: { kind: 'after', path: '1/a.jpg' }, by_user: 'u-staff', at: '2026-10-03T01:00:00Z' },
    { id: 4, defect_id: 9, action: '修改', changes: { description: ['x', 'y'] }, by_user: 'u-staff', at: '2026-10-03T01:00:00Z' },
  ];
});
await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file://')) return r.continue(); if (u.includes('xlsx') || u.includes('supabase')) return r.fulfill({ contentType: 'application/javascript', body: '' }); return r.fulfill({ contentType: 'text/css', body: '' }); });
await page.goto('file://' + root + 'index.html');
await page.fill('#l-email', 'staff@x.com'); await page.fill('#l-pass', 'pw'); await page.click('#l-go');
await page.waitForSelector('#app:not([hidden])');
await page.click('#floor .chip:has-text("8F")'); await page.click('#units button:has-text("A1")'); await page.click('#go');
await page.waitForSelector('#dlist .item');
await page.locator('#dlist .item').nth(0).click(); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(300);
ok(await page.isVisible('#sh-log summary') && !(await page.isVisible('#sh-loglist')), '有收合的「修改歷程」');
await page.click('#sh-log summary'); await page.waitForTimeout(300);
const rows = await page.locator('#sh-loglist .logrow').allTextContents();
ok(rows.length === 3, '只列這筆缺失的 3 筆紀錄：' + rows.length);
ok(rows[0].includes('刪除修繕後照片'), '最新的在最上面，照片刪除寫清楚種類');
ok(rows[1].includes('缺失說明：牆裂 → 牆面裂縫') && rows[1].includes('狀態：待修 → 已修繕') && rows[1].includes('調整圖上位置') && !rows[1].includes('updated'), '修改列出欄位前後值、位置只寫一次、不顯示系統欄位');
ok(rows[2].includes('新增這筆缺失'), '有新增紀錄');
ok(errors.length === 0, 'JS 錯誤：' + errors.join('|'));
console.log(results.join('\n')); await browser.close(); process.exit(fail.length ? 1 : 0);
