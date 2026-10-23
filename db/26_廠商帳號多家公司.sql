-- 26_廠商帳號多家公司.sql
-- 同一批人用不同公司名接案：一個廠商帳號除了主要的公司，還可以加「其他公司名」，
-- 登入後看得到修繕廠商是這幾家公司的缺失（仍只限勾選的可用案場）。報表、扣款照樣分公司名。
-- 需先執行 23。可重複執行。

create table if not exists public.user_vendors (
  user_id uuid not null references public.profiles(id) on delete cascade,
  vendor_id bigint not null references public.vendors(id) on delete cascade,
  primary key (user_id, vendor_id)
);
grant select, insert, delete on public.user_vendors to authenticated;
alter table public.user_vendors enable row level security;
drop policy if exists user_vendors_read on public.user_vendors;
drop policy if exists user_vendors_write on public.user_vendors;
create policy user_vendors_read on public.user_vendors for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy user_vendors_write on public.user_vendors for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 這家公司是不是目前登入的廠商帳號的（主要公司或其他公司名）
create or replace function public.is_my_vendor(vid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select vid is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'vendor'
    and (p.vendor_id = vid or exists (select 1 from public.user_vendors uv where uv.user_id = p.id and uv.vendor_id = vid)))
$$;
create or replace function public.can_see_defect(did bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.defects d where d.id = did and public.has_site(d.site_id)
                 and (public.is_staff() or public.is_my_vendor(d.fix_vendor_id)))
$$;
grant execute on function public.is_my_vendor(bigint), public.can_see_defect(bigint) to authenticated;

drop policy if exists defects_read on public.defects;
drop policy if exists defects_update on public.defects;
create policy defects_read on public.defects for select to authenticated
  using (public.has_site(site_id) and (public.is_staff() or public.is_my_vendor(fix_vendor_id)));
create policy defects_update on public.defects for update to authenticated
  using (public.has_site(site_id) and (public.is_staff() or public.is_my_vendor(fix_vendor_id)))
  with check (public.has_site(site_id) and (public.is_staff() or public.is_my_vendor(fix_vendor_id)));

drop policy if exists storage_photos_insert on storage.objects;
create policy storage_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_active_user() and exists (select 1 from public.defects d
         where d.id::text = (storage.foldername(name))[1] and (public.is_staff() or public.is_my_vendor(d.fix_vendor_id))));
