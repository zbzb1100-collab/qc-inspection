-- 16_空間別分區：空間別改用「專有戶／公設」來分，不再跟檢查類型綁在一起
-- 現有空間別依「哪些戶別／使用空間勾了它」自動判斷：只有專有戶用→專有戶；只有公設用→公設；兩邊都用或都沒用→兩區都出現。
-- 需先執行過 12_專有公設.sql。貼到 Supabase SQL Editor 按 Run，可重複執行（只會處理還沒設定的）。

alter table public.spaces add column if not exists zone_ids bigint[] not null default '{}';   -- 空的＝每區都出現
update public.spaces s set zone_ids = z.ids
from (
  select us.space_id, array_agg(distinct coalesce(b.zone_id, (select id from public.zones order by sort, id limit 1))) as ids
  from public.unit_spaces us join public.units u on u.id = us.unit_id join public.buildings b on b.id = u.building_id
  group by us.space_id
) z
where s.id = z.space_id and s.zone_ids = '{}' and array_length(z.ids, 1) = 1;
