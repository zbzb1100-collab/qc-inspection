# 品質查驗系統

工地完工品質檢查：手機填寫缺失（平面圖點位、照片）、修繕與複驗流程、報表匯出、清單自行維護。

- 前端：純 HTML/JS，放 GitHub Pages（本 repo）。
- 後端：Supabase（資料庫、登入、照片儲存）。連線設定在 `config.js`（公開金鑰，安全靠資料庫權限規則）。
- 資料庫建表：`db/schema.sql`（在 Supabase SQL Editor 執行一次）。初始清單另見專案共享資料夾 `03_系統/2_初始清單.sql`。

## 開發

`dev/` 是測試用：`node dev/smoke.mjs` 以模擬資料庫在無頭瀏覽器跑整套流程（需 Playwright）。正式網頁不會載入 `dev/`。
