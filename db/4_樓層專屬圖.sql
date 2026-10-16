-- 品質查驗系統：允許每一個樓層各自有專屬平面圖（原本只能「標準層」或「2F」）。貼到 Supabase SQL Editor 按 Run，可重複執行。
alter table public.plans drop constraint if exists plans_variant_check;
