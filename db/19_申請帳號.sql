-- 19_申請帳號.sql：同事在登入頁自己申請帳號，管理者開通後才能用
-- 新建立的帳號一律先「停用」並標記「待開通」（第一位帳號仍自動成為管理者）。
-- 這支可以重複執行，不會動到已經存在的帳號。
alter table public.profiles add column if not exists pending boolean not null default false;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first boolean := not exists (select 1 from public.profiles);
begin
  insert into public.profiles (id, name, email, role, active, pending)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email,'@',1)),
          new.email,
          case when first then 'admin' else 'user' end,
          first, not first)
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
