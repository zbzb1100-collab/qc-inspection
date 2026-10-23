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
