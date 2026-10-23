-- 25_重新開案免重簽.sql
-- 需簽認的檢查類型：客戶已經簽過名的缺失（重新開案回來的），複驗合格就直接結案，不用再請客戶簽一次；
-- 原本的簽認人、簽認日期保留。還沒簽過的照舊 複驗合格 → 待簽認 → 客戶簽名結案。
-- 需先執行 21。可重複執行。

create or replace function public.guard_defect() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); adm boolean := public.is_admin(); vend bigint := public.my_vendor();
        fd date; st text; sign boolean; signed boolean;
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
  -- 客戶已經簽過名（重新開案回來的）：複驗合格直接結案，不用再簽
  signed := sign and exists (select 1 from public.defect_photos where defect_id = old.id and kind = 'sign' and deleted_at is null);

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
    elsif old.status = 'fixed' and new.status = 'closed' and (not sign or signed) then   -- 複驗確認，結案（簽過的不用再簽）
      new.close_type := coalesce(old.close_type, '複驗合格'); new.close_reason := old.close_reason;
      new.verified_by := me; new.verified_at := now(); new.closed_by := me; new.closed_at := now();
      if signed then new.signed_name := old.signed_name; new.signed_date := old.signed_date; end if;
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
      if not signed then new.signed_name := null; new.signed_date := null; end if;
    elsif old.status = 'closed' and new.status = 'todo' and adm then
      new.close_type := null; new.close_reason := null; new.fixed_date := null;
      new.fixed_by := null; new.fixed_at := null; new.closed_by := null; new.closed_at := null;
      new.verified_by := null; new.verified_at := null;
      if not signed then new.signed_name := null; new.signed_date := null; end if;   -- 簽過的保留簽認人
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
