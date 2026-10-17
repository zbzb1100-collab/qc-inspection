// 驗屋報告轉檔測試：上傳 PDF → 排隊 →（模擬排程寫回結果）→ 預覽補選 → 匯入 → 狀態變已匯入
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const root = new URL('..', import.meta.url).pathname;
const mock = fs.readFileSync(root + 'dev/mock-supabase.js', 'utf8');
const results = []; const fail = [];
const ok = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail.push(m); };
const pdf = '/tmp/claude-0/xl/test_report.pdf'; fs.writeFileSync(pdf, '%PDF-1.4\n%%EOF\n');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(mock);
await page.route('**/*', r => r.request().url().startsWith('file://') ? r.continue() : r.fulfill({ contentType: 'application/javascript', body: '' }));
await page.goto('file://' + root + 'index.html');
await page.fill('#l-email', 'staff@x.com'); await page.fill('#l-pass', 'pw'); await page.click('#l-go');
await page.waitForSelector('#app:not([hidden])');
ok(await page.isVisible('#t-jobs'), '一般帳號看得到「報告」');
await page.click('#t-jobs'); await page.waitForSelector('#job-go');
await page.click('#job-go'); ok(await page.locator('#job-go').isEnabled(), '沒填完不能送（按鈕恢復）');
await page.selectOption('#job-bld', { label: 'A棟' }); await page.selectOption('#job-floor', '8F');
await page.selectOption('#job-unit', { label: 'A1' }); await page.selectOption('#job-type', { label: '交屋檢查' });
await page.fill('#job-vendor', '鷹眼'); await page.setInputFiles('#job-file', pdf);
await page.click('#job-go'); await page.waitForSelector('[data-job]');
let db = await page.evaluate(() => ({ j: window.__db.T.report_jobs, f: Object.keys(window.__db.files) }));
const j = db.j[0];
ok(db.j.length === 1 && j.status === 'pending' && j.building_id === 1 && j.floor === '8F' && j.unit_id === 1 && j.vendor === '鷹眼' && j.created_by === 'u-staff', '建立待轉檔工作');
ok(db.f.includes('reports/' + j.path) && /^[0-9a-f-]{36}\/report\.pdf$/.test(j.path), 'PDF 存到 reports：' + j.path);
ok((await page.textContent('[data-job]')).includes('待轉檔'), '清單顯示待轉檔');
ok(!(await page.locator('[data-job] button:has-text("確認匯入")').count()), '還沒轉好不能匯入');

// 模擬排程：寫回 2 列＋照片＋略過項
await page.evaluate(async () => {
  const j = window.__db.T.report_jobs[0]; const dir = j.path.replace(/\/[^/]*$/, '');
  const c = document.createElement('canvas'); c.width = 20; c.height = 20; const blob = await new Promise(r => c.toBlob(r, 'image/jpeg'));
  window.__db.files['reports/' + dir + '/photos/P-1.jpg'] = blob; window.__db.files['reports/' + dir + '/photos/P-2.jpg'] = blob;
  const base = { '棟別': 'A棟', '樓層': '8F', '戶別': 'A1', '檢查類型': '交屋檢查', '修繕方式': '', '修繕廠商': '', '責任廠商': '', '對應備註': '' };
  j.result = { rows: [
    { ...base, '空間': '客餐廳', '工項': '01防水', '缺失內容': '有漏水或滲水情況', '缺失說明': '窗框滲水', '照片': 'P-1.jpg、P-2.jpg', '報告編號': '1' },
    { ...base, '空間': '書房', '工項': '10油漆', '缺失內容': '牆面油漆不勻', '缺失說明': '牆面色差', '照片': '', '報告編號': '2', '對應備註': '空間對不到' },
    { ...base, '空間': '客餐廳', '工項': '01防水', '缺失內容': '有漏水或滲水情況', '缺失說明': '門檻或門框不確定', '照片': '', '報告編號': '3', '對應備註': '不確定是門框還是門檻' }],
    skip: [['3', '插座面板歪斜', '已於現場改善']] };
  j.status = 'done'; j.message = '第 2 項空間不確定';
});
await page.click('button:has-text("重新整理")');
await page.waitForSelector('[data-job] button:has-text("確認匯入")');
const card = await page.textContent('[data-job]');
ok(card.includes('已轉好') && card.includes('讀出 3 筆') && card.includes('第 2 項空間不確定'), '轉好後顯示筆數與 AI 提醒');
await page.click('[data-job] button:has-text("確認匯入")'); await page.waitForSelector('[data-job] table');
ok((await page.textContent('[data-job] details summary')).includes('不匯入 1 項'), '顯示 AI 略過的項目');
ok(/可匯入 2　待補選 1.*有疑問 2/.test(await page.textContent('[data-job] p.hint')), '預覽：2 筆可匯入、1 筆待補選、2 筆有疑問：' + await page.textContent('[data-job] p.hint'));
const r3 = page.locator('[data-job] tbody tr').nth(2);
ok((await r3.locator('select').count()) === 3 && (await r3.locator('select').nth(1).inputValue()) === '1', '有疑問的列：空間/工項/缺失內容都可下拉，且預選 AI 的答案');
await r3.locator('select').nth(0).selectOption({ label: '前陽台' });
await page.locator('[data-job] tbody tr').nth(1).locator('select').nth(0).selectOption({ label: '前陽台' });
await page.click('#im-go');
await page.waitForFunction(() => window.__db.T.report_jobs[0].status === 'imported');
db = await page.evaluate(() => ({ d: window.__db.T.defects, p: window.__db.T.defect_photos, j: window.__db.T.report_jobs[0] }));
ok(db.d.length === 3 && db.d[2].space_id === 3 && db.d[1].space_id === 3 && db.d[0].description === '窗框滲水（報告編號 1）', '匯入 2 筆缺失（含補選空間）');
ok(db.p.length === 2 && db.p.every(p => p.kind === 'before' && p.defect_id === db.d[0].id), '照片從 reports 下載後存成修繕前照片');
ok(db.j.imported_by === 'u-staff' && db.j.imported_at, '工作標記已匯入');
await page.waitForFunction(() => document.querySelector('[data-job]') && document.querySelector('[data-job]').textContent.includes('已匯入'));
ok(!(await page.locator('[data-job] button:has-text("確認匯入")').count()), '匯入後不能再匯一次');
// 刪除：按兩次
await page.click('[data-job] button:has-text("刪除")'); ok((await page.evaluate(() => window.__db.T.report_jobs.length)) === 1, '刪除第一下不會刪');
await page.click('[data-job] button:has-text("刪除")'); await page.waitForFunction(() => !window.__db.T.report_jobs.length);
ok(!(await page.evaluate(() => Object.keys(window.__db.files).some(k => k.startsWith('reports/')))), '刪除連 PDF 與照片一起清掉');
ok(errors.length === 0, 'JS 錯誤：' + errors.join('|'));
console.log(results.join('\n')); await browser.close(); process.exit(fail.length ? 1 : 0);
