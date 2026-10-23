-- 20_缺失異動紀錄.sql
-- 每次新增、修改、刪除缺失，以及新增、刪除照片，都自動記一筆：誰、什麼時候、哪些欄位從什麼改成什麼。
-- 紀錄只能看、不能改也不能刪（沒有開放寫入權限，只有資料庫觸發器會寫）。缺失刪掉後紀錄仍保留。
-- 可重複執行。

create table if not exists public.defect_logs (
  id bigint generated always as identity primary key,
  defect_id bigint not null,                 -- 不設外鍵：缺失刪除後紀錄仍保留
  action text not null,                      -- 新增／修改／刪除／新增照片／刪除照片
  changes jsonb not null default '{}'::jsonb, -- 修改：{欄位: [舊值, 新值]}；新增／刪除：整筆內容
  by_user uuid default auth.uid(),
  at timestamptz not null default now()
);
create index if not exists defect_logs_defect_idx on public.defect_logs (defect_id, at);

alter table public.defect_logs enable row level security;
drop policy if exists defect_logs_read on public.defect_logs;
create policy defect_logs_read on public.defect_logs for select to authenticated
  using (public.is_staff() or public.can_see_defect(defect_id));
-- 不建立 insert／update／delete 權限：網頁端無法寫入或竄改

create or replace function public.log_defect() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; diff jsonb := '{}'::jsonb; k text;
  skip text[] := array['updated_at','updated_by','created_at','fixed_at','closed_at','verified_at'];
begin
  if tg_op = 'INSERT' then
    insert into public.defect_logs (defect_id, action, changes) values (new.id, '新增', to_jsonb(new) - skip);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.defect_logs (defect_id, action, changes) values (old.id, '刪除', to_jsonb(old));
    return old;
  end if;
  o := to_jsonb(old); n := to_jsonb(new);
  for k in select jsonb_object_keys(n) loop
    if not (k = any(skip)) and (o -> k) is distinct from (n -> k) then
      diff := diff || jsonb_build_object(k, jsonb_build_array(o -> k, n -> k));
    end if;
  end loop;
  if diff <> '{}'::jsonb then
    insert into public.defect_logs (defect_id, action, changes) values (new.id, '修改', diff);
  end if;
  return new;
end $$;
drop trigger if exists defects_log on public.defects;
create trigger defects_log after insert or update or delete on public.defects
  for each row execute function public.log_defect();

create or replace function public.log_defect_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.defect_logs (defect_id, action, changes)
    values (new.defect_id, '新增照片', jsonb_build_object('kind', new.kind, 'path', new.path));
    return new;
  end if;
  -- 整筆缺失被刪除時照片會連帶刪除，那時已有「刪除」紀錄，不再逐張記
  if exists (select 1 from public.defects where id = old.defect_id) then
    insert into public.defect_logs (defect_id, action, changes)
    values (old.defect_id, '刪除照片', jsonb_build_object('kind', old.kind, 'path', old.path));
  end if;
  return old;
end $$;
drop trigger if exists defect_photos_log on public.defect_photos;
create trigger defect_photos_log after insert or delete on public.defect_photos
  for each row execute function public.log_defect_photo();
