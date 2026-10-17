-- 10_報告轉檔：同事在系統上傳驗屋報告 PDF → 排程的 AI 讀完把結果寫回 → 同事在系統預覽、補選、匯入
-- 需先執行過 6_廠商帳號.sql（用到 is_staff）。貼到 Supabase SQL Editor 按 Run，可重複執行。

create table if not exists public.report_jobs (
  id bigint generated always as identity primary key,
  site_id bigint not null references public.sites(id),
  file_name text not null,                  -- 原始檔名
  path text not null,                       -- reports 儲存空間裡的路徑：<id>/report.pdf
  vendor text,                              -- 驗屋公司（選填，例：鷹眼）
  building_id bigint references public.buildings(id),
  floor text,
  unit_id bigint references public.units(id),
  inspect_type_id bigint references public.inspect_types(id),
  note text,                                -- 上傳者給 AI 的補充說明
  status text not null default 'pending' check (status in ('pending','processing','done','error','imported')),
  result jsonb,                             -- {"rows":[{棟別,樓層,…,照片}], "skip":[[編號,內容,原因]]}
  message text,                             -- 轉檔失敗原因或 AI 給的提醒
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  imported_by uuid references auth.users(id),
  imported_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists report_jobs_status_idx on public.report_jobs (status, created_at);

grant select, insert, update, delete on public.report_jobs to authenticated;
alter table public.report_jobs enable row level security;
drop policy if exists report_jobs_read on public.report_jobs;
drop policy if exists report_jobs_insert on public.report_jobs;
drop policy if exists report_jobs_update on public.report_jobs;
drop policy if exists report_jobs_delete on public.report_jobs;
create policy report_jobs_read on public.report_jobs for select to authenticated using (public.is_staff());
create policy report_jobs_insert on public.report_jobs for insert to authenticated with check (public.is_staff() and created_by = auth.uid());
create policy report_jobs_update on public.report_jobs for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy report_jobs_delete on public.report_jobs for delete to authenticated using (public.is_admin() or created_by = auth.uid());

create or replace function public.touch_report_job() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists report_jobs_touch on public.report_jobs;
create trigger report_jobs_touch before update on public.report_jobs for each row execute function public.touch_report_job();

-- 報告與裁好的照片放在私有的 reports 儲存空間（<job id>/report.pdf、<job id>/photos/xxx.jpg）
insert into storage.buckets (id, name, public) values ('reports','reports',false) on conflict (id) do nothing;
drop policy if exists storage_reports_read on storage.objects;
drop policy if exists storage_reports_insert on storage.objects;
drop policy if exists storage_reports_update on storage.objects;
drop policy if exists storage_reports_delete on storage.objects;
create policy storage_reports_read on storage.objects for select to authenticated using (bucket_id = 'reports' and public.is_staff());
create policy storage_reports_insert on storage.objects for insert to authenticated with check (bucket_id = 'reports' and public.is_staff());
create policy storage_reports_update on storage.objects for update to authenticated using (bucket_id = 'reports' and public.is_staff());
create policy storage_reports_delete on storage.objects for delete to authenticated using (bucket_id = 'reports' and (public.is_admin() or owner = auth.uid()));
