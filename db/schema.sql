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
