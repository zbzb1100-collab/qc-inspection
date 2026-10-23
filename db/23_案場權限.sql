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
