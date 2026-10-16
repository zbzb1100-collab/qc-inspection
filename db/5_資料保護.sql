-- 5_資料保護：缺失的狀態流程與稽核欄位改由資料庫把關（不只靠畫面）
-- 貼到 Supabase SQL Editor 按 Run。可重複執行。

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
