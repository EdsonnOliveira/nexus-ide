create table if not exists public.vercel_deploy_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_deployment jsonb,
  deployments jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists vercel_deploy_snapshots_updated_at_idx
  on public.vercel_deploy_snapshots (updated_at desc);

alter table public.vercel_deploy_snapshots enable row level security;

create policy vercel_deploy_snapshots_select on public.vercel_deploy_snapshots
  for select using (auth.uid() = user_id);

create policy vercel_deploy_snapshots_insert on public.vercel_deploy_snapshots
  for insert with check (auth.uid() = user_id);

create policy vercel_deploy_snapshots_update on public.vercel_deploy_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy vercel_deploy_snapshots_delete on public.vercel_deploy_snapshots
  for delete using (auth.uid() = user_id);

alter publication supabase_realtime add table public.vercel_deploy_snapshots;
