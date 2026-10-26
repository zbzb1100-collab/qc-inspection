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
  if (u.includes('exceljs')) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync('/tmp/claude-0/xl/node_modules/exceljs/dist/exceljs.min.js', 'utf8') });
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
await page.click('#t-admin'); await page.waitForSelector('#adm-tabs');
await page.click('#adm-tabs button[data-tab=plan]');
await page.locator('#admin-root input[type=file][multiple]').first().setInputFiles([
  { name: 'A1.png', mimeType: 'image/png', buffer: png() }, { name: 'A1-2F.png', mimeType: 'image/png', buffer: png() },
  { name: 'ZZ9.png', mimeType: 'image/png', buffer: png() }, { name: 'readme.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
await page.waitForTimeout(500);
const plans = await page.evaluate(() => window.__db.T.plans.map(p => p.unit_id + ':' + p.variant));
ok(plans.sort().join() === '1:2F,1:標準層', '批次匯入依檔名對到 A1 標準層與 2F，其餘略過：' + plans);
// 空間標記
await page.locator('button:has-text("標記空間位置")').first().click(); await page.waitForSelector('.plan .mark, #admin-root .plan');
await page.locator('#admin-root .chip:has-text("客餐廳")').click();
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

// ---- 平面圖全螢幕放大 ----
await page.click('#plan .plan-zoom'); await page.waitForSelector('.pv');
ok((await page.locator('.pv .pin').count()) === 1 && (await page.locator('.pv .pin').evaluate(e => getComputedStyle(e).pointerEvents)) === 'none', '放大畫面顯示舊編號，但點不到');
await page.click('.pv .pv-btn:has-text("＋")'); await page.click('.pv-close');
ok(!(await page.locator('.pv').count()), '關閉放大畫面');
await page.click('#plan .plan-zoom'); await page.waitForSelector('.pv'); await page.evaluate(() => history.back()); await page.waitForTimeout(300);
ok(!(await page.locator('.pv').count()) && await page.locator('#s-fill').isVisible(), '手機返回鍵關掉放大畫面，還在填寫頁');
await page.click('#plan .plan-zoom'); await page.waitForSelector('.pv'); await page.waitForTimeout(100);
{ const v = await page.locator('.pv-vp').boundingBox(); const ib = await page.locator('.pv-stage img').boundingBox();
  await page.mouse.click(ib.x + ib.width * 0.7, ib.y + ib.height * 0.3); }
await page.waitForSelector('#sheet:not([hidden])');
ok(!(await page.locator('.pv').count()), '放大畫面點一下就開新增表單');
await page.click('#sh-cancel'); await page.waitForTimeout(200);
await page.click('#dlist .item'); await page.waitForSelector('#sheet:not([hidden])'); await page.click('#sh-place');
await page.waitForSelector('.pv'); ok((await page.textContent('.pv-hint')).includes('標出'), '重新標位置直接開放大畫面');
{ const ib = await page.locator('.pv-stage img').boundingBox(); await page.mouse.click(ib.x + ib.width * 0.2, ib.y + ib.height * 0.8); }
await page.waitForTimeout(300);
{ const x = await page.evaluate(() => window.__db.T.defects[0]); ok(Math.abs(x.x - 0.2) < 0.03 && Math.abs(x.y - 0.8) < 0.03 && !(await page.locator('.pv').count()), '放大畫面標的新位置已儲存'); }
await page.evaluate(() => { const d = window.__db.T.defects[0]; d.x = 0.4; d.y = 0.6; }); await page.click('#back'); await page.click('#go'); await page.waitForTimeout(300);
await page.click('#dlist .item'); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(200);
await page.click('#sh-mini'); await page.waitForSelector('.pv'); await page.click('.pv-move');
ok((await page.textContent('.pv-hint')).includes('新的位置'), '缺失小圖放大後可以按改位置');
{ const ib = await page.locator('.pv-stage img').boundingBox(); await page.mouse.click(ib.x + ib.width * 0.5, ib.y + ib.height * 0.5); }
await page.waitForTimeout(300);
{ const x = window => 0; const d = await page.evaluate(() => window.__db.T.defects[0]); ok(d.x !== 0.2 && Math.abs(d.y - 0.8) > 0.05 && !(await page.locator('.pv').count()) && await page.locator('#sheet').isVisible(), '改位置已儲存，表單還開著'); }
await page.click('#sh-back'); await page.waitForTimeout(300);
await page.evaluate(() => { const d = window.__db.T.defects[0]; d.x = 0.4; d.y = 0.6; }); await page.click('#back'); await page.click('#go'); await page.waitForTimeout(300);

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
ok(d.status === 'fixed' && d.close_type === '不修' && d.close_reason === '屋主同意現況', '不修不直接結案：變成不修待確認');
ok((await page.locator('#dlist .item').nth(1).textContent()).includes('不修待確認'), '清單顯示「不修待確認」');
await page.locator('#dlist .item').nth(1).click(); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(150);
ok((await page.textContent('#sh-pass')).includes('確認不修') && await page.locator('#sh-nofix').isHidden() && await page.locator('#sh-reopen').isVisible(), '待確認：有②確認不修、退回，沒有再按不修');
await page.click('#sh-pass'); await page.waitForSelector('#sheet', { state: 'hidden' });
d = await page.evaluate(() => window.__db.T.defects[1]);
ok(d.status === 'closed' && d.close_type === '不修' && d.close_reason === '屋主同意現況', '驗收確認後不修結案並保留原因');

// ---- 報表 ----
await page.click('#t-report'); await page.waitForTimeout(400);
ok((await page.textContent('#st-all')) === '2' && (await page.textContent('#st-closed')) === '2', '報表統計');
await page.click('.stat [data-st="todo"]'); await page.waitForTimeout(100);
ok((await page.textContent('#rtable')).includes('沒有符合') && (await page.textContent('#st-all')) === '2', '點「待修」方塊：只列待修，統計數字不變');
await page.click('.stat [data-st="closed"]'); await page.waitForTimeout(100);
ok(await page.locator('#rtable tr').count() === 2 && (await page.textContent('#rnote')).includes('只顯示「結案」'), '點「結案」方塊：列出結案');
await page.click('.stat [data-st="closed"]'); await page.waitForTimeout(100);
ok(await page.locator('.stat > div.on').count() === 1 && (await page.textContent('#rnote')) === '', '再點一次回到全部');
const pickF = async (k, v) => { await page.click(`#f-${k} .ms-btn`); await page.check(`#f-${k} input[value="${v}"]`); await page.click(`#f-${k} .ms-btn`); };
await pickF('cat', '1'); await page.click('#f-go'); await page.waitForTimeout(300);
ok((await page.textContent('#st-all')) === '1', '工項篩選');
await page.click('#f-clear'); await page.waitForTimeout(300);
await pickF('fixv', '1'); await page.click('#f-go'); await page.waitForTimeout(300);
ok((await page.textContent('#st-all')) === '1', '修繕廠商篩選');
const other = await page.evaluate(() => window.__db.T.defects.map(d => d.fix_vendor_id).find(v => v !== 1));
await pickF('fixv', String(other)); await page.click('#f-go'); await page.waitForTimeout(300);
ok((await page.textContent('#st-all')) === '2' && (await page.textContent('#f-fixv .ms-btn')).includes('、'), '修繕廠商複選兩家');
await pickF('status', 'todo'); await page.click('#f-go'); await page.waitForTimeout(300);
ok((await page.textContent('#st-all')) === '0', '多個條件之間是「且」');
await page.click('#f-clear'); await page.waitForTimeout(300);
ok((await page.textContent('#f-fixv .ms-btn')) === '全部修繕廠商', '清除條件後回到全部');
await pickF('respv', '3'); await page.click('#f-go'); await page.waitForTimeout(300);
ok((await page.textContent('#st-all')) === '2', '責任廠商篩選');
{ const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#f-export')]); ok(!!dl, '匯出 Excel 有下載'); }

// ---- 管理：清單（分頁＋表格）----
await page.click('#t-admin'); await page.click('#adm-tabs button[data-tab=vendor]');
await page.locator('#sec-vendor .lt-add input').fill('新廠商、第二廠商');
await page.locator('#sec-vendor .lt-add button').click(); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.vendors.length)) === 5, '一次新增多個廠商');
await page.locator('#sec-vendor tr[data-name="第二廠商"] button:text-is("更多")').click();
await page.locator('#sec-vendor button:has-text("刪除「第二廠商」")').click();
await page.locator('#sec-vendor button:has-text("再按一次確定刪除")').click(); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.vendors.length)) === 4, '刪除需按兩次確認，刪掉未使用的廠商');
await page.locator('#sec-vendor tr[data-name="新廠商"] td.nm input').fill('新廠商改名');
await page.locator('#sec-vendor tr[data-name="新廠商"] td.nm input').press('Enter'); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.vendors.some(v => v.name === '新廠商改名'))), '表格裡直接改名');
// 工項：把新廠商掛到油漆
await page.click('#adm-tabs button[data-tab=cat]');
await page.locator('#sec-cat tr[data-name="10油漆"] button:has-text("缺失內容")').click();
await page.locator('#sec-cat .chips button.chip:text-is("新廠商改名")').click(); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.category_vendors.filter(x => x.category_id === 2).length)) === 2, '工項可加掛第二家預設廠商');
ok((await page.locator('#sec-cat tr[data-name="10油漆"]').textContent()).includes('新廠商改名'), '工項列直接看得到預設廠商');
// 排序：前陽台按兩次 ↑ 排到第一
await page.click('#adm-tabs button[data-tab=space]');
await page.locator('#sec-space tr[data-name="前陽台"] button[title="往前移"]').click(); await page.waitForTimeout(300);
await page.locator('#sec-space tr[data-name="前陽台"] button[title="往前移"]').click(); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.spaces.slice().sort((a, b) => a.sort - b.sort)[0].name)) === '前陽台', '↑↓ 排序，不用填數字');
{ const n = await page.locator('#sec-space tbody tr[data-name] td.no input').count();
  await page.locator('#sec-space tr[data-name="前陽台"] td.no input').fill(String(n)); await page.locator('#sec-space tr[data-name="前陽台"] td.no input').press('Enter'); await page.waitForTimeout(300);
  const order = await page.evaluate(() => window.__db.T.spaces.filter(s => s.active !== false).sort((a, b) => a.sort - b.sort).map(s => s.name));
  ok(order[order.length - 1] === '前陽台', '打數字直接移到最後一個：' + order.join());
  ok((await page.locator('#sec-space tr[data-name="前陽台"] td.no input').inputValue()) === String(n), '重畫後序號跟著變'); }
// 樓層：可寫範圍
await page.click('#adm-tabs button[data-tab=struct]');
ok((await page.locator('#sec-bld tr[data-name="A棟"] .fl-cell input').inputValue()) === '2F、3F、8F', '樓層顯示');
await page.locator('#sec-bld tr[data-name="A棟"] .fl-cell input').fill('2F~5F');
await page.locator('#sec-bld tr[data-name="A棟"] .fl-cell input').press('Enter'); await page.waitForTimeout(300);
ok((await page.evaluate(() => window.__db.T.buildings[0].floors.join())) === '2F,3F,4F,5F', '樓層可改（範圍自動展開）');
ok((await page.locator('#sec-bld tr[data-name="A棟"] .fl-cell input').inputValue()) === '2F~5F', '連續樓層縮成範圍顯示');
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
