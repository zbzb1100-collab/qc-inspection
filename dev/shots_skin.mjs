// 各外觀截圖：node dev/shots_skin.mjs 輸出資料夾
import { createRequire } from 'module'; import fs from 'fs';
const require = createRequire('/opt/node22/lib/node_modules/'); const { chromium } = require('playwright');
const root = new URL('..', import.meta.url).pathname; const mock = fs.readFileSync(root + 'dev/mock-supabase.js', 'utf8');
const out = process.argv[2] || '/tmp'; const plan = fs.readFileSync('/mnt/project-files/02_平面圖/A1.png');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }); const errors = [];
for (const skin of ['pro', 'soft', 'm3', 'tech']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(skin + ': ' + e.message));
  await page.addInitScript(`try{localStorage.setItem('qc-skin','${skin}')}catch(e){}`); await page.addInitScript(mock);
  await page.route('**/*', r => { const u = r.request().url(); if (u.startsWith('file://')) return r.continue(); if (u.includes('xlsx') || u.includes('supabase')) return r.fulfill({ contentType: 'application/javascript', body: '' }); return r.fulfill({ contentType: 'text/css', body: '' }); });
  await page.goto('file://' + root + 'index.html');
  await page.screenshot({ path: `${out}/${skin}-1login.png` });
  await page.fill('#l-email', 'boss@x.com'); await page.fill('#l-pass', 'pw'); await page.click('#l-go'); await page.waitForSelector('#app:not([hidden])');
  await page.click('#floor .chip:has-text("8F")'); await page.click('#units button:has-text("A1")');
  await page.screenshot({ path: `${out}/${skin}-2pick.png` });
  await page.click('#t-admin'); await page.locator('summary:has-text("平面圖")').click();
  await page.locator('#admin-root input[type=file][multiple]').first().setInputFiles([{ name: 'A1.png', mimeType: 'image/png', buffer: plan }]); await page.waitForTimeout(500);
  await page.click('#t-pick'); await page.click('#go'); await page.waitForSelector('#plan:not([hidden])'); await page.waitForTimeout(400);
  await page.evaluate(d => { document.getElementById('planimg').src = d; }, 'data:image/png;base64,' + plan.toString('base64')); await page.waitForTimeout(300);
  for (const [x, y, item] of [[0.35, 0.5, 0], [0.6, 0.3, 1]]) {
    const pb = await page.locator('#planimg').boundingBox(); await page.locator('#planimg').click({ position: { x: pb.width * x, y: pb.height * y } });
    await page.waitForSelector('#sheet:not([hidden])'); await page.click('#sh-space .chip >> nth=0'); await page.click('#sh-cat .chip >> nth=' + item); await page.click('#sh-item .chip >> nth=0');
    if (!item) await page.screenshot({ path: `${out}/${skin}-3sheet.png` });
    await page.click('#sh-save'); await page.waitForSelector('#sheet', { state: 'hidden' }); await page.waitForTimeout(200);
  }
  await page.screenshot({ path: `${out}/${skin}-4fill.png` });
  await page.click('#t-report'); await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${skin}-5report.png` });
  await page.click('#skinbtn'); await page.screenshot({ path: `${out}/${skin}-6picker.png` });
  await ctx.close();
}
console.log(errors.length ? errors.join('\n') : 'no page errors'); await browser.close();
