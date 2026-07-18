alter table public.workspaces
  add column if not exists local_id uuid,
  add column if not exists color text,
  add column if not exists icon text,
  add column if not exists logo_url text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_archived boolean not null default false;

alter table public.projects
  add column if not exists local_id uuid,
  add column if not exists icon text,
  add column if not exists logo_url text,
  add column if not exists sort_order integer not null default 0;

create unique index if not exists workspaces_owner_local_id_uidx
  on public.workspaces (owner_id, local_id)
  where local_id is not null;

create unique index if not exists projects_local_id_uidx
  on public.projects (local_id)
  where local_id is not null;

create table if not exists public.local_sync_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  status text not null default 'running',
  projects_count integer not null default 0,
  workspaces_count integer not null default 0,
  brain_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.local_sync_runs enable row level security;

drop policy if exists local_sync_runs_all on public.local_sync_runs;
create policy local_sync_runs_all on public.local_sync_runs for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

insert into storage.buckets (id, name, public)
values ('project-logos', 'project-logos', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists project_logos_select on storage.objects;
create policy project_logos_select on storage.objects for select
  using (bucket_id = 'project-logos');

drop policy if exists project_logos_insert on storage.objects;
create policy project_logos_insert on storage.objects for insert
  with check (bucket_id = 'project-logos' and auth.role() = 'authenticated');

drop policy if exists project_logos_update on storage.objects;
create policy project_logos_update on storage.objects for update
  using (bucket_id = 'project-logos' and auth.role() = 'authenticated');

drop policy if exists project_logos_delete on storage.objects;
create policy project_logos_delete on storage.objects for delete
  using (bucket_id = 'project-logos' and auth.role() = 'authenticated');
