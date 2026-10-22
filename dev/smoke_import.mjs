// 缺失批次匯入測試：zip（Excel＋照片）→ 預覽 → 補選 → 匯入
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/');
const { chromium } = require('playwright');
const XL = createRequire('/tmp/claude-0/xl/'); const XLSX = XL('xlsx'); const JSZip = XL('jszip');
const root = new URL('..', import.meta.url).pathname;
const mock = fs.readFileSync(root + 'dev/mock-supabase.js', 'utf8');
const xlsxSrc = fs.readFileSync('/tmp/claude-0/xl/node_modules/xlsx/dist/xlsx.full.min.js', 'utf8');
const zipSrc = fs.readFileSync('/tmp/claude-0/xl/node_modules/jszip/dist/jszip.min.js', 'utf8');
const results = []; const fail = [];
const ok = (c, m) => { results.push((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail.push(m); };

// 測試檔：3 列＝可直接匯入、工項對不到、戶別對不到
const H = ['棟別', '樓層', '戶別', '檢查類型', '空間', '工項', '缺失內容', '修繕方式', '修繕廠商', '責任廠商', '缺失說明', '照片', '報告編號', '對應備註'];
const ws = XLSX.utils.aoa_to_sheet([H,
  ['A棟', '8F', 'A1', '交屋檢查', '客餐廳', '01防水', '有漏水或滲水情況', '', '', '', '窗框滲水', 'L-1.jpg、L-2.jpg', 'L-1', ''],
  ['A棟', '8f', 'A1', '交屋檢查', '主臥', '99不存在', '亂寫', '', '', '', '油煙機異音', 'K-2.jpg', 'K-2', '對不到'],
  ['A棟', '8F', 'Z9', '交屋檢查', '客餐廳', '01防水', '有漏水或滲水情況', '', '', '', '戶別錯', '', '', '']]);
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '缺失匯入');
const exceljsSrc = fs.readFileSync('/tmp/claude-0/xl/node_modules/exceljs/dist/exceljs.min.js', 'utf8');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
const zip = new JSZip(); zip.file('報告/缺失匯入.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
['L-1', 'L-2', 'K-2'].forEach(n => zip.file('報告/照片/' + n + '.jpg', png));
const zp = '/tmp/claude-0/xl/import_test.zip'; fs.writeFileSync(zp, await zip.generateAsync({ type: 'nodebuffer' }));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })).newPage(); const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(mock);
await page.route('**/*', r => {
  const u = r.request().url();
  if (u.startsWith('file://')) return r.continue();
  if (u.includes('supabase')) return r.fulfill({ contentType: 'application/javascript', body: '' });
  if (u.includes('exceljs')) return r.fulfill({ contentType: 'application/javascript', body: exceljsSrc });
  if (u.includes('jszip')) return r.fulfill({ contentType: 'application/javascript', body: zipSrc });
  if (u.includes('xlsx')) return r.fulfill({ contentType: 'application/javascript', body: xlsxSrc });
  return r.fulfill({ contentType: 'text/css', body: '' });
});
await page.goto('file://' + root + 'index.html');
await page.fill('#l-email', 'boss@x.com'); await page.fill('#l-pass', 'pw'); await page.click('#l-go');
await page.waitForSelector('#app:not([hidden])');
await page.click('#t-admin'); await page.waitForSelector('#adm-tabs'); await page.click('#adm-tabs button[data-tab=batch]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('button:has-text("下載匯入範本")').click()]);
const tp = '/tmp/claude-0/xl/im_tpl.xlsx'; await dl.saveAs(tp);
ok(XLSX.utils.sheet_to_json(XLSX.readFile(tp).Sheets['缺失匯入'], { header: 1 })[0].join() === H.join(), '範本欄位');
const EX = XL('exceljs'); const twb = new EX.Workbook(); await twb.xlsx.readFile(tp); const tws = twb.getWorksheet('缺失匯入');
ok(tws.sheetProtection && tws.sheetProtection.sheet && (tws.getCell('A1').protection || {}).locked !== false && tws.getCell('A2').protection.locked === false, '標題列鎖住、資料格可填');
ok(/^'清單'!/.test(tws.getCell('A2').dataValidation.formulae[0]) && /OFFSET/.test(tws.getCell('G5').dataValidation.formulae[0]), '每格有下拉（缺失內容跟著工項）');
ok(twb.getWorksheet('清單').getCell('A2').value === 'A棟' && tws.getColumn(7).width >= 30, '清單取自系統設定、欄寬夠');

await page.setInputFiles('#im-file', zp);
await page.waitForSelector('#im-out table');
ok(/共 3 列：可匯入 1　待補選 2/.test(await page.textContent('#im-out')), '預覽統計：' + (await page.textContent('#im-out p')));
ok(await page.locator('#im-go').isDisabled(), '有待補選時不能匯入');
ok((await page.locator('#im-out tbody tr').nth(2).locator('select').nth(2).inputValue()) === '' && (await page.textContent('#im-out tbody tr:nth-child(3)')).includes('原文：A棟 8F Z9'), '戶別對不到的列給棟/樓/戶下拉重選');
ok((await page.textContent('#im-out tbody tr:nth-child(2)')).includes('原文：99不存在'), '對不到的欄位顯示原文');
// 補選：空間、工項、缺失內容
const r2 = page.locator('#im-out tbody tr').nth(1);
await r2.locator('select').nth(3).selectOption({ label: '前陽台' });
await page.locator('#im-out tbody tr').nth(1).locator('select').nth(4).selectOption({ label: '10油漆' });
await page.locator('#im-out tbody tr').nth(1).locator('select').nth(5).selectOption({ label: '牆面油漆不勻' });
await page.locator('#im-out tbody tr').nth(2).locator('select').nth(2).selectOption({ label: 'A2' });
ok(/可匯入 3　待補選 0/.test(await page.textContent('#im-out p')), '補選後可匯入 3 筆');
await page.click('#im-go');
await page.waitForSelector('#im-out .banner');
const db = await page.evaluate(() => ({ d: window.__db.T.defects, p: window.__db.T.defect_photos }));
ok(db.d.length === 3 && db.d[2].unit_id === 2 && db.d[2].floor === '8F', '新增 3 筆缺失（含重選戶別）');
const a = db.d[0], b = db.d[1];
ok(a.floor === '8F' && a.status === 'todo' && a.x == null && a.fix_vendor_id === 1 && a.resp_vendor_id === 1, '第一筆：待修、不標位置、廠商帶工項預設');
ok(a.description === '窗框滲水（報告編號 L-1）', '說明附報告編號：' + a.description);
ok(b.floor === '8F' && b.category_id === 2 && b.space_id === 3 && b.fix_vendor_id === 3, '第二筆：補選的空間/工項，廠商跟著工項');
ok(db.p.length === 3 && db.p.every(p => p.kind === 'before'), '照片 3 張，都是修繕前');
ok(errors.length === 0, 'JS 錯誤：' + errors.join('|'));
console.log(results.join('\n')); await browser.close(); process.exit(fail.length ? 1 : 0);
