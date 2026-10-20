-- 13_棟別多區：同一棟可以同時屬於專有戶和公設（例：A棟的戶別在專有戶、A棟的梯廳在公設）
-- 戶別／使用空間各自記錄屬於哪一區。需先執行過 12_專有公設.sql。貼到 Supabase SQL Editor 按 Run，可重複執行。

alter table public.buildings add column if not exists zone_ids bigint[] not null default '{}';   -- 這棟出現在哪幾區
update public.buildings set zone_ids = array[zone_id] where zone_ids = '{}' and zone_id is not null;
alter table public.units add column if not exists zone_id bigint references public.zones(id);   -- 這戶／使用空間屬於哪一區
update public.units u set zone_id = b.zone_id from public.buildings b where u.building_id = b.id and u.zone_id is null;
