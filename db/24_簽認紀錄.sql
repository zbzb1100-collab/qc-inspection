-- 24_簽認紀錄.sql
-- 每次客戶簽名（單筆或整戶）都留一筆簽認紀錄：當時涵蓋哪些缺失、每筆的內容、簽認人、日期、簽名圖。
-- 之後這戶有新增或重新開案的缺失，填寫頁會提示「需要重新簽認」。紀錄只能新增、不能改或刪。
-- 需先執行 23_案場權限.sql。可重複執行。

create table if not exists public.sign_records (
  id bigint generated always as identity primary key,
  site_id bigint not null references public.sites(id),
  inspect_type_id bigint references public.inspect_types(id),
  unit_id bigint references public.units(id),
  floor text,
  defect_ids bigint[] not null default '{}',
  snapshot jsonb not null default '[]'::jsonb,     -- [{id, 編號, 空間, 工項, 缺失內容, 說明, 結案方式}]
  signed_name text,
  signed_date date,
  sign_path text,                                   -- 簽名圖（photos 儲存空間）
  by_user uuid default auth.uid() references auth.users(id),
  at timestamptz not null default now()
);
create index if not exists sign_records_unit_idx on public.sign_records (unit_id, inspect_type_id, at desc);

grant select, insert on public.sign_records to authenticated;
alter table public.sign_records enable row level security;
drop policy if exists sign_records_read on public.sign_records;
drop policy if exists sign_records_insert on public.sign_records;
create policy sign_records_read on public.sign_records for select to authenticated
  using (public.is_staff() and public.has_site(site_id));
create policy sign_records_insert on public.sign_records for insert to authenticated
  with check (public.is_staff() and public.has_site(site_id) and by_user = auth.uid());
