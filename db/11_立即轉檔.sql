-- 11_立即轉檔：管理員在「報告」分頁勾選待轉檔的報告按「立即轉檔」→ 那幾份排到最前面，並馬上叫排程跑一次
-- 需先執行過 10_報告轉檔.sql。貼到 Supabase SQL Editor 按 Run，可重複執行。
-- 另外要在 Supabase 部署 fire-convert 小程式（supabase/functions/fire-convert/index.ts），步驟見 docs/立即轉檔設定.md。

alter table public.report_jobs add column if not exists urgent boolean not null default false;   -- 管理員要求立即轉檔
alter table public.report_jobs add column if not exists urgent_by uuid references auth.users(id);
alter table public.report_jobs add column if not exists urgent_at timestamptz;
create index if not exists report_jobs_urgent_idx on public.report_jobs (status, urgent desc, created_at);

-- 只有管理員能把報告標成立即轉檔；一般使用者照樣只能上傳排隊
create or replace function public.touch_report_job() returns trigger
language plpgsql as $$
begin
  if new.urgent and not coalesce(old.urgent, false) then
    if not public.is_admin() then raise exception '只有管理員可以要求立即轉檔'; end if;
    new.urgent_by := auth.uid(); new.urgent_at := now();
  end if;
  new.updated_at := now(); return new;
end $$;

create or replace function public.guard_report_job_insert() returns trigger
language plpgsql as $$
begin
  if new.urgent and not public.is_admin() then new.urgent := false; end if;
  if new.urgent then new.urgent_by := auth.uid(); new.urgent_at := now(); end if;
  return new;
end $$;
drop trigger if exists report_jobs_guard_insert on public.report_jobs;
create trigger report_jobs_guard_insert before insert on public.report_jobs for each row execute function public.guard_report_job_insert();
