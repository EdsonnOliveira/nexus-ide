create table if not exists public.mobile_release_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  active_release jsonb,
  releases jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists mobile_release_snapshots_updated_at_idx
  on public.mobile_release_snapshots (updated_at desc);

alter table public.mobile_release_snapshots enable row level security;

create policy mobile_release_snapshots_select on public.mobile_release_snapshots
  for select using (auth.uid() = user_id);

create policy mobile_release_snapshots_insert on public.mobile_release_snapshots
  for insert with check (auth.uid() = user_id);

create policy mobile_release_snapshots_update on public.mobile_release_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy mobile_release_snapshots_delete on public.mobile_release_snapshots
  for delete using (auth.uid() = user_id);

alter publication supabase_realtime add table public.mobile_release_snapshots;

insert into storage.buckets (id, name, public, file_size_limit)
values ('mobile-artifacts', 'mobile-artifacts', false, 524288000)
on conflict (id) do update
set file_size_limit = excluded.file_size_limit;

create policy mobile_artifacts_select on storage.objects
  for select to authenticated
  using (bucket_id = 'mobile-artifacts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy mobile_artifacts_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'mobile-artifacts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy mobile_artifacts_update on storage.objects
  for update to authenticated
  using (bucket_id = 'mobile-artifacts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'mobile-artifacts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy mobile_artifacts_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'mobile-artifacts' and (storage.foldername(name))[1] = auth.uid()::text);
