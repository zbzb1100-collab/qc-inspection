import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const root = new URL('..', import.meta.url).pathname;
const mock = fs.readFileSync(root + 'dev/mock-supabase.js', 'utf8');
const results = []; const fail = [];
const ok = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail.push(m); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.addInitScript(mock);
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file://')) return r.continue();
  if (u.includes('supabase')) return r.fulfill({ contentType: 'application/javascript', body: '' });
  if (u.includes('xlsx')) return r.fulfill({ contentType: 'application/javascript', body: `window.XLSX={utils:{aoa_to_sheet:a=>({a}),book_new:()=>({}),book_append_sheet:()=>{}},writeFile:(wb,n)=>{window.__xlsx={n}}}` });
  return r.fulfill({ contentType: 'text/css', body: '' });
});
await page.goto('file://' + root + 'index.html');
const toastText = async () => (await page.locator('#toast').textContent());
const png = () => Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');

// ---- 登入 ----
ok(await page.locator('#login').isVisible(), '未登入時顯示登入畫面');
await page.fill('#l-email', 'boss@x.com'); await page.fill('#l-pass', 'wrong'); await page.click('#l-go');
await page.waitForTimeout(200);
ok((await page.textContent('#l-err')).includes('帳號或密碼錯誤'), '密碼錯誤顯示提示');
await page.fill('#l-pass', 'pw'); await page.click('#l-go');
await page.waitForSelector('#app:not([hidden])');
ok(await page.locator('#t-admin').isVisible(), '管理者看得到管理頁籤');
ok((await page.textContent('#userbtn')) === '管理員', '右上角顯示登入者名稱');

// ---- 選戶 ----
ok((await page.locator('#bld .chip').allTextContents()).join() === 'A棟,S店舖', '棟別清單');
await page.click('#bld .chip:has-text("S店舖")');
ok((await page.locator('#floor .chip').allTextContents()).join() === '1F', 'S店舖只有 1F');
await page.click('#bld .chip:has-text("A棟")');
ok((await page.locator('#floor .chip').allTextContents()).join() === '2F,3F,8F', 'A棟樓層');
await page.click('#floor .chip:has-text("8F")');
await page.click('#units button:has-text("A1")');
await page.click('#go');
ok(await page.locator('#s-fill').isVisible(), '進入填寫畫面');
ok((await page.textContent('#unitname')) === 'A棟 8F A1', '標題顯示 棟/樓/戶');
ok(await page.locator('#plan').isHidden(), '沒有平面圖時不顯示圖區');
ok((await page.textContent('#plannote')).includes('還沒有平面圖'), '提示尚無平面圖');

// ---- 管理：上傳平面圖（批次檔名）----
await page.click('#t-admin'); await page.waitForSelector('#admin-root details');
await page.locator('summary:has-text("平面圖")').click();
await page.locator('#admin-root input[type=file][multiple]').first().setInputFiles([
  { name: 'A1.png', mimeType: 'image/png', buffer: png() }, { name: 'A1-2F.png', mimeType: 'image/png', buffer: png() },
  { name: 'ZZ9.png', mimeType: 'image/png', buffer: png() }, { name: 'readme.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
await page.waitForTimeout(500);
const plans = await page.evaluate(() => window.__db.T.plans.map(p => p.unit_id + ':' + p.variant));
ok(plans.sort().join() === '1:2F,1:標準層', '批次匯入依檔名對到 A1 標準層與 2F，其餘略過：' + plans);
// 空間標記
await page.locator('button:has-text("標記空間位置")').first().click(); await page.waitForSelector('.plan .mark, #admin-root .plan');
await page.locator('details:has(summary:has-text("平面圖")) .chip:has-text("客餐廳")').click();
await page.waitForFunction(() => { const i = document.querySelector('#admin-root .plan img'); return i && i.naturalWidth > 0 && i.getBoundingClientRect().height > 20; });
const box = await page.locator('#admin-root .plan img').boundingBox();
await page.locator('#admin-root .plan img').click({ position: { x: box.width * 0.25, y: box.height * 0.5 } });
await page.waitForTimeout(200);
const marks = await page.evaluate(() => window.__db.T.plan_spaces.length);
ok(marks === 1, '點圖放上空間標記');

// ---- 填寫缺失 ----
await page.click('#t-pick'); await page.click('#units button:has-text("A1")'); await page.click('#go');
await page.waitForSelector('#plan:not([hidden])'); await page.waitForTimeout(300);
ok((await page.textContent('#marklegend')).includes('A＝客餐廳'), '填寫畫面顯示空間標記圖例');
const pb = await page.locator('#planimg').boundingBox();
await page.locator('#planimg').click({ position: { x: pb.width * 0.4, y: pb.height * 0.6 } });
await page.waitForSelector('#sheet:not([hidden])');
await page.click('#sh-save'); await page.waitForTimeout(150);
ok((await toastText()).includes('請選好空間'), '沒選完不能儲存');
await page.click('#sh-space .chip:has-text("客餐廳")');
await page.click('#sh-cat .chip:has-text("01防水")');
ok((await page.locator('#sh-fixvendor-chips .chip').allTextContents()).join() === '太隆興業,健暉工程行', '修繕廠商列出兩家按鈕');
ok(await page.locator('#sh-vendor').inputValue() === '1', '責任廠商預帶同修繕廠商');
await page.click('#sh-fixvendor-chips .chip:has-text("健暉工程行")');
ok(await page.locator('#sh-vendor').inputValue() === '2', '改修繕廠商後責任廠商跟著變');
await page.selectOption('#sh-vendor', '3');
await page.click('#sh-fixvendor-chips .chip:has-text("太隆興業")');
ok(await page.locator('#sh-vendor').inputValue() === '3', '手動改過責任廠商後不再被覆蓋');
await page.click('#sh-item .chip:has-text("漏水")');
await page.click('#sh-method .chip:has-text("修補")');
await page.fill('#sh-desc', '浴室天花滴水');
await page.locator('#sh-photos input[type=file]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png() });
await page.waitForSelector('#sh-photos .ph');
await page.click('#sh-save'); await page.waitForSelector('#sheet', { state: 'hidden' });
let d = await page.evaluate(() => ({ d: window.__db.T.defects, p: window.__db.T.defect_photos, f: Object.keys(window.__db.files) }));
ok(d.d.length === 1 && d.d[0].created_by === 'u-admin' && d.d[0].fix_vendor_id === 1 && d.d[0].resp_vendor_id === 3, '缺失寫入：建立者、修繕廠商、責任廠商正確');
ok(Math.abs(d.d[0].x - 0.4) < 0.03 && Math.abs(d.d[0].y - 0.6) < 0.03, '圖上位置以比例儲存');
ok(d.p.length === 1 && d.p[0].kind === 'before' && d.f.some(k => k.startsWith('photos/1/before_')), '修繕前照片已上傳');
ok((await page.locator('#dlist .item').count()) === 1 && (await page.locator('.pin').count()) === 1, '清單與圖釘各 1 筆');

// ---- 修繕流程 ----
await page.click('.pin'); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(200);
ok(await page.locator('#sh-repair').isVisible(), '既有缺失顯示修繕與複驗區');
ok(await page.locator('#sh-pass').isHidden(), '待修狀態不顯示複驗按鈕');
ok(await page.locator('#sh-fixdate').inputValue() !== '', '修繕完成日預帶今天');
await page.click('#sh-fixed'); await page.waitForTimeout(250);
ok((await toastText()).includes('修繕後照片'), '沒有修繕後照片不能標修繕完成');
await page.locator('#sh-afterphotos input[type=file]').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: png() });
await page.waitForSelector('#sh-afterphotos .ph');
await page.click('#sh-fixed'); await page.waitForSelector('#sheet', { state: 'hidden' });
d = await page.evaluate(() => window.__db.T.defects[0]);
ok(d.status === 'fixed' && d.fixed_date && d.fixed_by === 'u-admin', '標示修繕完成：狀態、日期、登錄者');
await page.click('.pin'); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(200);
ok(await page.locator('#sh-after, #sh-afterphotos .ph').count() === 1, '修繕後照片有保存並顯示');
await page.click('#sh-reopen'); await page.waitForSelector('#sheet', { state: 'hidden' });
ok((await page.evaluate(() => window.__db.T.defects[0].status)) === 'todo', '複驗不合格可退回待修');
await page.click('.pin'); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(150);
await page.click('#sh-fixed'); await page.waitForSelector('#sheet', { state: 'hidden' });
await page.click('.pin'); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(150);
await page.click('#sh-pass'); await page.waitForSelector('#sheet', { state: 'hidden' });
d = await page.evaluate(() => window.__db.T.defects[0]);
ok(d.status === 'closed' && d.close_type === '複驗合格' && d.closed_by === 'u-admin', '複驗合格結案');

// 不修（新增第二筆，不點位）
await page.click('#add-nopos'); await page.waitForSelector('#sheet:not([hidden])');
ok((await page.locator('#sh-space .chip').allTextContents()).join() === '全室,客餐廳', 'A1 平面圖只標了客餐廳→填寫只出現客餐廳與全室，沒有前陽台');
await page.click('#sh-space .chip:has-text("客餐廳")'); await page.click('#sh-cat .chip:has-text("10油漆")'); await page.click('#sh-item .chip:has-text("油漆不勻")');
await page.click('#sh-save'); await page.waitForSelector('#sheet', { state: 'hidden' });
await page.locator('#dlist .item').nth(1).click(); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(150);
await page.click('#sh-nofix'); await page.click('#sh-nofix-go'); await page.waitForTimeout(200);
ok((await toastText()).includes('不修的原因'), '不修必須填原因');
await page.fill('#sh-reason', '屋主同意現況'); await page.click('#sh-nofix-go'); await page.waitForSelector('#sheet', { state: 'hidden' });
d = await page.evaluate(() => window.__db.T.defects[1]);
ok(d.status === 'closed' && d.close_type === '不修' && d.close_reason === '屋主同意現況', '不修結案並記錄原因');

// ---- 報表 ----
await page.click('#t-report'); await page.waitForTimeout(400);
ok((await page.textContent('#st-all')) === '2' && (await page.textContent('#st-closed')) === '2', '報表統計');
await page.selectOption('#f-cat', '1'); await page.click('#f-go'); await page.waitForTimeout(300);
ok((await page.textContent('#st-all')) === '1', '工項篩選');
await page.click('#f-clear'); await page.waitForTimeout(300);
await page.selectOption('#f-fixv', '1'); await page.click('#f-go'); await page.waitForTimeout(300);
ok((await page.textContent('#st-all')) === '1', '修繕廠商篩選');
await page.click('#f-clear'); await page.waitForTimeout(300);
await page.selectOption('#f-respv', '3'); await page.click('#f-go'); await page.waitForTimeout(300);
ok((await page.textContent('#st-all')) === '2', '責任廠商篩選');
await page.click('#f-export'); await page.waitForTimeout(300);
ok(!!(await page.evaluate(() => window.__xlsx)) && (await page.evaluate(() => window.__xlsx.n)).endsWith('.xlsx'), '匯出 Excel 被呼叫');

// ---- 管理：清單 ----
await page.click('#t-admin');
await page.locator("summary", { hasText: /^廠商$/ }).click();
await page.locator('details:has(summary:text-is("廠商")) .inline-add input').last().fill('新廠商、第二廠商');
await page.locator('details:has(summary:text-is("廠商")) .inline-add button:has-text("新增")').click(); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.vendors.length)) === 5, '一次新增多個廠商');
await page.locator('details:has(summary:text-is("廠商")) .chip:text-is("第二廠商")').click();
await page.locator('details:has(summary:text-is("廠商")) button:has-text("刪除")').click();
await page.locator('details:has(summary:text-is("廠商")) button:has-text("確定刪除")').click(); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.vendors.length)) === 4, '刪除需按兩次確認，刪掉未使用的廠商');
await page.locator('details:has(summary:text-is("廠商")) .chip:text-is("新廠商")').click();
await page.locator('details:has(summary:text-is("廠商")) .inline-add input[type=text]').first().fill('新廠商改名');
await page.locator('details:has(summary:text-is("廠商")) button:has-text("儲存")').click(); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.vendors.some(v => v.name === '新廠商改名'))), '改名');
// 工項：把新廠商掛到油漆
await page.locator('summary:has-text("工項、缺失內容")').click();
await page.locator('details:has(summary:has-text("工項、缺失內容")) .chip:text-is("10油漆")').click();
await page.locator('details:has(summary:has-text("工項、缺失內容")) .chips button.chip:text-is("新廠商改名")').click(); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.category_vendors.filter(x => x.category_id === 2).length)) === 2, '工項可加掛第二家預設廠商');
// 排序：把前陽台排序改 -1，填寫頁應排第一
await page.evaluate(() => { document.querySelectorAll('#admin-root details').forEach(d => { if (d.querySelector('summary').textContent.includes('空間別')) d.open = true; }); });
await page.locator('details:has(summary:has-text("空間別")) .chip:has-text("前陽台")').click();
await page.locator('details:has(summary:has-text("空間別")) input[type=number]').first().fill('-1');
await page.locator('details:has(summary:has-text("空間別")) button:has-text("儲存")').first().click(); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.spaces.find(s => s.name === '前陽台').sort)) === -1, '排序數字可改');
// 樓層
await page.evaluate(() => { document.querySelectorAll('#admin-root details').forEach(d => { if (d.querySelector('summary').textContent.includes('棟別與樓層')) d.open = true; }); });
await page.locator('details:has(summary:has-text("棟別與樓層")) .chip:text-is("A棟")').click();
await page.locator('details:has(summary:has-text("棟別與樓層")) input[type=text]').nth(2).fill('2F、3F、4F、5F');
await page.locator('details:has(summary:has-text("棟別與樓層")) button:has-text("儲存樓層")').click(); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.buildings[0].floors.join())) === '2F,3F,4F,5F', '樓層可改');
// 停用廠商後填寫不再出現
await page.click('#t-pick'); await page.waitForTimeout(200);

// ---- 登出 / 一般使用者 ----
await page.click('#userbtn'); await page.click('#userbtn'); await page.waitForSelector('#login:not([hidden])');
ok(true, '登出回到登入畫面');
await page.fill('#l-email', 'staff@x.com'); await page.fill('#l-pass', 'pw'); await page.click('#l-go'); await page.waitForSelector('#app:not([hidden])');
ok(await page.locator('#t-admin').isHidden(), '一般使用者看不到管理頁籤');

console.log(results.join('\n'));
console.log('\nJS errors:', errors.length ? errors : 'none');
await page.screenshot({ path: '/tmp/smoke-final.png' });
await browser.close();
process.exit(fail.length || errors.length ? 1 : 0);
