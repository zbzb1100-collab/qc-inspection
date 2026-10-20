-- 15_一棟一區：改回「一棟只屬於一區」，專有戶和公設可以各有一個同名的棟（例：兩邊都有 A棟）
-- 之前勾了兩區的棟，會自動拆成兩個同名棟：原本的留在第一區；另一區的使用空間、它們的缺失、轉檔紀錄，搬到新建的同名棟；樓層用當初分區設定的。
-- 需先執行過 12_專有公設.sql。貼到 Supabase SQL Editor 按 Run，可重複執行。

-- 沒執行過 13、14 也可以直接跑
alter table public.buildings add column if not exists zone_ids bigint[] not null default '{}';
alter table public.buildings add column if not exists zone_floors jsonb not null default '{}';
alter table public.units add column if not exists zone_id bigint references public.zones(id);

alter table public.buildings drop constraint if exists buildings_site_id_name_key;
alter table public.buildings drop constraint if exists buildings_site_zone_name_key;
alter table public.buildings add constraint buildings_site_zone_name_key unique (site_id, zone_id, name);

do $$
declare b record; z bigint; nb bigint; zf text[];
begin
  for b in select * from public.buildings where coalesce(array_length(zone_ids, 1), 0) > 1 loop
    foreach z in array b.zone_ids loop
      continue when z = b.zone_id;
      select coalesce(array_agg(x), b.floors) into zf from jsonb_array_elements_text(coalesce(b.zone_floors -> z::text, '[]'::jsonb)) x;
      insert into public.buildings(site_id, name, floors, sort, active, zone_id, zone_ids)
        values (b.site_id, b.name, zf, b.sort, b.active, z, array[z])
        on conflict (site_id, zone_id, name) do nothing;
      select id into nb from public.buildings where site_id = b.site_id and zone_id = z and name = b.name;
      update public.defects d set building_id = nb from public.units u where d.unit_id = u.id and u.building_id = b.id and u.zone_id = z;
      update public.report_jobs j set building_id = nb from public.units u where j.unit_id = u.id and u.building_id = b.id and u.zone_id = z;
      update public.units set building_id = nb where building_id = b.id and zone_id = z;
    end loop;
    select coalesce(array_agg(x), b.floors) into zf from jsonb_array_elements_text(coalesce(b.zone_floors -> b.zone_id::text, '[]'::jsonb)) x;
    update public.buildings set zone_ids = array[zone_id], floors = zf, zone_floors = '{}' where id = b.id;
  end loop;
end $$;

-- 戶別跟著所屬的棟（同一棟的戶別都同一區）
update public.units u set zone_id = b.zone_id from public.buildings b where u.building_id = b.id and u.zone_id is distinct from b.zone_id;
