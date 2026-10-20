-- 14_分區樓層：同一棟在專有戶、公設可以有不同的樓層（例：A棟 專有戶 2F~19F，公設 1F~R1F）
-- 需先執行過 13_棟別多區.sql。貼到 Supabase SQL Editor 按 Run，可重複執行。

alter table public.buildings add column if not exists zone_floors jsonb not null default '{}';   -- {"區分id": ["2F","3F",…]}，沒設定的區用 floors
