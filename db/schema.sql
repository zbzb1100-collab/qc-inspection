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

-- ========== 資料保護（同 5_資料保護.sql）==========

-- 1) 缺失：新增一律從「待修」開始；修改時檢查狀態流程，稽核欄位只能由系統填
create or replace function public.guard_defect() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); adm boolean := public.is_admin();
begin
  if me is null then return new; end if;   -- 在 SQL Editor 由管理者直接執行時不檢查

  if tg_op = 'INSERT' then
    new.status := 'todo'; new.close_type := null; new.close_reason := null; new.fixed_date := null;
    new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
    new.created_by := me; new.created_at := now(); new.updated_by := null; new.updated_at := now();
    return new;
  end if;

  -- 不能改的欄位：建立者、建立時間、案場／檢查類型／棟／樓／戶
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.site_id := old.site_id; new.inspect_type_id := old.inspect_type_id;
  new.building_id := old.building_id; new.floor := old.floor; new.unit_id := old.unit_id;
  -- 稽核欄位先沿用舊值，下面依狀態變化由系統填
  new.fixed_by := old.fixed_by; new.fixed_at := old.fixed_at;
  new.closed_by := old.closed_by; new.closed_at := old.closed_at;

  if new.status is distinct from old.status then
    if old.status = 'todo' and new.status = 'fixed' then
      if not exists (select 1 from public.defect_photos where defect_id = new.id and kind = 'after') then
        raise exception '要先上傳修繕後照片，才能標示修繕完成';
      end if;
      new.close_type := null; new.close_reason := null;
      new.fixed_date := coalesce(new.fixed_date, current_date);
      new.fixed_by := me; new.fixed_at := now();
    elsif old.status = 'fixed' and new.status = 'closed' and new.close_type = '複驗合格' then
      new.close_reason := null; new.closed_by := me; new.closed_at := now();
    elsif old.status in ('todo','fixed') and new.status = 'closed' and new.close_type = '不修' then
      if coalesce(btrim(new.close_reason), '') = '' then raise exception '不修要填原因'; end if;
      new.closed_by := me; new.closed_at := now();
    elsif old.status = 'fixed' and new.status = 'todo' then          -- 複驗不合格，退回待修
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null;
    elsif old.status = 'closed' and new.status = 'todo' and adm then -- 已結案重新開啟：只有管理者
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
    else
      raise exception '不允許的狀態變更：% → %', old.status, new.status;
    end if;
  else
    -- 狀態沒變：結案方式不能單獨改（內容、照片、說明大家都能改，最後修改者有紀錄）
    new.close_type := old.close_type;
    if old.status = 'closed' and old.close_type = '不修' and coalesce(btrim(new.close_reason), '') = '' then
      new.close_reason := old.close_reason;
    end if;
  end if;

  new.updated_at := now(); new.updated_by := me;
  return new;
end $$;

drop trigger if exists defects_touch on public.defects;
drop trigger if exists defects_guard on public.defects;
create trigger defects_guard before insert or update on public.defects
  for each row execute function public.guard_defect();

-- 2) 照片：只能放進「已存在的缺失編號」資料夾（路徑＝缺失編號/檔名），不能隨意上傳
drop policy if exists storage_photos_insert on storage.objects;
create policy storage_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_active_user()
              and exists (select 1 from public.defects d where d.id::text = (storage.foldername(name))[1]));

-- 3) 照片紀錄：只能掛在存在的缺失上，且路徑要在該缺失的資料夾內
drop policy if exists photos_insert on public.defect_photos;
create policy photos_insert on public.defect_photos for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid() and path like defect_id::text || '/%');

-- ========== 廠商帳號（同 6_廠商帳號.sql）==========

alter table public.profiles add column if not exists vendor_id bigint references public.vendors(id);
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','user','vendor'));

-- 內部人員（管理者＋一般）
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin','user'))
$$;
-- 目前登入的廠商帳號對應哪一家廠商（不是廠商帳號就是 null）
create or replace function public.my_vendor() returns bigint
language sql stable security definer set search_path = public as $$
  select vendor_id from public.profiles where id = auth.uid() and active and role = 'vendor'
$$;
create or replace function public.can_see_defect(did bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() or exists (select 1 from public.defects d where d.id = did and d.fix_vendor_id = public.my_vendor())
$$;
grant execute on function public.is_staff(), public.my_vendor(), public.can_see_defect(bigint) to authenticated;

-- 帳號資料：內部人員看得到全部；廠商只看得到自己
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (public.is_staff() or id = auth.uid());

-- 缺失
drop policy if exists defects_read on public.defects;
drop policy if exists defects_insert on public.defects;
drop policy if exists defects_update on public.defects;
create policy defects_read on public.defects for select to authenticated
  using (public.is_staff() or fix_vendor_id = public.my_vendor());
create policy defects_insert on public.defects for insert to authenticated
  with check (public.is_staff() and created_by = auth.uid());
create policy defects_update on public.defects for update to authenticated
  using (public.is_staff() or fix_vendor_id = public.my_vendor())
  with check (public.is_staff() or fix_vendor_id = public.my_vendor());

-- 照片紀錄：廠商只能加「修繕後」照片到自己的缺失
drop policy if exists photos_read on public.defect_photos;
drop policy if exists photos_insert on public.defect_photos;
create policy photos_read on public.defect_photos for select to authenticated
  using (public.can_see_defect(defect_id));
create policy photos_insert on public.defect_photos for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid() and path like defect_id::text || '/%'
              and (public.is_staff() or (kind = 'after' and public.can_see_defect(defect_id))));

-- 照片檔案：廠商只讀寫自己缺失的資料夾
drop policy if exists storage_photos_read on storage.objects;
drop policy if exists storage_photos_insert on storage.objects;
create policy storage_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (public.is_staff() or exists (select 1 from public.defects d
         where d.id::text = (storage.foldername(name))[1] and d.fix_vendor_id = public.my_vendor())));
create policy storage_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_active_user() and exists (select 1 from public.defects d
         where d.id::text = (storage.foldername(name))[1] and (public.is_staff() or d.fix_vendor_id = public.my_vendor())));

-- 缺失觸發器：廠商只能改「修繕完成日」並把待修改成已修繕，其他欄位一律保持原樣
create or replace function public.guard_defect() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); adm boolean := public.is_admin(); vend bigint := public.my_vendor();
        fd date; st text;
begin
  if me is null then return new; end if;   -- 在 SQL Editor 由管理者直接執行時不檢查

  if tg_op = 'INSERT' then
    if vend is not null then raise exception '廠商帳號不能新增缺失'; end if;
    new.status := 'todo'; new.close_type := null; new.close_reason := null; new.fixed_date := null;
    new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
    new.created_by := me; new.created_at := now(); new.updated_by := null; new.updated_at := now();
    return new;
  end if;

  if vend is not null then
    if new.status is distinct from old.status and not (old.status = 'todo' and new.status = 'fixed') then
      raise exception '廠商帳號只能回報修繕完成';
    end if;
    fd := new.fixed_date; st := new.status;
    new := old; new.fixed_date := fd; new.status := st;
  end if;

  -- 不能改的欄位：建立者、建立時間、案場／檢查類型／棟／樓／戶
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.site_id := old.site_id; new.inspect_type_id := old.inspect_type_id;
  new.building_id := old.building_id; new.floor := old.floor; new.unit_id := old.unit_id;
  new.fixed_by := old.fixed_by; new.fixed_at := old.fixed_at;
  new.closed_by := old.closed_by; new.closed_at := old.closed_at;

  if new.status is distinct from old.status then
    if old.status = 'todo' and new.status = 'fixed' then
      if not exists (select 1 from public.defect_photos where defect_id = new.id and kind = 'after') then
        raise exception '要先上傳修繕後照片，才能標示修繕完成';
      end if;
      new.close_type := null; new.close_reason := null;
      new.fixed_date := coalesce(new.fixed_date, current_date);
      new.fixed_by := me; new.fixed_at := now();
    elsif old.status = 'fixed' and new.status = 'closed' and new.close_type = '複驗合格' then
      new.close_reason := null; new.closed_by := me; new.closed_at := now();
    elsif old.status in ('todo','fixed') and new.status = 'closed' and new.close_type = '不修' then
      if coalesce(btrim(new.close_reason), '') = '' then raise exception '不修要填原因'; end if;
      new.closed_by := me; new.closed_at := now();
    elsif old.status = 'fixed' and new.status = 'todo' then
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null;
    elsif old.status = 'closed' and new.status = 'todo' and adm then
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
    else
      raise exception '不允許的狀態變更：% → %', old.status, new.status;
    end if;
  else
    new.close_type := old.close_type;
    if old.status = 'closed' and old.close_type = '不修' and coalesce(btrim(new.close_reason), '') = '' then
      new.close_reason := old.close_reason;
    end if;
  end if;

  new.updated_at := now(); new.updated_by := me;
  return new;
end $$;

-- ========== 待簽認（同 7_待簽認.sql）==========

alter table public.inspect_types add column if not exists need_sign boolean not null default false;
update public.inspect_types set need_sign = true where name in ('驗交屋','已交屋報修','第三方驗收','公設第三方驗收') and need_sign = false;

alter table public.defects drop constraint if exists defects_status_check;
alter table public.defects add constraint defects_status_check check (status in ('todo','fixed','signing','closed'));
alter table public.defects add column if not exists verified_by uuid references auth.users(id);
alter table public.defects add column if not exists verified_at timestamptz;
alter table public.defects add column if not exists signed_name text;     -- 簽認人
alter table public.defects add column if not exists signed_date date;     -- 簽認日期
-- 以前已結案（複驗合格）的，把複驗人補成結案人
update public.defects set verified_by = closed_by, verified_at = closed_at
  where status = 'closed' and close_type = '複驗合格' and verified_at is null;

create or replace function public.guard_defect() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); adm boolean := public.is_admin(); vend bigint := public.my_vendor();
        fd date; st text; sign boolean;
begin
  if me is null then return new; end if;   -- 在 SQL Editor 由管理者直接執行時不檢查

  if tg_op = 'INSERT' then
    if vend is not null then raise exception '廠商帳號不能新增缺失'; end if;
    new.status := 'todo'; new.close_type := null; new.close_reason := null; new.fixed_date := null;
    new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
    new.verified_by := null; new.verified_at := null; new.signed_name := null; new.signed_date := null;
    new.created_by := me; new.created_at := now(); new.updated_by := null; new.updated_at := now();
    return new;
  end if;

  if vend is not null then
    if new.status is distinct from old.status and not (old.status = 'todo' and new.status = 'fixed') then
      raise exception '廠商帳號只能回報修繕完成';
    end if;
    fd := new.fixed_date; st := new.status;
    new := old; new.fixed_date := fd; new.status := st;
  end if;

  -- 不能改的欄位：建立者、建立時間、案場／檢查類型／棟／樓／戶
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.site_id := old.site_id; new.inspect_type_id := old.inspect_type_id;
  new.building_id := old.building_id; new.floor := old.floor; new.unit_id := old.unit_id;
  new.fixed_by := old.fixed_by; new.fixed_at := old.fixed_at;
  new.closed_by := old.closed_by; new.closed_at := old.closed_at;
  new.verified_by := old.verified_by; new.verified_at := old.verified_at;
  select coalesce(need_sign, false) into sign from public.inspect_types where id = old.inspect_type_id;

  if new.status is distinct from old.status then
    if old.status = 'todo' and new.status = 'fixed' then
      if not exists (select 1 from public.defect_photos where defect_id = new.id and kind = 'after') then
        raise exception '要先上傳修繕後照片，才能標示修繕完成';
      end if;
      new.close_type := null; new.close_reason := null;
      new.fixed_date := coalesce(new.fixed_date, current_date);
      new.fixed_by := me; new.fixed_at := now();
    elsif old.status = 'fixed' and new.status = 'signing' and sign then      -- 複驗合格，等客戶簽認
      new.close_type := null; new.close_reason := null; new.verified_by := me; new.verified_at := now();
    elsif old.status = 'fixed' and new.status = 'closed' and new.close_type = '複驗合格' and not sign then
      new.close_reason := null; new.verified_by := me; new.verified_at := now(); new.closed_by := me; new.closed_at := now();
    elsif old.status = 'signing' and new.status = 'closed' and new.close_type = '複驗合格' then   -- 客戶簽認，結案
      if coalesce(btrim(new.signed_name), '') = '' then raise exception '請填簽認人'; end if;
      new.signed_date := coalesce(new.signed_date, current_date);
      new.close_reason := null; new.closed_by := me; new.closed_at := now();
    elsif old.status in ('todo','fixed','signing') and new.status = 'closed' and new.close_type = '不修' then
      if coalesce(btrim(new.close_reason), '') = '' then raise exception '不修要填原因'; end if;
      new.closed_by := me; new.closed_at := now();
    elsif old.status in ('fixed','signing') and new.status = 'todo' then     -- 複驗不合格／客戶不認可，退回待修
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.verified_by := null; new.verified_at := null;
      new.signed_name := null; new.signed_date := null;
    elsif old.status = 'closed' and new.status = 'todo' and adm then
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
      new.verified_by := null; new.verified_at := null; new.signed_name := null; new.signed_date := null;
    else
      raise exception '不允許的狀態變更：% → %', old.status, new.status;
    end if;
  else
    new.close_type := old.close_type;
    if old.status = 'closed' and old.close_type = '不修' and coalesce(btrim(new.close_reason), '') = '' then
      new.close_reason := old.close_reason;
    end if;
  end if;

  new.updated_at := now(); new.updated_by := me;
  return new;
end $$;

-- ========== 簽名板（同 8_簽名板.sql）==========

alter table public.defect_photos drop constraint if exists defect_photos_kind_check;
alter table public.defect_photos add constraint defect_photos_kind_check check (kind in ('before','after','sign'));

create or replace function public.guard_defect() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); adm boolean := public.is_admin(); vend bigint := public.my_vendor();
        fd date; st text; sign boolean;
begin
  if me is null then return new; end if;   -- 在 SQL Editor 由管理者直接執行時不檢查

  if tg_op = 'INSERT' then
    if vend is not null then raise exception '廠商帳號不能新增缺失'; end if;
    new.status := 'todo'; new.close_type := null; new.close_reason := null; new.fixed_date := null;
    new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
    new.verified_by := null; new.verified_at := null; new.signed_name := null; new.signed_date := null;
    new.created_by := me; new.created_at := now(); new.updated_by := null; new.updated_at := now();
    return new;
  end if;

  if vend is not null then
    if new.status is distinct from old.status and not (old.status = 'todo' and new.status = 'fixed') then
      raise exception '廠商帳號只能回報修繕完成';
    end if;
    fd := new.fixed_date; st := new.status;
    new := old; new.fixed_date := fd; new.status := st;
  end if;

  -- 不能改的欄位：建立者、建立時間、案場／檢查類型／棟／樓／戶
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.site_id := old.site_id; new.inspect_type_id := old.inspect_type_id;
  new.building_id := old.building_id; new.floor := old.floor; new.unit_id := old.unit_id;
  new.fixed_by := old.fixed_by; new.fixed_at := old.fixed_at;
  new.closed_by := old.closed_by; new.closed_at := old.closed_at;
  new.verified_by := old.verified_by; new.verified_at := old.verified_at;
  select coalesce(need_sign, false) into sign from public.inspect_types where id = old.inspect_type_id;

  if new.status is distinct from old.status then
    if old.status = 'todo' and new.status = 'fixed' then
      if not exists (select 1 from public.defect_photos where defect_id = new.id and kind = 'after') then
        raise exception '要先上傳修繕後照片，才能標示修繕完成';
      end if;
      new.close_type := null; new.close_reason := null;
      new.fixed_date := coalesce(new.fixed_date, current_date);
      new.fixed_by := me; new.fixed_at := now();
    elsif old.status = 'fixed' and new.status = 'signing' and sign then      -- 複驗合格，等客戶簽認
      new.close_type := null; new.close_reason := null; new.verified_by := me; new.verified_at := now();
    elsif old.status = 'fixed' and new.status = 'closed' and new.close_type = '複驗合格' and not sign then
      new.close_reason := null; new.verified_by := me; new.verified_at := now(); new.closed_by := me; new.closed_at := now();
    elsif old.status = 'signing' and new.status = 'closed' and new.close_type = '複驗合格' then   -- 客戶簽認，結案
      if not exists (select 1 from public.defect_photos where defect_id = new.id and kind = 'sign'
                     and created_at >= coalesce(old.verified_at, '-infinity')) then   -- 要這一輪複驗後的簽名
        raise exception '請客戶在簽名板簽名';
      end if;
      new.signed_date := coalesce(new.signed_date, current_date);
      new.close_reason := null; new.closed_by := me; new.closed_at := now();
    elsif old.status in ('todo','fixed','signing') and new.status = 'closed' and new.close_type = '不修' then
      if coalesce(btrim(new.close_reason), '') = '' then raise exception '不修要填原因'; end if;
      new.closed_by := me; new.closed_at := now();
    elsif old.status in ('fixed','signing') and new.status = 'todo' then     -- 複驗不合格／客戶不認可，退回待修
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.verified_by := null; new.verified_at := null;
      new.signed_name := null; new.signed_date := null;
    elsif old.status = 'closed' and new.status = 'todo' and adm then
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
      new.verified_by := null; new.verified_at := null; new.signed_name := null; new.signed_date := null;
    else
      raise exception '不允許的狀態變更：% → %', old.status, new.status;
    end if;
  else
    new.close_type := old.close_type;
    if old.status = 'closed' and old.close_type = '不修' and coalesce(btrim(new.close_reason), '') = '' then
      new.close_reason := old.close_reason;
    end if;
  end if;

  new.updated_at := now(); new.updated_by := me;
  return new;
end $$;

-- ========== 不修複驗（同 9_不修複驗.sql）==========
create or replace function public.guard_defect() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); adm boolean := public.is_admin(); vend bigint := public.my_vendor();
        fd date; st text; sign boolean;
begin
  if me is null then return new; end if;   -- 在 SQL Editor 由管理者直接執行時不檢查

  if tg_op = 'INSERT' then
    if vend is not null then raise exception '廠商帳號不能新增缺失'; end if;
    new.status := 'todo'; new.close_type := null; new.close_reason := null; new.fixed_date := null;
    new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
    new.verified_by := null; new.verified_at := null; new.signed_name := null; new.signed_date := null;
    new.created_by := me; new.created_at := now(); new.updated_by := null; new.updated_at := now();
    return new;
  end if;

  if vend is not null then
    if new.status is distinct from old.status and not (old.status = 'todo' and new.status = 'fixed') then
      raise exception '廠商帳號只能回報修繕完成';
    end if;
    fd := new.fixed_date; st := new.status;
    new := old; new.fixed_date := fd; new.status := st;
  end if;

  -- 不能改的欄位：建立者、建立時間、案場／檢查類型／棟／樓／戶
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.site_id := old.site_id; new.inspect_type_id := old.inspect_type_id;
  new.building_id := old.building_id; new.floor := old.floor; new.unit_id := old.unit_id;
  new.fixed_by := old.fixed_by; new.fixed_at := old.fixed_at;
  new.closed_by := old.closed_by; new.closed_at := old.closed_at;
  new.verified_by := old.verified_by; new.verified_at := old.verified_at;
  select coalesce(need_sign, false) into sign from public.inspect_types where id = old.inspect_type_id;

  if new.status is distinct from old.status then
    if old.status = 'todo' and new.status = 'fixed' and new.close_type = '不修' then   -- 提出不修，等複驗確認
      if coalesce(btrim(new.close_reason), '') = '' then raise exception '不修要填原因'; end if;
      new.fixed_date := null; new.fixed_by := me; new.fixed_at := now();
    elsif old.status = 'todo' and new.status = 'fixed' then
      if not exists (select 1 from public.defect_photos where defect_id = new.id and kind = 'after') then
        raise exception '要先上傳修繕後照片，才能標示修繕完成';
      end if;
      new.close_type := null; new.close_reason := null;
      new.fixed_date := coalesce(new.fixed_date, current_date);
      new.fixed_by := me; new.fixed_at := now();
    elsif old.status = 'fixed' and new.status = 'signing' and sign then      -- 複驗確認（修好或同意不修），等客戶簽認
      new.close_type := old.close_type; new.close_reason := old.close_reason; new.verified_by := me; new.verified_at := now();
    elsif old.status = 'fixed' and new.status = 'closed' and not sign then   -- 複驗確認，結案
      new.close_type := coalesce(old.close_type, '複驗合格'); new.close_reason := old.close_reason;
      new.verified_by := me; new.verified_at := now(); new.closed_by := me; new.closed_at := now();
    elsif old.status = 'signing' and new.status = 'closed' then   -- 客戶簽認，結案
      if not exists (select 1 from public.defect_photos where defect_id = new.id and kind = 'sign'
                     and created_at >= coalesce(old.verified_at, '-infinity')) then   -- 要這一輪複驗後的簽名
        raise exception '請客戶在簽名板簽名';
      end if;
      new.signed_date := coalesce(new.signed_date, current_date);
      new.close_type := coalesce(old.close_type, '複驗合格'); new.close_reason := old.close_reason;
      new.closed_by := me; new.closed_at := now();
    elsif old.status in ('fixed','signing') and new.status = 'todo' then     -- 複驗不合格／客戶不認可，退回待修
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.verified_by := null; new.verified_at := null;
      new.signed_name := null; new.signed_date := null;
    elsif old.status = 'closed' and new.status = 'todo' and adm then
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
      new.verified_by := null; new.verified_at := null; new.signed_name := null; new.signed_date := null;
    else
      raise exception '不允許的狀態變更：% → %', old.status, new.status;
    end if;
  else
    new.close_type := old.close_type;
    if old.close_type = '不修' and coalesce(btrim(new.close_reason), '') = '' then
      new.close_reason := old.close_reason;
    end if;
  end if;

  new.updated_at := now(); new.updated_by := me;
  return new;
end $$;

-- 10_報告轉檔：同事在系統上傳驗屋報告 PDF → 排程的 AI 讀完把結果寫回 → 同事在系統預覽、補選、匯入
-- 需先執行過 6_廠商帳號.sql（用到 is_staff）。貼到 Supabase SQL Editor 按 Run，可重複執行。

create table if not exists public.report_jobs (
  id bigint generated always as identity primary key,
  site_id bigint not null references public.sites(id),
  file_name text not null,                  -- 原始檔名
  path text not null,                       -- reports 儲存空間裡的路徑：<id>/report.pdf
  vendor text,                              -- 驗屋公司（選填，例：鷹眼）
  building_id bigint references public.buildings(id),
  floor text,
  unit_id bigint references public.units(id),
  inspect_type_id bigint references public.inspect_types(id),
  note text,                                -- 上傳者給 AI 的補充說明
  status text not null default 'pending' check (status in ('pending','processing','done','error','imported')),
  result jsonb,                             -- {"rows":[{棟別,樓層,…,照片}], "skip":[[編號,內容,原因]]}
  message text,                             -- 轉檔失敗原因或 AI 給的提醒
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  imported_by uuid references auth.users(id),
  imported_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists report_jobs_status_idx on public.report_jobs (status, created_at);

grant select, insert, update, delete on public.report_jobs to authenticated;
alter table public.report_jobs enable row level security;
drop policy if exists report_jobs_read on public.report_jobs;
drop policy if exists report_jobs_insert on public.report_jobs;
drop policy if exists report_jobs_update on public.report_jobs;
drop policy if exists report_jobs_delete on public.report_jobs;
create policy report_jobs_read on public.report_jobs for select to authenticated using (public.is_staff());
create policy report_jobs_insert on public.report_jobs for insert to authenticated with check (public.is_staff() and created_by = auth.uid());
create policy report_jobs_update on public.report_jobs for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy report_jobs_delete on public.report_jobs for delete to authenticated using (public.is_admin() or created_by = auth.uid());

create or replace function public.touch_report_job() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists report_jobs_touch on public.report_jobs;
create trigger report_jobs_touch before update on public.report_jobs for each row execute function public.touch_report_job();

-- 報告與裁好的照片放在私有的 reports 儲存空間（<job id>/report.pdf、<job id>/photos/xxx.jpg）
insert into storage.buckets (id, name, public) values ('reports','reports',false) on conflict (id) do nothing;
drop policy if exists storage_reports_read on storage.objects;
drop policy if exists storage_reports_insert on storage.objects;
drop policy if exists storage_reports_update on storage.objects;
drop policy if exists storage_reports_delete on storage.objects;
create policy storage_reports_read on storage.objects for select to authenticated using (bucket_id = 'reports' and public.is_staff());
create policy storage_reports_insert on storage.objects for insert to authenticated with check (bucket_id = 'reports' and public.is_staff());
create policy storage_reports_update on storage.objects for update to authenticated using (bucket_id = 'reports' and public.is_staff());
create policy storage_reports_delete on storage.objects for delete to authenticated using (bucket_id = 'reports' and (public.is_admin() or owner = auth.uid()));

-- 11_立即轉檔：管理員在「報告」分頁勾選待轉檔的報告按「立即轉檔」→ 那幾份排到最前面，並馬上叫排程跑一次
-- 需先執行過 10_報告轉檔.sql。貼到 Supabase SQL Editor 按 Run，可重複執行。
-- 另外要在 Supabase 部署 fire-convert 小程式（supabase/functions/fire-convert/index.ts），步驟見 docs/立即轉檔設定.md。

alter table public.report_jobs add column if not exists urgent boolean not null default false;   -- 管理員要求立即轉檔
alter table public.report_jobs add column if not exists urgent_by uuid references auth.users(id);
alter table public.report_jobs add column if not exists urgent_at timestamptz;
create index if not exists report_jobs_urgent_idx on public.report_jobs (status, urgent desc, created_at);

-- 只有管理員能把報告標成立即轉檔；一般使用者照樣只能上傳排隊
create or replace function public.touch_report_job() returns trigger
language plpgsql as $$
begin
  if new.urgent and not coalesce(old.urgent, false) then
    if not public.is_admin() then raise exception '只有管理員可以要求立即轉檔'; end if;
    new.urgent_by := auth.uid(); new.urgent_at := now();
  end if;
  new.updated_at := now(); return new;
end $$;

create or replace function public.guard_report_job_insert() returns trigger
language plpgsql as $$
begin
  if new.urgent and not public.is_admin() then new.urgent := false; end if;
  if new.urgent then new.urgent_by := auth.uid(); new.urgent_at := now(); end if;
  return new;
end $$;
drop trigger if exists report_jobs_guard_insert on public.report_jobs;
create trigger report_jobs_guard_insert before insert on public.report_jobs for each row execute function public.guard_report_job_insert();

-- ========== 12 專有戶／公設 ==========

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

-- ========== 13 棟別多區 ==========
alter table public.buildings add column if not exists zone_ids bigint[] not null default '{}';   -- 這棟出現在哪幾區
update public.buildings set zone_ids = array[zone_id] where zone_ids = '{}' and zone_id is not null;
alter table public.units add column if not exists zone_id bigint references public.zones(id);   -- 這戶／使用空間屬於哪一區
update public.units u set zone_id = b.zone_id from public.buildings b where u.building_id = b.id and u.zone_id is null;

-- ========== 14 分區樓層 ==========
alter table public.buildings add column if not exists zone_floors jsonb not null default '{}';   -- {"區分id": ["2F","3F",…]}，沒設定的區用 floors

-- ========== 15 一棟一區 ==========

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

-- ========== 16 空間別分區 ==========
alter table public.spaces add column if not exists zone_ids bigint[] not null default '{}';   -- 空的＝每區都出現
update public.spaces s set zone_ids = z.ids
from (
  select us.space_id, array_agg(distinct coalesce(b.zone_id, (select id from public.zones order by sort, id limit 1))) as ids
  from public.unit_spaces us join public.units u on u.id = us.unit_id join public.buildings b on b.id = u.building_id
  group by us.space_id
) z
where s.id = z.space_id and s.zone_ids = '{}' and array_length(z.ids, 1) = 1;

-- 17_缺失內容分區：同一個工項，專有戶和公設底下可以有不同的缺失內容
-- 現有缺失內容先維持「兩區都出現」（空的＝每區都有），到後台「工項與缺失」切到專有戶或公設，把不用的那一區取消勾選即可。
-- 需先執行過 12_專有公設.sql。貼到 Supabase SQL Editor 按 Run，可重複執行。
alter table public.items add column if not exists zone_ids bigint[] not null default '{}';   -- 空的＝每區都出現

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
-- 19_申請帳號.sql：同事在登入頁自己申請帳號，管理者開通後才能用
-- 新建立的帳號一律先「停用」並標記「待開通」（第一位帳號仍自動成為管理者）。
-- 這支可以重複執行，不會動到已經存在的帳號。
alter table public.profiles add column if not exists pending boolean not null default false;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, name, email, role, active, pending)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email,'@',1)),
          new.email,
          case when first then 'admin' else 'user' end,
          first, not first)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========== 20_異動紀錄與結案鎖定 ==========
-- 20_異動紀錄與結案鎖定.sql
-- 每次新增、修改、刪除缺失，以及新增、刪除照片，都自動記一筆：誰、什麼時候、哪些欄位從什麼改成什麼。
-- 紀錄只能看、不能改也不能刪（沒有開放寫入權限，只有資料庫觸發器會寫）。缺失刪掉後紀錄仍保留。
-- 可重複執行。

create table if not exists public.defect_logs (
  id bigint generated always as identity primary key,
  defect_id bigint not null,                 -- 不設外鍵：缺失刪除後紀錄仍保留
  action text not null,                      -- 新增／修改／刪除／新增照片／刪除照片
  changes jsonb not null default '{}'::jsonb, -- 修改：{欄位: [舊值, 新值]}；新增／刪除：整筆內容
  by_user uuid default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists defect_logs_defect_idx on public.defect_logs (defect_id, at);

alter table public.defect_logs enable row level security;
drop policy if exists defect_logs_read on public.defect_logs;
create policy defect_logs_read on public.defect_logs for select to authenticated
  using (public.is_staff() or public.can_see_defect(defect_id));
-- 不建立 insert／update／delete 權限：網頁端無法寫入或竄改

create or replace function public.log_defect() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; diff jsonb := '{}'::jsonb; k text;
  skip text[] := array['updated_at','updated_by','created_at','fixed_at','closed_at','verified_at'];
begin
  if tg_op = 'INSERT' then
    insert into public.defect_logs (defect_id, action, changes) values (new.id, '新增', to_jsonb(new) - skip);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.defect_logs (defect_id, action, changes) values (old.id, '刪除', to_jsonb(old));
    return old;
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  for k in select jsonb_object_keys(n) loop
    if not (k = any(skip)) and (o -> k) is distinct from (n -> k) then
      diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
    end if;
  end loop;
  if diff <> '{}'::jsonb then
    insert into public.defect_logs (defect_id, action, changes) values (new.id, '修改', diff);
  end if;
  return new;
end $$;
drop trigger if exists defects_log on public.defects;
create trigger defects_log after insert or update or delete on public.defects
  for each row execute function public.log_defect();

create or replace function public.log_defect_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.defect_logs (defect_id, action, changes)
    values (new.defect_id, '新增照片', jsonb_build_object('kind', new.kind, 'path', new.path));
    return new;
  end if;
  -- 整筆缺失被刪除時照片會連帶刪除，那時已有「刪除」紀錄，不再逐張記
  if exists (select 1 from public.defects where id = old.defect_id) then
    insert into public.defect_logs (defect_id, action, changes)
    values (old.defect_id, '刪除照片', jsonb_build_object('kind', old.kind, 'path', old.path));
  end if;
  return old;
end $$;
drop trigger if exists defect_photos_log on public.defect_photos;
create trigger defect_photos_log after insert or delete on public.defect_photos
  for each row execute function public.log_defect_photo();

-- ===== 結案鎖定（2026-10-23 LMS：照改善報告） =====
-- 已結案的缺失誰都不能改、不能刪、不能加刪照片；要修改只能由管理者「重新開案」並填原因。
-- 重新開案只把狀態退回待修，舊的結案資料都留在上面的異動紀錄裡。
alter table public.defects add column if not exists reopen_reason text;

create or replace function public.lock_closed_defect() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return coalesce(new, old); end if;     -- SQL Editor 維護用
  if tg_op = 'DELETE' then
    if old.status = 'closed' then raise exception '已結案的缺失不能刪除'; end if;
    return old;
  end if;
  if old.status <> 'closed' then return new; end if;
  if new.status = 'todo' then
    if not public.is_admin() then raise exception '只有管理者可以重新開案'; end if;
    if coalesce(btrim(new.reopen_reason), '') = '' then raise exception '重新開案要填原因'; end if;
    return new;
  end if;
  raise exception '已結案的缺失不能修改，要修改請管理者重新開案';
end $$;
-- 名稱排在 defects_guard 前面，先檢查
drop trigger if exists defects_closed_lock on public.defects;
create trigger defects_closed_lock before update or delete on public.defects
  for each row execute function public.lock_closed_defect();

create or replace function public.lock_closed_photo() returns trigger
language plpgsql security definer set search_path = public as $$
declare did bigint := coalesce(new.defect_id, old.defect_id);
begin
  if auth.uid() is null then return coalesce(new, old); end if;
  if exists (select 1 from public.defects where id = did and status = 'closed') then
    raise exception '已結案的缺失不能新增或刪除照片';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists defect_photos_closed_lock on public.defect_photos;
create trigger defect_photos_closed_lock before insert or delete on public.defect_photos
  for each row execute function public.lock_closed_photo();

-- ========== 21_照片保護 ==========
-- 21_照片保護.sql
-- 照片刪除改成「軟刪除」：只標記已刪除、檔案保留，管理者可以在缺失表單還原。
-- 不能刪的照片：已結案缺失的照片（20 已擋）、客戶簽名、已修繕／待簽認時最後一張修繕後照片。
-- 真正刪除照片紀錄只能在 SQL Editor 由管理者做。需先執行 20_異動紀錄與結案鎖定.sql。可重複執行。

alter table public.defect_photos add column if not exists deleted_at timestamptz;
alter table public.defect_photos add column if not exists deleted_by uuid references auth.users(id);

drop policy if exists photos_update on public.defect_photos;
create policy photos_update on public.defect_photos for update to authenticated
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());
drop policy if exists photos_delete on public.defect_photos;
create policy photos_delete on public.defect_photos for delete to authenticated using (false);
drop policy if exists storage_photos_delete on storage.objects;
create policy storage_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (public.is_admin() or owner = auth.uid()) and not exists (
    select 1 from public.defect_photos p where p.path = storage.objects.name));   -- 只能清掉沒有紀錄的檔案（上傳失敗或整筆缺失已刪）

create or replace function public.guard_photo() returns trigger
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  if auth.uid() is null then return new; end if;
  -- 只能改「刪除／還原」，其他欄位保持原樣
  new.defect_id := old.defect_id; new.kind := old.kind; new.path := old.path;
  new.created_by := old.created_by; new.created_at := old.created_at;
  if new.deleted_at is not distinct from old.deleted_at then return new; end if;
  select * into d from public.defects where id = old.defect_id;
  if d.status = 'closed' then raise exception '已結案的缺失不能刪除或還原照片'; end if;
  if new.deleted_at is null then                       -- 還原
    if not public.is_admin() then raise exception '只有管理者可以還原照片'; end if;
    new.deleted_by := null; return new;
  end if;
  if old.kind = 'sign' then raise exception '客戶簽名不能刪除'; end if;
  if old.kind = 'after' and d.status in ('fixed','signing') and d.close_type is distinct from '不修'
     and not exists (select 1 from public.defect_photos where defect_id = old.defect_id and kind = 'after'
                     and deleted_at is null and id <> old.id) then
    raise exception '已修繕的缺失至少要留一張修繕後照片';
  end if;
  new.deleted_at := now(); new.deleted_by := auth.uid();
  return new;
end $$;
drop trigger if exists defect_photos_guard on public.defect_photos;
create trigger defect_photos_guard before update on public.defect_photos
  for each row execute function public.guard_photo();

-- 異動紀錄也記照片刪除／還原
create or replace function public.log_photo_soft() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is distinct from old.deleted_at then
    insert into public.defect_logs (defect_id, action, changes)
    values (new.defect_id, case when new.deleted_at is null then '還原照片' else '刪除照片' end,
            jsonb_build_object('kind', new.kind, 'path', new.path));
  end if;
  return new;
end $$;
drop trigger if exists defect_photos_log_soft on public.defect_photos;
create trigger defect_photos_log_soft after update on public.defect_photos
  for each row execute function public.log_photo_soft();

-- 狀態檢查改成只算沒被刪除的照片（其餘規則同 9_不修複驗.sql）
create or replace function public.guard_defect() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); adm boolean := public.is_admin(); vend bigint := public.my_vendor();
        fd date; st text; sign boolean;
begin
  if me is null then return new; end if;   -- 在 SQL Editor 由管理者直接執行時不檢查

  if tg_op = 'INSERT' then
    if vend is not null then raise exception '廠商帳號不能新增缺失'; end if;
    new.status := 'todo'; new.close_type := null; new.close_reason := null; new.fixed_date := null;
    new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
    new.verified_by := null; new.verified_at := null; new.signed_name := null; new.signed_date := null;
    new.created_by := me; new.created_at := now(); new.updated_by := null; new.updated_at := now();
    return new;
  end if;

  if vend is not null then
    if new.status is distinct from old.status and not (old.status = 'todo' and new.status = 'fixed') then
      raise exception '廠商帳號只能回報修繕完成';
    end if;
    fd := new.fixed_date; st := new.status;
    new := old; new.fixed_date := fd; new.status := st;
  end if;

  -- 不能改的欄位：建立者、建立時間、案場／檢查類型／棟／樓／戶
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.site_id := old.site_id; new.inspect_type_id := old.inspect_type_id;
  new.building_id := old.building_id; new.floor := old.floor; new.unit_id := old.unit_id;
  new.fixed_by := old.fixed_by; new.fixed_at := old.fixed_at;
  new.closed_by := old.closed_by; new.closed_at := old.closed_at;
  new.verified_by := old.verified_by; new.verified_at := old.verified_at;
  select coalesce(need_sign, false) into sign from public.inspect_types where id = old.inspect_type_id;

  if new.status is distinct from old.status then
    if old.status = 'todo' and new.status = 'fixed' and new.close_type = '不修' then   -- 提出不修，等複驗確認
      if coalesce(btrim(new.close_reason), '') = '' then raise exception '不修要填原因'; end if;
      new.fixed_date := null; new.fixed_by := me; new.fixed_at := now();
    elsif old.status = 'todo' and new.status = 'fixed' then
      if not exists (select 1 from public.defect_photos where defect_id = new.id and kind = 'after' and deleted_at is null) then
        raise exception '要先上傳修繕後照片，才能標示修繕完成';
      end if;
      new.close_type := null; new.close_reason := null;
      new.fixed_date := coalesce(new.fixed_date, current_date);
      new.fixed_by := me; new.fixed_at := now();
    elsif old.status = 'fixed' and new.status = 'signing' and sign then      -- 複驗確認（修好或同意不修），等客戶簽認
      new.close_type := old.close_type; new.close_reason := old.close_reason; new.verified_by := me; new.verified_at := now();
    elsif old.status = 'fixed' and new.status = 'closed' and not sign then   -- 複驗確認，結案
      new.close_type := coalesce(old.close_type, '複驗合格'); new.close_reason := old.close_reason;
      new.verified_by := me; new.verified_at := now(); new.closed_by := me; new.closed_at := now();
    elsif old.status = 'signing' and new.status = 'closed' then   -- 客戶簽認，結案
      if not exists (select 1 from public.defect_photos where defect_id = new.id and kind = 'sign' and deleted_at is null
                     and created_at >= coalesce(old.verified_at, '-infinity')) then   -- 要這一輪複驗後的簽名
        raise exception '請客戶在簽名板簽名';
      end if;
      new.signed_date := coalesce(new.signed_date, current_date);
      new.close_type := coalesce(old.close_type, '複驗合格'); new.close_reason := old.close_reason;
      new.closed_by := me; new.closed_at := now();
    elsif old.status in ('fixed','signing') and new.status = 'todo' then     -- 複驗不合格／客戶不認可，退回待修
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.verified_by := null; new.verified_at := null;
      new.signed_name := null; new.signed_date := null;
    elsif old.status = 'closed' and new.status = 'todo' and adm then
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
      new.verified_by := null; new.verified_at := null; new.signed_name := null; new.signed_date := null;
    else
      raise exception '不允許的狀態變更：% → %', old.status, new.status;
    end if;
  else
    new.close_type := old.close_type;
    if old.close_type = '不修' and coalesce(btrim(new.close_reason), '') = '' then
      new.close_reason := old.close_reason;
    end if;
  end if;

  new.updated_at := now(); new.updated_by := me;
  return new;
end $$;

-- ========== 22_匯入紀錄與轉檔權限 ==========
-- 22_匯入紀錄與轉檔權限.sql
-- 1. 設定 Excel 匯入批次紀錄：誰、什麼時候、哪個檔、是否完整同步、各表新增／修改／刪除／停用了哪些。
-- 2. 報告轉檔權限分離：AI 轉檔結果只有「轉檔機器人」帳號能寫；同事只能重新排隊、要求立即轉檔、確認匯入。
-- 3. 確認匯入改成一次完成：缺失全部寫入後才標記「已匯入」，中途失敗就一筆都不寫，也不會被兩個人重複匯入。
-- 執行後請把轉檔機器人帳號標記起來（Email 換成機器人用的那個）：
--   update public.profiles set is_bot = true where email = '機器人的 Email';
-- 還沒標記機器人之前，轉檔照舊可以跑（相容模式）。可重複執行。

-- ---------- 1. 設定匯入紀錄 ----------
create table if not exists public.settings_import_logs (
  id bigint generated always as identity primary key,
  site_id bigint references public.sites(id),
  file_name text,
  full_sync boolean not null default false,
  summary jsonb not null default '[]'::jsonb,
  by_user uuid default auth.uid() references auth.users(id),
  at timestamptz not null default now()
);
grant select, insert on public.settings_import_logs to authenticated;
alter table public.settings_import_logs enable row level security;
drop policy if exists settings_import_logs_read on public.settings_import_logs;
drop policy if exists settings_import_logs_insert on public.settings_import_logs;
create policy settings_import_logs_read on public.settings_import_logs for select to authenticated using (public.is_admin());
create policy settings_import_logs_insert on public.settings_import_logs for insert to authenticated
  with check (public.is_admin() and by_user = auth.uid());
-- 不開放修改、刪除

-- ---------- 2. 轉檔機器人 ----------
alter table public.profiles add column if not exists is_bot boolean not null default false;

create or replace function public.guard_report_job() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); bot boolean; anybot boolean;
begin
  if me is null then return new; end if;                                   -- SQL Editor
  if current_setting('app.report_import', true) = 'on' then return new; end if;   -- 由 import_report_job 標記已匯入
  select coalesce(is_bot, false) into bot from public.profiles where id = me;
  anybot := exists (select 1 from public.profiles where is_bot and active);
  -- 不論誰都不能改：檔案、案場、上傳者
  new.site_id := old.site_id; new.path := old.path; new.file_name := old.file_name;
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.imported_by := old.imported_by; new.imported_at := old.imported_at;
  if new.status = 'imported' and old.status <> 'imported' then
    raise exception '請在畫面上按「確認匯入」';
  end if;
  if bot or not anybot then                        -- 機器人（或還沒指定機器人的相容模式）
    if bot and new.status is distinct from old.status
       and not (old.status in ('pending','processing') and new.status in ('processing','done','error')) then
      raise exception '轉檔機器人不能把狀態從 % 改成 %', old.status, new.status;
    end if;
    return new;
  end if;
  -- 一般同事：AI 結果、提醒、轉檔時間都不能改
  new.result := old.result; new.processed_at := old.processed_at;
  if new.status is distinct from old.status then
    if old.status = 'error' and new.status = 'pending' then new.message := null;   -- 重新排隊
    else raise exception '轉檔狀態只能由轉檔機器人更新'; end if;
  else
    new.message := old.message;
  end if;
  return new;
end $$;
drop trigger if exists report_jobs_guard on public.report_jobs;
create trigger report_jobs_guard before update on public.report_jobs
  for each row execute function public.guard_report_job();

-- ---------- 3. 確認匯入（一次完成） ----------
-- p_rows：[{inspect_type_id, building_id, floor, unit_id, space_id, category_id, item_id, repair_method_id,
--           fix_vendor_id, resp_vendor_id, description}, …]；回傳新缺失的編號（同順序），照片由網頁接著上傳。
create or replace function public.import_report_job(p_job bigint, p_rows jsonb) returns bigint[]
language plpgsql security invoker set search_path = public as $$
declare j record; r jsonb; nid bigint; ids bigint[] := '{}';
begin
  if not public.is_staff() then raise exception '只有內部人員可以匯入'; end if;
  select * into j from public.report_jobs where id = p_job for update;
  if not found then raise exception '找不到這份報告'; end if;
  if j.status = 'imported' then raise exception '這份報告已經匯入過了'; end if;
  if j.status <> 'done' then raise exception '這份報告還沒轉檔完成'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception '沒有要匯入的缺失'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.defects (site_id, inspect_type_id, building_id, floor, unit_id, space_id, category_id, item_id,
                                repair_method_id, fix_vendor_id, resp_vendor_id, description, status, created_by)
    values (j.site_id, (r->>'inspect_type_id')::bigint, (r->>'building_id')::bigint, r->>'floor', (r->>'unit_id')::bigint,
            (r->>'space_id')::bigint, (r->>'category_id')::bigint, (r->>'item_id')::bigint, (r->>'repair_method_id')::bigint,
            (r->>'fix_vendor_id')::bigint, (r->>'resp_vendor_id')::bigint, r->>'description', 'todo', auth.uid())
    returning id into nid;
    ids := ids || nid;
  end loop;
  perform set_config('app.report_import', 'on', true);
  update public.report_jobs set status = 'imported', imported_by = auth.uid(), imported_at = now() where id = p_job;
  perform set_config('app.report_import', 'off', true);
  return ids;
end $$;
grant execute on function public.import_report_job(bigint, jsonb) to authenticated;

-- ========== 23_案場權限 ==========
-- 23_案場權限.sql
-- 每個帳號只看得到被開通的案場：案場、棟別、戶別、平面圖、缺失、照片、異動紀錄、報告轉檔、照片與平面圖檔案都照這個規則。
-- 管理者看得到全部案場。清單（檢查類型、工項、缺失內容、空間別、廠商、修繕方式）仍是各案場共用。
-- 執行時會把「現有的每個帳號」開通到「現有的每個案場」，所以跑完不會有人突然看不到資料。
-- 之後在後台「帳號」逐人勾選可用案場。需先執行 20、21、22。可重複執行。

create table if not exists public.user_sites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  site_id bigint not null references public.sites(id) on delete cascade,
  granted_by uuid default auth.uid(),
  granted_at timestamptz not null default now(),
  primary key (user_id, site_id)
);
-- 第一次執行：現有帳號 × 現有案場全部開通（之後重跑不會把管理者取消的再加回來）
do $$ begin
  if not exists (select 1 from public.user_sites) then
    insert into public.user_sites (user_id, site_id) select p.id, s.id from public.profiles p cross join public.sites s;
  end if;
end $$;

grant select, insert, delete on public.user_sites to authenticated;
alter table public.user_sites enable row level security;
drop policy if exists user_sites_read on public.user_sites;
drop policy if exists user_sites_write on public.user_sites;
create policy user_sites_read on public.user_sites for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy user_sites_write on public.user_sites for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.has_site(sid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.is_active_user() and exists (
    select 1 from public.user_sites where user_id = auth.uid() and site_id = sid))
$$;
create or replace function public.can_see_defect(did bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.defects d where d.id = did and public.has_site(d.site_id)
                 and (public.is_staff() or d.fix_vendor_id = public.my_vendor()))
$$;
grant execute on function public.has_site(bigint), public.can_see_defect(bigint) to authenticated;

-- 案場與現場結構
drop policy if exists sites_read on public.sites;
create policy sites_read on public.sites for select to authenticated using (public.has_site(id));
drop policy if exists buildings_read on public.buildings;
create policy buildings_read on public.buildings for select to authenticated using (public.has_site(site_id));
drop policy if exists units_read on public.units;
create policy units_read on public.units for select to authenticated
  using (exists (select 1 from public.buildings b where b.id = building_id and public.has_site(b.site_id)));
drop policy if exists unit_spaces_read on public.unit_spaces;
create policy unit_spaces_read on public.unit_spaces for select to authenticated
  using (exists (select 1 from public.units u join public.buildings b on b.id = u.building_id where u.id = unit_id and public.has_site(b.site_id)));
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated
  using (exists (select 1 from public.units u join public.buildings b on b.id = u.building_id where u.id = unit_id and public.has_site(b.site_id)));
drop policy if exists plan_spaces_read on public.plan_spaces;
create policy plan_spaces_read on public.plan_spaces for select to authenticated
  using (exists (select 1 from public.plans p join public.units u on u.id = p.unit_id join public.buildings b on b.id = u.building_id
                 where p.id = plan_id and public.has_site(b.site_id)));

-- 缺失、照片、異動紀錄
drop policy if exists defects_read on public.defects;
drop policy if exists defects_insert on public.defects;
drop policy if exists defects_update on public.defects;
create policy defects_read on public.defects for select to authenticated
  using (public.has_site(site_id) and (public.is_staff() or fix_vendor_id = public.my_vendor()));
create policy defects_insert on public.defects for insert to authenticated
  with check (public.is_staff() and public.has_site(site_id) and created_by = auth.uid());
create policy defects_update on public.defects for update to authenticated
  using (public.has_site(site_id) and (public.is_staff() or fix_vendor_id = public.my_vendor()))
  with check (public.has_site(site_id) and (public.is_staff() or fix_vendor_id = public.my_vendor()));
-- photos_read 已經是 can_see_defect，跟著上面的新定義
drop policy if exists defect_logs_read on public.defect_logs;
create policy defect_logs_read on public.defect_logs for select to authenticated
  using (public.can_see_defect(defect_id) or public.is_admin());   -- 已刪除缺失的紀錄只有管理者看得到

-- 報告轉檔
drop policy if exists report_jobs_read on public.report_jobs;
drop policy if exists report_jobs_insert on public.report_jobs;
drop policy if exists report_jobs_update on public.report_jobs;
create policy report_jobs_read on public.report_jobs for select to authenticated using (public.is_staff() and public.has_site(site_id));
create policy report_jobs_insert on public.report_jobs for insert to authenticated
  with check (public.is_staff() and public.has_site(site_id) and created_by = auth.uid());
create policy report_jobs_update on public.report_jobs for update to authenticated
  using (public.is_staff() and public.has_site(site_id)) with check (public.is_staff() and public.has_site(site_id));

-- 檔案：照片、平面圖、報告都要能對到使用者看得到的那筆資料
drop policy if exists storage_photos_read on storage.objects;
create policy storage_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and exists (select 1 from public.defects d
         where d.id::text = (storage.foldername(name))[1] and public.can_see_defect(d.id)));
drop policy if exists storage_plans_read on storage.objects;
create policy storage_plans_read on storage.objects for select to authenticated
  using (bucket_id = 'plans' and (public.is_admin() or exists (select 1 from public.plans p
         join public.units u on u.id = p.unit_id join public.buildings b on b.id = u.building_id
         where p.path = storage.objects.name and public.has_site(b.site_id))));
drop policy if exists storage_reports_read on storage.objects;
create policy storage_reports_read on storage.objects for select to authenticated
  using (bucket_id = 'reports' and public.is_staff() and exists (select 1 from public.report_jobs j
         where split_part(j.path, '/', 1) = (storage.foldername(name))[1] and public.has_site(j.site_id)));

-- ========== 24_簽認紀錄 ==========
-- 24_簽認紀錄.sql
-- 每次客戶簽名（單筆或整戶）都留一筆簽認紀錄：當時涵蓋哪些缺失、每筆的內容、簽認人、日期、簽名圖。
-- 之後這戶有新增或重新開案的缺失，填寫頁會提示「需要重新簽認」。紀錄只能新增、不能改或刪。
-- 需先執行 23_案場權限.sql。可重複執行。

create table if not exists public.sign_records (
  id bigint generated always as identity primary key,
  site_id bigint not null references public.sites(id),
  inspect_type_id bigint references public.inspect_types(id),
  unit_id bigint references public.units(id),
  floor text,
  defect_ids bigint[] not null default '{}',
  snapshot jsonb not null default '[]'::jsonb,     -- [{id, 編號, 空間, 工項, 缺失內容, 說明, 結案方式}]
  signed_name text,
  signed_date date,
  sign_path text,                                   -- 簽名圖（photos 儲存空間）
  by_user uuid default auth.uid() references auth.users(id),
  at timestamptz not null default now()
);
create index if not exists sign_records_unit_idx on public.sign_records (unit_id, inspect_type_id, at desc);

grant select, insert on public.sign_records to authenticated;
alter table public.sign_records enable row level security;
drop policy if exists sign_records_read on public.sign_records;
drop policy if exists sign_records_insert on public.sign_records;
create policy sign_records_read on public.sign_records for select to authenticated
  using (public.is_staff() and public.has_site(site_id));
create policy sign_records_insert on public.sign_records for insert to authenticated
  with check (public.is_staff() and public.has_site(site_id) and by_user = auth.uid());
