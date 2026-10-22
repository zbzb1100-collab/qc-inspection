-- 17_缺失內容分區：同一個工項，專有戶和公設底下可以有不同的缺失內容
-- 現有缺失內容先維持「兩區都出現」（空的＝每區都有），到後台「工項與缺失」切到專有戶或公設，把不用的那一區取消勾選即可。
-- 需先執行過 12_專有公設.sql。貼到 Supabase SQL Editor 按 Run，可重複執行。
alter table public.items add column if not exists zone_ids bigint[] not null default '{}';   -- 空的＝每區都出現
