-- 品質查驗系統：資料表、權限、照片儲存空間
-- 貼到 Supabase 左側 SQL Editor，按 Run。可重複執行（已存在的會略過）。

-- ========== 使用者 ==========
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text,
  role text not null default 'user' check (role in ('admin','user')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
update public.profiles p set email = u.email from auth.users u where u.id = p.id and p.email is null;

-- 有人建立帳號時自動建立資料；第一位建立的人自動成為管理者
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          new.email,
          case when exists (select 1 from public.profiles) then 'user' else 'admin' end)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active)
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

-- ========== 可自行維護的清單 ==========
create table if not exists public.sites (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort int not null default 0,
  active boolean not null default true
);
create table if not exists public.inspect_types (          -- 檢查類型：交屋檢查…
  id bigint generated always as identity primary key,
  name text not null unique,
  sort int not null default 0,
  active boolean not null default true
);
create table if not exists public.buildings (
  id bigint generated always as identity primary key,
  site_id bigint not null references public.sites(id),
  name text not null,
  floors text[] not null default '{}',                      -- 此棟可選的樓層
  sort int not null default 0,
  active boolean not null default true,
  unique (site_id, name)
);
create table if not exists public.units (                  -- 戶別
  id bigint generated always as identity primary key,
  building_id bigint not null references public.buildings(id),
  code text not null,
  sort int not null default 0,
  active boolean not null default true,
  unique (building_id, code)
);
create table if not exists public.plans (                  -- 平面圖：標準層、2F 各一張
  id bigint generated always as identity primary key,
  unit_id bigint not null references public.units(id) on delete cascade,
  variant text not null default '標準層',
  path text not null,                                       -- 存在 plans 儲存空間
  created_at timestamptz not null default now(),
  unique (unit_id, variant)
);
create table if not exists public.spaces (                 -- 空間別
  id bigint generated always as identity primary key,
  inspect_type_id bigint not null references public.inspect_types(id),
  code text not null default '',
  name text not null,
  sort int not null default 0,
  active boolean not null default true,
  unique (inspect_type_id, name)
);
create table if not exists public.plan_spaces (            -- 平面圖上的空間編號位置
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.plans(id) on delete cascade,
  space_id bigint not null references public.spaces(id),
  x numeric not null, y numeric not null,
  unique (plan_id, space_id)
);
create table if not exists public.unit_spaces (           -- 每戶有哪些空間別
  unit_id bigint not null references public.units(id) on delete cascade,
  space_id bigint not null references public.spaces(id) on delete cascade,
  primary key (unit_id, space_id)
);
create table if not exists public.categories (             -- 大分類（工項）
  id bigint generated always as identity primary key,
  name text not null unique,
  sort int not null default 0,
  active boolean not null default true
);
create table if not exists public.items (                  -- 小分類（缺失內容）
  id bigint generated always as identity primary key,
  category_id bigint not null references public.categories(id),
  name text not null,
  sort int not null default 0,
  active boolean not null default true,
  unique (category_id, name)
);
create table if not exists public.vendors (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true
);
create table if not exists public.category_vendors (       -- 工項預設廠商（可多家）
  category_id bigint not null references public.categories(id) on delete cascade,
  vendor_id bigint not null references public.vendors(id) on delete cascade,
  sort int not null default 0,
  primary key (category_id, vendor_id)
);
create table if not exists public.repair_methods (
  id bigint generated always as identity primary key,
  name text not null unique,
  sort int not null default 0,
  active boolean not null default true
);

-- ========== 缺失紀錄 ==========
create table if not exists public.defects (
  id bigint generated always as identity primary key,
  site_id bigint not null references public.sites(id),
  inspect_type_id bigint not null references public.inspect_types(id),
  building_id bigint not null references public.buildings(id),
  floor text not null,
  unit_id bigint not null references public.units(id),
  customer_name text,                                       -- 交屋檢查的客戶名稱
  plan_id bigint references public.plans(id),
  x numeric, y numeric,                                     -- 圖上位置（0~1 的相對比例）
  space_id bigint references public.spaces(id),
  category_id bigint references public.categories(id),
  item_id bigint references public.items(id),
  repair_method_id bigint references public.repair_methods(id),
  fix_vendor_id bigint references public.vendors(id),       -- 修繕廠商
  resp_vendor_id bigint references public.vendors(id),      -- 責任廠商
  planned_date date,
  fixed_date date,
  description text,
  status text not null default 'todo' check (status in ('todo','fixed','closed')),
  close_type text check (close_type in ('複驗合格','不修')),
  close_reason text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  fixed_by uuid references auth.users(id), fixed_at timestamptz,
  closed_by uuid references auth.users(id), closed_at timestamptz
);
create index if not exists defects_unit_idx on public.defects (unit_id, floor);
create index if not exists defects_filter_idx on public.defects (building_id, floor, category_id, status);

create table if not exists public.defect_photos (
  id bigint generated always as identity primary key,
  defect_id bigint not null references public.defects(id) on delete cascade,
  kind text not null check (kind in ('before','after')),   -- 修繕前 / 修繕後
  path text not null,                                       -- 存在 photos 儲存空間
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists defect_photos_idx on public.defect_photos (defect_id);

create or replace function public.touch_defect() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.status = 'fixed' and old.status is distinct from 'fixed' then
    new.fixed_by := auth.uid(); new.fixed_at := now();
  end if;
  if new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_by := auth.uid(); new.closed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists defects_touch on public.defects;
create trigger defects_touch before update on public.defects
  for each row execute function public.touch_defect();

-- ========== 權限（已關閉自動開放，這裡逐表設定） ==========
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin(), public.is_active_user() to authenticated;

do $$
declare t text;
begin
  -- 清單類：登入者可看，只有管理者可改
  foreach t in array array['sites','inspect_types','buildings','units','plans','spaces','plan_spaces','unit_spaces',
                           'categories','items','vendors','category_vendors','repair_methods'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('drop policy if exists %I on public.%I', t||'_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_active_user())', t||'_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t||'_write', t);
  end loop;
end $$;

-- 使用者資料
alter table public.profiles enable row level security;
drop policy if exists profiles_read on public.profiles;
drop policy if exists profiles_admin on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (public.is_active_user());
create policy profiles_admin on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 缺失：登入者都能看、新增、修改；只有管理者能刪
alter table public.defects enable row level security;
drop policy if exists defects_read on public.defects;
drop policy if exists defects_insert on public.defects;
drop policy if exists defects_update on public.defects;
drop policy if exists defects_delete on public.defects;
create policy defects_read on public.defects for select to authenticated using (public.is_active_user());
create policy defects_insert on public.defects for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());
create policy defects_update on public.defects for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
create policy defects_delete on public.defects for delete to authenticated using (public.is_admin());

alter table public.defect_photos enable row level security;
drop policy if exists photos_read on public.defect_photos;
drop policy if exists photos_insert on public.defect_photos;
drop policy if exists photos_delete on public.defect_photos;
create policy photos_read on public.defect_photos for select to authenticated using (public.is_active_user());
create policy photos_insert on public.defect_photos for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());
create policy photos_delete on public.defect_photos for delete to authenticated
  using (public.is_admin() or created_by = auth.uid());

-- ========== 照片與平面圖儲存空間（私有） ==========
insert into storage.buckets (id, name, public) values ('photos','photos',false), ('plans','plans',false)
  on conflict (id) do nothing;

drop policy if exists storage_photos_read on storage.objects;
drop policy if exists storage_photos_insert on storage.objects;
drop policy if exists storage_photos_delete on storage.objects;
drop policy if exists storage_plans_read on storage.objects;
drop policy if exists storage_plans_write on storage.objects;
create policy storage_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_active_user());
create policy storage_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_active_user());
create policy storage_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (public.is_admin() or owner = auth.uid()));
create policy storage_plans_read on storage.objects for select to authenticated
  using (bucket_id = 'plans' and public.is_active_user());
create policy storage_plans_write on storage.objects for all to authenticated
  using (bucket_id = 'plans' and public.is_admin()) with check (bucket_id = 'plans' and public.is_admin());
