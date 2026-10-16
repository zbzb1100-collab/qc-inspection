// Excel 匯出／匯入測試：用真的 SheetJS，資料庫用 dev/mock-supabase.js
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const XLSX = createRequire(process.env.XLSX_DIR || '/tmp/claude-0/xl/')('xlsx');
const root = new URL('..', import.meta.url).pathname;
const mock = fs.readFileSync(root + 'dev/mock-supabase.js', 'utf8');
const xlsxSrc = fs.readFileSync(process.env.XLSX_DIR ? process.env.XLSX_DIR + 'node_modules/xlsx/dist/xlsx.full.min.js' : '/tmp/claude-0/xl/node_modules/xlsx/dist/xlsx.full.min.js', 'utf8');
const results = []; const fail = [];
const ok = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail.push(m); };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage(); const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(mock);
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file://')) return r.continue();
  if (u.includes('supabase')) return r.fulfill({ contentType: 'application/javascript', body: '' });
  if (u.includes('xlsx')) return r.fulfill({ contentType: 'application/javascript', body: xlsxSrc });
  return r.fulfill({ contentType: 'text/css', body: '' });
});
await page.goto('file://' + root + 'index.html');
await page.fill('#l-email', 'boss@x.com'); await page.fill('#l-pass', 'pw'); await page.click('#l-go');
await page.waitForSelector('#app:not([hidden])');
await page.click('#t-admin'); await page.waitForSelector('#admin-root details');
await page.evaluate(() => document.querySelectorAll('#admin-root details').forEach(d => { if (d.querySelector('summary').textContent.includes('Excel')) d.open = true; }));

// 匯出
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button:has-text("匯出目前設定")').click()]);
const p1 = '/tmp/claude-0/xl/exp.xlsx'; await dl.saveAs(p1);
const wb1 = XLSX.readFile(p1);
ok(wb1.SheetNames.join() === '說明,棟別樓層,戶別,空間別,工項,缺失內容,廠商,修繕方式,檢查類型', '匯出工作表：' + wb1.SheetNames);
const bl = XLSX.utils.sheet_to_json(wb1.Sheets['棟別樓層']);
ok(bl.length === 2 && bl[0]['樓層'] === '2F、3F、8F', '匯出棟別與樓層');
const cat = XLSX.utils.sheet_to_json(wb1.Sheets['工項']);
ok(cat[0]['預設廠商'] === '太隆興業、健暉工程行', '匯出工項預設廠商');

// 空匯入（原檔直接匯回）→ 應該沒有變動
await page.locator('#xl-file').setInputFiles(p1); await page.waitForTimeout(300);
ok((await page.textContent('#xl-out')).includes('沒有需要新增或修改'), '原檔匯回＝沒有變動');

// 改過的檔：新增棟別/戶別/空間/工項/缺失/廠商，修改 A棟樓層與排序，並放入錯誤列
const wb = XLSX.readFile(p1);
const put = (name, rows) => { const ws = wb.Sheets[name]; XLSX.utils.sheet_add_aoa(ws, rows, { origin: -1 }); };
put('棟別樓層', [['G棟', '2F、3F、4F', '', '']]);
wb.Sheets['棟別樓層'].B2.v = '2F、3F、8F、9F'; wb.Sheets['棟別樓層'].C2.v = 5;
put('戶別', [['G棟', 'G1', '', ''], ['G棟', 'G2', '', ''], ['A棟', 'A1', '', ''], ['X棟', 'X1', '', ''], ['A棟', 'A3', '', '停用']]);
put('空間別', [['交屋檢查', '書房', 'H', ''], ['驗收', '陽台', '', '']]);
put('工項', [['20木地板', '新廠商甲、太隆興業', '', ''], ['01防水', '捷挺裝潢', '', '']]);
put('缺失內容', [['20木地板', '踢腳板鬆脫', '', ''], ['99不存在', 'x', '', '']]);
put('修繕方式', [['重做', '', '']]);
put('檢查類型', [['驗收', '', '']]);
const p2 = '/tmp/claude-0/xl/in.xlsx'; XLSX.writeFile(wb, p2);
await page.locator('#xl-file').setInputFiles(p2); await page.waitForSelector('#xl-go');
const prev = await page.textContent('#xl-out');
ok(prev.includes('找不到棟別「X棟」') && prev.includes('找不到工項「99不存在」'), '預覽列出錯誤列（找不到棟別／工項）');
ok(!prev.includes('找不到檢查類型'), '同檔新建的檢查類型「驗收」可被空間別使用');
await page.click('#xl-go'); await page.waitForTimeout(800);
const db = await page.evaluate(() => window.__db.T);
const g = db.buildings.find(b => b.name === 'G棟');
ok(g && g.floors.join() === '2F,3F,4F' && g.site_id === 1, '新增 G棟與樓層');
ok(db.buildings.find(b => b.name === 'A棟').floors.join() === '2F,3F,8F,9F' && db.buildings.find(b => b.name === 'A棟').sort === 5, '修改 A棟 樓層與排序');
ok(db.units.filter(u => u.building_id === g.id).map(u => u.code).join() === 'G1,G2', '新增 G棟 G1,G2');
ok(db.units.filter(u => u.code === 'A1').length === 1, '既有戶別不重複新增');
const a3 = db.units.find(u => u.code === 'A3'); ok(a3 && a3.active === false, '新增 A3 並停用');
ok(!db.units.some(u => u.code === 'X1'), '不存在的棟別那列略過');
const ty = db.inspect_types.find(t => t.name === '驗收'); ok(!!ty, '新增檢查類型 驗收');
ok(db.spaces.some(s => s.name === '陽台' && s.inspect_type_id === ty.id) && db.spaces.some(s => s.name === '書房' && s.code === 'H'), '新增空間別（含同檔新建的類型）');
const nc = db.categories.find(c => c.name === '20木地板'); ok(!!nc, '新增工項');
ok(db.items.some(i => i.name === '踢腳板鬆脫' && i.category_id === nc.id), '新增缺失內容掛在新工項下');
ok(db.vendors.some(v => v.name === '新廠商甲'), '預設廠商中不存在的自動新增');
const cv = db.category_vendors.filter(x => x.category_id === nc.id).map(x => db.vendors.find(v => v.id === x.vendor_id).name);
ok(cv.join() === '新廠商甲,太隆興業', '工項預設廠商對應：' + cv);
ok(db.category_vendors.filter(x => x.category_id === 1).length === 3, '01防水 既有對應保留並加上捷挺裝潢');
ok(db.repair_methods.some(r => r.name === '重做'), '新增修繕方式');
// 再匯一次＝冪等
await page.locator('#xl-file').setInputFiles(p2); await page.waitForTimeout(400);
ok((await page.textContent('#xl-out')).includes('新增 0') , '同檔再匯入不會重複新增');
const before = JSON.stringify(await page.evaluate(() => window.__db.T.units.length));
// 空白範本
const [d2] = await Promise.all([page.waitForEvent('download'), page.locator('button:has-text("下載空白範本")').click()]);
await d2.saveAs('/tmp/claude-0/xl/tpl.xlsx'); const t = XLSX.readFile('/tmp/claude-0/xl/tpl.xlsx');
ok(XLSX.utils.sheet_to_json(t.Sheets['戶別'], { header: 1 })[0].join() === '棟別,戶別,排序,狀態', '空白範本有欄位名稱');

// ---- 完整同步 ----
await page.evaluate(() => { const T = window.__db.T; T.defects.push({ id: 1, site_id: 1, inspect_type_id: 1, building_id: 1, floor: '3F', unit_id: 1, category_id: 1, item_id: 1, status: 'todo' }); });
await page.click('#t-pick'); await page.click('#t-admin'); await page.waitForSelector('#xl-file');
await page.evaluate(() => document.querySelectorAll('#admin-root details').forEach(d => { if (d.querySelector('summary').textContent.includes('Excel')) d.open = true; }));
const [d3] = await Promise.all([page.waitForEvent('download'), page.locator('button:has-text("匯出目前設定")').click()]);
await d3.saveAs('/tmp/claude-0/xl/exp2.xlsx');
const w3 = XLSX.readFile('/tmp/claude-0/xl/exp2.xlsx');
const drop = (name, pred) => { const rows = XLSX.utils.sheet_to_json(w3.Sheets[name], { header: 1 }); w3.Sheets[name] = XLSX.utils.aoa_to_sheet(rows.filter((r, i) => i === 0 || !pred(r))); };
drop('戶別', r => ['A1', 'A2', 'G1'].includes(r[1]));        // A1 有缺失紀錄 → 停用；A2、G1 沒用過 → 刪除
drop('缺失內容', r => r[1] === '踢腳板鬆脫' || r[1] === '有漏水或滲水情況'); // 後者有紀錄 → 停用
XLSX.writeFile(w3, '/tmp/claude-0/xl/sync.xlsx');
await page.locator('#xl-file').setInputFiles('/tmp/claude-0/xl/sync.xlsx'); await page.waitForTimeout(300);
ok((await page.textContent('#xl-out')).includes('新增 0'), '未勾完整同步時不動資料（只預覽新增/修改）');
await page.locator('#xl-sync').check(); await page.waitForTimeout(400);
const pv = await page.textContent('#xl-out');
ok(pv.includes('A棟 A1（停用）') && pv.includes('A棟 A2（刪除）'), '預覽：有紀錄的戶別標停用、沒用過的標刪除');
const [bk] = await Promise.all([page.waitForEvent('download'), page.click('#xl-go')]);
ok(!!bk, '同步前自動下載備份');
await page.waitForTimeout(800);
const db2 = await page.evaluate(() => window.__db.T);
ok(!db2.units.some(u => u.code === 'A2' || u.code === 'G1'), '沒用過的戶別已刪除');
const a1 = db2.units.find(u => u.code === 'A1'); ok(a1 && a1.active === false, '有缺失紀錄的戶別改為停用');
ok(!db2.items.some(i => i.name === '踢腳板鬆脫') && db2.items.find(i => i.name === '有漏水或滲水情況').active === false, '缺失內容：沒用過刪除、用過停用');
ok(db2.units.some(u => u.code === 'S1' && u.active !== false), '檔案裡仍有的項目不受影響');
ok(db2.defects.length === 1, '缺失紀錄完全保留');
ok(errors.length === 0, 'JS 錯誤：' + errors.join('|'));
console.log(results.join('\n')); await browser.close(); process.exit(fail.length ? 1 : 0);
