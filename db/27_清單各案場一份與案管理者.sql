-- 27_清單各案場一份與案管理者.sql
-- 1. 檢查類型、空間別、工項、缺失內容、工項預設廠商、修繕方式改成「各案場一份」，改了只影響那個案場。
--    第一次執行時：現有清單歸給缺失最多的案場（武東二段）；其他已建的案場各複製一份，那些案場原本的缺失、戶別空間、平面圖空間標記會改指到自己那份。
--    廠商名單仍是全公司共用。
-- 2. 管理者分兩種：
--    總管理者（帳號角色「管理者」）：所有案場都能管，開案場、改廠商名稱／合併、指定案管理者。
--    案管理者（帳號頁在某個案場勾「案管理者」）：只能改那個案場的後台、重新開案、還原照片；可以開通申請帳號、把人加進或移出自己的案場。
-- 需先執行 20~26。執行前請先備份（Database → Backups）。可重複執行。

-- ---------- 案管理者 ----------
alter table public.user_sites add column if not exists is_admin boolean not null default false;
grant update on public.user_sites to authenticated;

create or replace function public.is_site_admin(sid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.user_sites us join public.profiles p on p.id = us.user_id
    where us.user_id = auth.uid() and us.site_id = sid and us.is_admin and p.active and p.role = 'user')
$$;
create or replace function public.is_any_site_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.user_sites us join public.profiles p on p.id = us.user_id
    where us.user_id = auth.uid() and us.is_admin and p.active and p.role = 'user')
$$;
create or replace function public.unit_site(uid bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select b.site_id from public.units u join public.buildings b on b.id = u.building_id where u.id = uid
$$;
-- 案管理者能管的帳號：不是總管理者、不是自己，而且這個人目前的案場全都是我當案管理者的（或還沒有任何案場，例如待開通）
create or replace function public.can_manage_user(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (uid <> auth.uid() and public.is_any_site_admin()
    and exists (select 1 from public.profiles where id = uid and role <> 'admin')
    and not exists (select 1 from public.user_sites us where us.user_id = uid and not public.is_site_admin(us.site_id)))
$$;
grant execute on function public.is_site_admin(bigint), public.is_any_site_admin(), public.unit_site(bigint), public.can_manage_user(uuid) to authenticated;

-- ---------- 清單加上案場 ----------
alter table public.inspect_types add column if not exists site_id bigint references public.sites(id) on delete cascade;
alter table public.categories add column if not exists site_id bigint references public.sites(id) on delete cascade;
alter table public.repair_methods add column if not exists site_id bigint references public.sites(id) on delete cascade;
alter table public.spaces add column if not exists site_id bigint references public.sites(id) on delete cascade;
alter table public.items add column if not exists site_id bigint references public.sites(id) on delete cascade;
alter table public.category_vendors add column if not exists site_id bigint references public.sites(id) on delete cascade;
-- 名稱改成同一案場內不能重複（不同案場可以同名）
alter table public.inspect_types drop constraint if exists inspect_types_name_key;
alter table public.categories drop constraint if exists categories_name_key;
alter table public.repair_methods drop constraint if exists repair_methods_name_key;

-- 把 src 案場的清單複製一份給 dst 案場，並把 dst 案場的缺失、戶別空間、平面圖空間標記改指到新的那份
create or replace function public.copy_site_lists(src bigint, dst bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  create temp table if not exists _m (t text, old_id bigint, new_id bigint) on commit drop;
  delete from _m;
  insert into public.inspect_types (site_id, name, sort, active, need_sign, zone_ids)
    select dst, name, sort, active, need_sign, zone_ids from public.inspect_types where site_id = src;
  insert into _m select 't', a.id, b.id from public.inspect_types a join public.inspect_types b on b.site_id = dst and b.name = a.name where a.site_id = src;
  insert into public.categories (site_id, name, sort, active, zone_ids)
    select dst, name, sort, active, zone_ids from public.categories where site_id = src;
  insert into _m select 'c', a.id, b.id from public.categories a join public.categories b on b.site_id = dst and b.name = a.name where a.site_id = src;
  insert into public.repair_methods (site_id, name, sort, active)
    select dst, name, sort, active from public.repair_methods where site_id = src;
  insert into _m select 'r', a.id, b.id from public.repair_methods a join public.repair_methods b on b.site_id = dst and b.name = a.name where a.site_id = src;
  insert into public.spaces (site_id, inspect_type_id, code, name, sort, active, zone_ids)
    select dst, m.new_id, s.code, s.name, s.sort, s.active, s.zone_ids from public.spaces s join _m m on m.t = 't' and m.old_id = s.inspect_type_id where s.site_id = src;
  insert into _m select 's', a.id, b.id from public.spaces a join _m m on m.t = 't' and m.old_id = a.inspect_type_id
    join public.spaces b on b.site_id = dst and b.inspect_type_id = m.new_id and b.name = a.name where a.site_id = src;
  insert into public.items (site_id, category_id, name, sort, active, zone_ids, zone_id)
    select dst, m.new_id, i.name, i.sort, i.active, i.zone_ids, i.zone_id from public.items i join _m m on m.t = 'c' and m.old_id = i.category_id where i.site_id = src;
  insert into _m select 'i', a.id, b.id from public.items a join _m m on m.t = 'c' and m.old_id = a.category_id
    join public.items b on b.site_id = dst and b.category_id = m.new_id and b.name = a.name and b.zone_id is not distinct from a.zone_id where a.site_id = src;
  insert into public.category_vendors (site_id, category_id, vendor_id, sort)
    select dst, m.new_id, cv.vendor_id, cv.sort from public.category_vendors cv join _m m on m.t = 'c' and m.old_id = cv.category_id where cv.site_id = src;
  -- dst 案場原本指到共用清單的資料，改指到自己那份
  update public.defects d set
    inspect_type_id = coalesce((select new_id from _m where t = 't' and old_id = d.inspect_type_id), d.inspect_type_id),
    category_id = coalesce((select new_id from _m where t = 'c' and old_id = d.category_id), d.category_id),
    repair_method_id = coalesce((select new_id from _m where t = 'r' and old_id = d.repair_method_id), d.repair_method_id),
    space_id = coalesce((select new_id from _m where t = 's' and old_id = d.space_id), d.space_id),
    item_id = coalesce((select new_id from _m where t = 'i' and old_id = d.item_id), d.item_id)
  where d.site_id = dst;
  update public.report_jobs j set inspect_type_id = coalesce((select new_id from _m where t = 't' and old_id = j.inspect_type_id), j.inspect_type_id)
  where j.site_id = dst;
  insert into public.unit_spaces (unit_id, space_id)
    select us.unit_id, m.new_id from public.unit_spaces us join _m m on m.t = 's' and m.old_id = us.space_id
    where public.unit_site(us.unit_id) = dst on conflict do nothing;
  delete from public.unit_spaces us using _m m where m.t = 's' and m.old_id = us.space_id and public.unit_site(us.unit_id) = dst;
  update public.plan_spaces ps set space_id = m.new_id from _m m, public.plans p
    where m.t = 's' and m.old_id = ps.space_id and p.id = ps.plan_id and public.unit_site(p.unit_id) = dst;
end $$;
revoke all on function public.copy_site_lists(bigint, bigint) from public, authenticated;

-- 第一次執行：現有清單歸給缺失最多的案場，其他案場各複製一份（搬資料時暫停缺失的檢查與異動紀錄）
do $$
declare h bigint; st record;
begin
  if not exists (select 1 from public.inspect_types where site_id is null)
     and not exists (select 1 from public.categories where site_id is null)
     and not exists (select 1 from public.repair_methods where site_id is null) then return; end if;
  select id into h from public.sites order by (select count(*) from public.defects d where d.site_id = sites.id) desc, sort, id limit 1;
  if h is null then return; end if;
  update public.inspect_types set site_id = h where site_id is null;
  update public.categories set site_id = h where site_id is null;
  update public.repair_methods set site_id = h where site_id is null;
  update public.spaces s set site_id = t.site_id from public.inspect_types t where t.id = s.inspect_type_id and s.site_id is null;
  update public.items i set site_id = c.site_id from public.categories c where c.id = i.category_id and i.site_id is null;
  update public.category_vendors cv set site_id = c.site_id from public.categories c where c.id = cv.category_id and cv.site_id is null;
  alter table public.defects disable trigger user;
  for st in select id from public.sites where id <> h loop
    perform public.copy_site_lists(h, st.id);
  end loop;
  alter table public.defects enable trigger user;
end $$;

alter table public.inspect_types alter column site_id set not null;
alter table public.categories alter column site_id set not null;
alter table public.repair_methods alter column site_id set not null;
alter table public.spaces alter column site_id set not null;
alter table public.items alter column site_id set not null;
alter table public.category_vendors alter column site_id set not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'inspect_types_site_name_key') then
    alter table public.inspect_types add constraint inspect_types_site_name_key unique (site_id, name); end if;
  if not exists (select 1 from pg_constraint where conname = 'categories_site_name_key') then
    alter table public.categories add constraint categories_site_name_key unique (site_id, name); end if;
  if not exists (select 1 from pg_constraint where conname = 'repair_methods_site_name_key') then
    alter table public.repair_methods add constraint repair_methods_site_name_key unique (site_id, name); end if;
end $$;

-- 缺失內容、工項預設廠商跟著工項的案場；空間別沒給案場就跟著檢查類型
create or replace function public.list_site_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name in ('items', 'category_vendors') then
    select site_id into new.site_id from public.categories where id = new.category_id;
  elsif tg_table_name = 'spaces' and new.site_id is null then
    select site_id into new.site_id from public.inspect_types where id = new.inspect_type_id;
  end if;
  return new;
end $$;
drop trigger if exists items_site on public.items;
create trigger items_site before insert or update on public.items for each row execute function public.list_site_follow();
drop trigger if exists category_vendors_site on public.category_vendors;
create trigger category_vendors_site before insert or update on public.category_vendors for each row execute function public.list_site_follow();
drop trigger if exists spaces_site on public.spaces;
create trigger spaces_site before insert or update on public.spaces for each row execute function public.list_site_follow();

-- 缺失選的檢查類型、空間、工項、缺失內容、修繕方式都要是這個案場的
create or replace function public.check_defect_site() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.inspect_type_id is not null and not exists (select 1 from public.inspect_types where id = new.inspect_type_id and site_id = new.site_id))
     or (new.space_id is not null and not exists (select 1 from public.spaces where id = new.space_id and site_id = new.site_id))
     or (new.category_id is not null and not exists (select 1 from public.categories where id = new.category_id and site_id = new.site_id))
     or (new.item_id is not null and not exists (select 1 from public.items where id = new.item_id and site_id = new.site_id))
     or (new.repair_method_id is not null and not exists (select 1 from public.repair_methods where id = new.repair_method_id and site_id = new.site_id)) then
    raise exception '選的項目不屬於這個案場，請重新整理頁面再選一次';
  end if;
  return new;
end $$;
drop trigger if exists defects_site_check on public.defects;
create trigger defects_site_check before insert or update on public.defects for each row execute function public.check_defect_site();

-- ---------- 清單與現場結構的權限 ----------
do $$
declare t text;
begin
  foreach t in array array['inspect_types','categories','repair_methods','spaces','items','category_vendors','buildings'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('drop policy if exists %I on public.%I', t||'_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_site(site_id))', t||'_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_site_admin(site_id)) with check (public.is_site_admin(site_id))', t||'_write', t);
  end loop;
end $$;
drop policy if exists units_write on public.units;
create policy units_write on public.units for all to authenticated
  using (public.is_site_admin((select site_id from public.buildings where id = building_id)))
  with check (public.is_site_admin((select site_id from public.buildings where id = building_id)));
drop policy if exists unit_spaces_write on public.unit_spaces;
create policy unit_spaces_write on public.unit_spaces for all to authenticated
  using (public.is_site_admin(public.unit_site(unit_id))) with check (public.is_site_admin(public.unit_site(unit_id)));
drop policy if exists plans_write on public.plans;
create policy plans_write on public.plans for all to authenticated
  using (public.is_site_admin(public.unit_site(unit_id))) with check (public.is_site_admin(public.unit_site(unit_id)));
drop policy if exists plan_spaces_write on public.plan_spaces;
create policy plan_spaces_write on public.plan_spaces for all to authenticated
  using (public.is_site_admin((select public.unit_site(unit_id) from public.plans where id = plan_id)))
  with check (public.is_site_admin((select public.unit_site(unit_id) from public.plans where id = plan_id)));
-- 平面圖檔名開頭是 u<戶別編號>-
drop policy if exists storage_plans_write on storage.objects;
create policy storage_plans_write on storage.objects for all to authenticated
  using (bucket_id = 'plans' and (public.is_admin() or public.is_site_admin(public.unit_site(nullif(substring(name from '^u([0-9]+)-'), '')::bigint))))
  with check (bucket_id = 'plans' and (public.is_admin() or public.is_site_admin(public.unit_site(nullif(substring(name from '^u([0-9]+)-'), '')::bigint))));
-- 廠商：全公司共用；案管理者可以新增，改名、合併、刪除只有總管理者
drop policy if exists vendors_write on public.vendors;
drop policy if exists vendors_insert on public.vendors;
drop policy if exists vendors_change on public.vendors;
create policy vendors_insert on public.vendors for insert to authenticated with check (public.is_any_site_admin());
create policy vendors_change on public.vendors for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- 缺失、照片：管理動作改成「這個案場的管理者」 ----------
drop policy if exists defects_delete on public.defects;
create policy defects_delete on public.defects for delete to authenticated using (public.is_site_admin(site_id));
drop policy if exists photos_update on public.defect_photos;
create policy photos_update on public.defect_photos for update to authenticated
  using (created_by = auth.uid() or public.is_site_admin((select site_id from public.defects where id = defect_id)))
  with check (created_by = auth.uid() or public.is_site_admin((select site_id from public.defects where id = defect_id)));
drop policy if exists storage_photos_delete on storage.objects;
create policy storage_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (public.is_any_site_admin() or owner = auth.uid()) and not exists (
    select 1 from public.defect_photos p where p.path = storage.objects.name));

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
    if not public.is_site_admin(old.site_id) then raise exception '只有管理者可以重新開案'; end if;
    if coalesce(btrim(new.reopen_reason), '') = '' then raise exception '重新開案要填原因'; end if;
    return new;
  end if;
  raise exception '已結案的缺失不能修改，要修改請管理者重新開案';
end $$;

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
    if not public.is_site_admin(d.site_id) then raise exception '只有管理者可以還原照片'; end if;
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

-- 狀態檢查：重新開案改成這個案場的管理者（其餘同 25）
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
    elsif old.status = 'closed' and new.status = 'todo' and public.is_site_admin(old.site_id) then   -- 總管理者或這個案場的案管理者
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

-- ---------- 帳號 ----------
-- 案管理者看得到自己案場的人員名單；開通、加入／移出自己的案場；只有總管理者能指定案管理者
drop policy if exists user_sites_read on public.user_sites;
drop policy if exists user_sites_write on public.user_sites;
drop policy if exists user_sites_insert on public.user_sites;
drop policy if exists user_sites_delete on public.user_sites;
drop policy if exists user_sites_update on public.user_sites;
create policy user_sites_read on public.user_sites for select to authenticated
  using (user_id = auth.uid() or public.is_site_admin(site_id));
create policy user_sites_insert on public.user_sites for insert to authenticated
  with check (public.is_admin() or (public.is_site_admin(site_id) and not is_admin
    and exists (select 1 from public.profiles where id = user_id and role <> 'admin')));
create policy user_sites_delete on public.user_sites for delete to authenticated
  using (public.is_admin() or (public.is_site_admin(site_id) and not is_admin and user_id <> auth.uid()));
create policy user_sites_update on public.user_sites for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists profiles_site_admin on public.profiles;
create policy profiles_site_admin on public.profiles for update to authenticated
  using (public.can_manage_user(id)) with check (public.can_manage_user(id));
-- 案管理者不能把人設成管理者，也不能改 Email、轉檔機器人標記
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.role = 'admin' then raise exception '只有總管理者可以把人設成管理者'; end if;
  new.id := old.id; new.email := old.email; new.is_bot := old.is_bot;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile();

drop policy if exists user_vendors_write on public.user_vendors;
create policy user_vendors_write on public.user_vendors for all to authenticated
  using (public.can_manage_user(user_id)) with check (public.can_manage_user(user_id));

-- 設定匯入紀錄：各案場的管理者看自己案場的
drop policy if exists settings_import_logs_read on public.settings_import_logs;
drop policy if exists settings_import_logs_insert on public.settings_import_logs;
create policy settings_import_logs_read on public.settings_import_logs for select to authenticated using (public.is_site_admin(site_id));
create policy settings_import_logs_insert on public.settings_import_logs for insert to authenticated
  with check (public.is_site_admin(site_id) and by_user = auth.uid());
