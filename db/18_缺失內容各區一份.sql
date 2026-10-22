-- 18_缺失內容各區一份：同一個工項底下，專有戶和公設各有自己的一份缺失內容，新增、改名、刪除互不影響
-- 現在兩區共用的缺失內容會複製成兩份；已經有的缺失紀錄，依戶別屬於哪一區，接到那一區的那份。
-- 需先執行過 12_專有公設.sql。貼到 Supabase SQL Editor 按 Run，可重複執行。
alter table public.items add column if not exists zone_ids bigint[] not null default '{}';
alter table public.items add column if not exists zone_id bigint references public.zones(id);   -- 這一條屬於哪一區
alter table public.items drop constraint if exists items_category_id_name_key;                  -- 同一工項兩區可以有同名的缺失內容

do $$
declare r record; z bigint; keep bigint; nid bigint; z0 bigint;
begin
  select id into z0 from public.zones order by sort, id limit 1;
  for r in select * from public.items where zone_id is null order by id loop
    keep := null;
    for z in select id from public.zones where r.zone_ids = '{}' or id = any(r.zone_ids) order by sort, id loop
      if keep is null then
        keep := z; update public.items set zone_id = z, zone_ids = array[z] where id = r.id;
      else
        insert into public.items (category_id, name, sort, active, zone_id, zone_ids)
          values (r.category_id, r.name, r.sort, r.active, z, array[z]) returning id into nid;
        -- 這一區戶別的舊紀錄改接到這一區的那份
        update public.defects d set item_id = nid
          from public.units u join public.buildings b on b.id = u.building_id
          where d.unit_id = u.id and d.item_id = r.id and coalesce(b.zone_id, z0) = z;
      end if;
    end loop;
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'items_category_zone_name_key') then
    alter table public.items add constraint items_category_zone_name_key unique (category_id, zone_id, name);
  end if;
end $$;
