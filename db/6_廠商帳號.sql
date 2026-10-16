-- 6_廠商帳號：給修繕廠商的帳號，只看得到自己是「修繕廠商」的缺失，只能上傳修繕後照片並按「修繕完成」
-- 需先執行過 5_資料保護.sql。貼到 Supabase SQL Editor 按 Run，可重複執行。

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
