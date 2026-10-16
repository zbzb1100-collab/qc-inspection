-- 品質查驗系統：每戶有哪些空間別（新增資料表）。貼到 Supabase 左側 SQL Editor，按 Run。可重複執行。
create table if not exists public.unit_spaces (
  unit_id bigint not null references public.units(id) on delete cascade,
  space_id bigint not null references public.spaces(id) on delete cascade,
  primary key (unit_id, space_id)
);
grant select, insert, update, delete on public.unit_spaces to authenticated;
alter table public.unit_spaces enable row level security;
drop policy if exists unit_spaces_read on public.unit_spaces;
drop policy if exists unit_spaces_write on public.unit_spaces;
create policy unit_spaces_read on public.unit_spaces for select to authenticated using (public.is_active_user());
create policy unit_spaces_write on public.unit_spaces for all to authenticated using (public.is_admin()) with check (public.is_admin());
