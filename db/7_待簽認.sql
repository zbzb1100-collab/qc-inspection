-- 7_待簽認：指定的檢查類型在「複驗合格」後多一關「待簽認」，客戶簽認後才結案
-- 需先執行過 5、6。貼到 Supabase SQL Editor 按 Run，可重複執行。

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
