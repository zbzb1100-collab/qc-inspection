// 照片標註：拍完先跳標註畫面，圈起來後按完成，照片上有紅圈；不標註＝原照片；還沒存的照片可以再標註
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
await page.addInitScript(() => { window.__keepAnnotate = true; });
await page.addInitScript(() => {
  const T = window.__db.T; T.inspect_types[0].need_sign = true;
  const base = { site_id: 1, inspect_type_id: 1, building_id: 1, floor: '8F', unit_id: 1, space_id: 2, category_id: 1, item_id: 1, fix_vendor_id: 1, resp_vendor_id: 1,
    created_by: 'u-staff', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', signed_name: null, signed_date: null };
  T.defects.push({ id: 1, ...base, status: 'todo', description: 'a' }, { id: 2, ...base, status: 'signing', description: 'b' }, { id: 3, ...base, status: 'signing', description: 'c' });
  T.defect_photos.push({ id: 1, defect_id: 1, kind: 'after', path: '1/a.jpg', created_by: 'u-staff' });
});
await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file://')) return r.continue(); if (u.includes('xlsx') || u.includes('supabase')) return r.fulfill({ contentType: 'application/javascript', body: '' }); return r.fulfill({ contentType: 'text/css', body: '' }); });
await page.goto('file://' + root + 'index.html');
await page.fill('#l-email', 'staff@x.com'); await page.fill('#l-pass', 'pw'); await page.click('#l-go');
await page.waitForSelector('#app:not([hidden])');
await page.click('#floor .chip:has-text("8F")'); await page.click('#units button:has-text("A1")'); await page.click('#go');
await page.waitForSelector('#dlist .item');

const { PNG } = { PNG: null };
// 產生一張 200x150 的灰色 PNG 當作現場照片
const photo = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 200; c.height = 150; const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 200, 150);
  return await new Promise(r => c.toBlob(b => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(b); }, 'image/png')); });
const buf = Buffer.from(photo, 'base64');
await page.locator('#dlist .item').nth(0).click(); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(300);
const n0 = await page.locator('#sh-photos .ph').count();
await page.locator('#sh-photos input[type=file]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: buf });
await page.waitForSelector('.an'); ok(true, '拍完照先跳出標註畫面');
ok((await page.locator('.an-tool.on').textContent()).includes('圈'), '預設是畫圈');
const cb = await page.locator('.an canvas').boundingBox();
await page.mouse.move(cb.x + cb.width * 0.3, cb.y + cb.height * 0.3); await page.mouse.down();
await page.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.6, { steps: 5 }); await page.mouse.up();
await page.click('.an .pv-close'); await page.waitForSelector('.an', { state: 'detached' }); await page.waitForTimeout(200);
ok(await page.locator('#sh-photos .ph').count() === n0 + 1, '標註完照片放進缺失');
const red = async () => page.evaluate(async () => { const im = [...document.querySelectorAll('#sh-photos .ph img')].pop(); await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] < 90) n++; return n; });
ok(await red() > 50, '照片上有紅色圈');
// 第二張：不標註
await page.locator('#sh-photos input[type=file]').setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: buf });
await page.waitForSelector('.an'); await page.click('.an .an-skip'); await page.waitForTimeout(200);
ok(await page.locator('#sh-photos .ph').count() === n0 + 2 && await red() === 0, '按不標註＝原照片');
// 還沒存的照片可以再標註
await page.locator('#sh-photos .ph img').last().click(); await page.waitForSelector('#viewer:not([hidden])');
ok(await page.locator('#viewer-edit').isVisible(), '還沒存的照片有「標註」按鈕');
await page.click('#viewer-edit'); await page.waitForSelector('.an');
const cb2 = await page.locator('.an canvas').boundingBox(); await page.mouse.click(cb2.x + cb2.width / 2, cb2.y + cb2.height / 2);
await page.click('.an .pv-close'); await page.waitForSelector('.an', { state: 'detached' }); await page.waitForTimeout(200);
ok(await red() > 50, '再標註後照片換成有圈的');
await page.click('#sh-save'); await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__db.T.defect_photos.filter(p => p.defect_id === 1 && p.kind === 'before').length) === 2, '儲存後兩張都上傳');
await page.locator('#dlist .item').nth(0).click(); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(300);
await page.locator('#sh-photos .ph img').first().click(); await page.waitForSelector('#viewer:not([hidden])');
ok(await page.locator('#viewer-edit').isHidden(), '已上傳的照片沒有標註按鈕');
ok(errors.length === 0, 'JS 錯誤：' + errors.join('|'));
console.log(results.join('\n')); await browser.close(); process.exit(fail.length ? 1 : 0);
