-- 22_匯入紀錄與轉檔權限.sql
-- 1. 設定 Excel 匯入批次紀錄：誰、什麼時候、哪個檔、是否完整同步、各表新增／修改／刪除／停用了哪些。
-- 2. 報告轉檔權限分離：AI 轉檔結果只有「轉檔機器人」帳號能寫；同事只能重新排隊、要求立即轉檔、確認匯入。
-- 3. 確認匯入改成一次完成：缺失全部寫入後才標記「已匯入」，中途失敗就一筆都不寫，也不會被兩個人重複匯入。
-- 執行後請把轉檔機器人帳號標記起來（Email 換成機器人用的那個）：
--   update public.profiles set is_bot = true where email = '機器人的 Email';
-- 還沒標記機器人之前，轉檔照舊可以跑（相容模式）。可重複執行。

-- ---------- 1. 設定匯入紀錄 ----------
create table if not exists public.settings_import_logs (
  id bigint generated always as identity primary key,
  site_id bigint references public.sites(id),
  file_name text,
  full_sync boolean not null default false,
  summary jsonb not null default '[]'::jsonb,
  by_user uuid default auth.uid() references auth.users(id),
  at timestamptz not null default now()
);
grant select, insert on public.settings_import_logs to authenticated;
alter table public.settings_import_logs enable row level security;
drop policy if exists settings_import_logs_read on public.settings_import_logs;
drop policy if exists settings_import_logs_insert on public.settings_import_logs;
create policy settings_import_logs_read on public.settings_import_logs for select to authenticated using (public.is_admin());
create policy settings_import_logs_insert on public.settings_import_logs for insert to authenticated
  with check (public.is_admin() and by_user = auth.uid());
-- 不開放修改、刪除

-- ---------- 2. 轉檔機器人 ----------
alter table public.profiles add column if not exists is_bot boolean not null default false;

create or replace function public.guard_report_job() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); bot boolean; anybot boolean;
begin
  if me is null then return new; end if;                                   -- SQL Editor
  if current_setting('app.report_import', true) = 'on' then return new; end if;   -- 由 import_report_job 標記已匯入
  select coalesce(is_bot, false) into bot from public.profiles where id = me;
  anybot := exists (select 1 from public.profiles where is_bot and active);
  -- 不論誰都不能改：檔案、案場、上傳者
  new.site_id := old.site_id; new.path := old.path; new.file_name := old.file_name;
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.imported_by := old.imported_by; new.imported_at := old.imported_at;
  if new.status = 'imported' and old.status <> 'imported' then
    raise exception '請在畫面上按「確認匯入」';
  end if;
  if bot or not anybot then                        -- 機器人（或還沒指定機器人的相容模式）
    if bot and new.status is distinct from old.status
       and not (old.status in ('pending','processing') and new.status in ('processing','done','error')) then
      raise exception '轉檔機器人不能把狀態從 % 改成 %', old.status, new.status;
    end if;
    return new;
  end if;
  -- 一般同事：AI 結果、提醒、轉檔時間都不能改
  new.result := old.result; new.processed_at := old.processed_at;
  if new.status is distinct from old.status then
    if old.status = 'error' and new.status = 'pending' then new.message := null;   -- 重新排隊
    else raise exception '轉檔狀態只能由轉檔機器人更新'; end if;
  else
    new.message := old.message;
  end if;
  return new;
end $$;
drop trigger if exists report_jobs_guard on public.report_jobs;
create trigger report_jobs_guard before update on public.report_jobs
  for each row execute function public.guard_report_job();

-- ---------- 3. 確認匯入（一次完成） ----------
-- p_rows：[{inspect_type_id, building_id, floor, unit_id, space_id, category_id, item_id, repair_method_id,
--           fix_vendor_id, resp_vendor_id, description}, …]；回傳新缺失的編號（同順序），照片由網頁接著上傳。
create or replace function public.import_report_job(p_job bigint, p_rows jsonb) returns bigint[]
language plpgsql security invoker set search_path = public as $$
declare j record; r jsonb; nid bigint; ids bigint[] := '{}';
begin
  if not public.is_staff() then raise exception '只有內部人員可以匯入'; end if;
  select * into j from public.report_jobs where id = p_job for update;
  if not found then raise exception '找不到這份報告'; end if;
  if j.status = 'imported' then raise exception '這份報告已經匯入過了'; end if;
  if j.status <> 'done' then raise exception '這份報告還沒轉檔完成'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception '沒有要匯入的缺失'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.defects (site_id, inspect_type_id, building_id, floor, unit_id, space_id, category_id, item_id,
                                repair_method_id, fix_vendor_id, resp_vendor_id, description, status, created_by)
    values (j.site_id, (r->>'inspect_type_id')::bigint, (r->>'building_id')::bigint, r->>'floor', (r->>'unit_id')::bigint,
            (r->>'space_id')::bigint, (r->>'category_id')::bigint, (r->>'item_id')::bigint, (r->>'repair_method_id')::bigint,
            (r->>'fix_vendor_id')::bigint, (r->>'resp_vendor_id')::bigint, r->>'description', 'todo', auth.uid())
    returning id into nid;
    ids := ids || nid;
  end loop;
  perform set_config('app.report_import', 'on', true);
  update public.report_jobs set status = 'imported', imported_by = auth.uid(), imported_at = now() where id = p_job;
  perform set_config('app.report_import', 'off', true);
  return ids;
end $$;
grant execute on function public.import_report_job(bigint, jsonb) to authenticated;
