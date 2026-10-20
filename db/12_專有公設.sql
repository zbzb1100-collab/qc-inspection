-- 12_專有公設：選案場後先選「專有戶／公設」，檢查類型、棟別、工項都跟著它變；戶別（公設叫使用空間）可限定出現在哪幾層
-- 貼到 Supabase SQL Editor 按 Run，可重複執行。現有棟別、檢查類型、工項全部先歸到「專有戶」。

create table if not exists public.zones (                  -- 第 1 層：專有戶、公設
  id bigint generated always as identity primary key,
  name text not null unique,
  unit_label text not null default '戶別',                  -- 第 5 層叫什麼：戶別／使用空間
  sort int not null default 0,
  active boolean not null default true
);
insert into public.zones(name, unit_label, sort) values ('專有戶', '戶別', 1), ('公設', '使用空間', 2) on conflict (name) do nothing;

alter table public.buildings add column if not exists zone_id bigint references public.zones(id);       -- 這棟屬於哪一區
alter table public.inspect_types add column if not exists zone_ids bigint[] not null default '{}';     -- 空的＝每區都出現
alter table public.categories add column if not exists zone_ids bigint[] not null default '{}';
alter table public.units add column if not exists floors text[] not null default '{}';                 -- 空的＝這棟每層都有

-- 現有資料歸到專有戶（只動還沒設定的）
update public.buildings set zone_id = (select id from public.zones where name = '專有戶') where zone_id is null;
update public.inspect_types set zone_ids = array[(select id from public.zones where name = '專有戶')] where zone_ids = '{}';
update public.categories set zone_ids = array[(select id from public.zones where name = '專有戶')] where zone_ids = '{}';

grant select, insert, update, delete on public.zones to authenticated;
alter table public.zones enable row level security;
drop policy if exists zones_read on public.zones;
drop policy if exists zones_write on public.zones;
create policy zones_read on public.zones for select to authenticated using (public.is_active_user());
create policy zones_write on public.zones for all to authenticated using (public.is_admin()) with check (public.is_admin());
