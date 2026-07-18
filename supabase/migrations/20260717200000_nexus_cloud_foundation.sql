create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  hostname text,
  platform text not null default 'macos',
  architecture text,
  runtime_version text,
  app_version text,
  status text not null default 'offline',
  last_seen_at timestamptz,
  is_enabled boolean not null default true,
  is_default boolean not null default false,
  capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.device_credentials (
  device_id uuid primary key references public.devices(id) on delete cascade,
  public_key text not null,
  fingerprint text not null,
  revoked_at timestamptz,
  last_rotated_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.device_heartbeats (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  seen_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  slug text,
  color text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.device_projects (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  local_path text not null,
  is_available boolean not null default true,
  git_branch text,
  git_remote_url text,
  dependencies_status text,
  last_scanned_at timestamptz,
  last_opened_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (device_id, project_id)
);

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  relative_path text not null,
  content_hash text,
  size_bytes bigint,
  updated_at timestamptz not null default now(),
  unique (project_id, device_id, relative_path)
);

create table if not exists public.project_file_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_file_id uuid not null references public.project_files(id) on delete cascade,
  content text,
  content_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.project_open_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  relative_path text not null,
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  unique (project_id, device_id, relative_path, opened_by)
);

create table if not exists public.project_git_status (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  branch text,
  dirty boolean not null default false,
  ahead integer not null default 0,
  behind integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (project_id, device_id)
);

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  provider text not null,
  command text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  title text,
  status text not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_executions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.agent_sessions(id) on delete cascade,
  command_id uuid,
  status text not null default 'pending',
  prompt text,
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.agent_sessions(id) on delete cascade,
  execution_id uuid references public.agent_executions(id) on delete cascade,
  role text not null,
  content text not null default '',
  sequence bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_events (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.agent_executions(id) on delete cascade,
  type text not null,
  sequence bigint not null default 0,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.terminal_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  device_id uuid not null references public.devices(id) on delete cascade,
  title text,
  cwd text,
  cols integer not null default 80,
  rows integer not null default 24,
  status text not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.terminal_chunks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.terminal_sessions(id) on delete cascade,
  sequence bigint not null,
  content text not null,
  created_at timestamptz not null default now(),
  unique (session_id, sequence)
);

create table if not exists public.terminal_snapshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.terminal_sessions(id) on delete cascade,
  sequence bigint not null,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.skills (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.skill_installations (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  version text,
  status text not null default 'installed',
  metadata jsonb not null default '{}'::jsonb,
  unique (skill_id, device_id)
);

create table if not exists public.skill_secret_refs (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.skills(id) on delete cascade,
  device_id uuid references public.devices(id) on delete cascade,
  key_name text not null,
  secret_ref text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.commands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  target_device_id uuid not null references public.devices(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  terminal_session_id uuid references public.terminal_sessions(id) on delete set null,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  idempotency_key text,
  claimed_by_device_id uuid references public.devices(id) on delete set null,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  result jsonb,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists commands_idempotency_key_uidx
  on public.commands (workspace_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.command_attempts (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.commands(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  status text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.command_results (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.commands(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.command_approvals (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references public.commands(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reason text not null,
  status text not null default 'pending',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.command_locks (
  command_id uuid primary key references public.commands(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.brain_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  content text not null default '',
  kind text not null default 'document',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brain_meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  notes text not null default '',
  occurred_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.brain_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  title text not null,
  body text not null default '',
  status text not null default 'open',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_workspace_id uuid;
begin
  insert into public.user_profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();

  insert into public.workspaces (name, owner_id)
  values ('Pessoal', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.claim_command(p_device_id uuid, p_lease_seconds integer default 60)
returns public.commands
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.commands;
begin
  if not exists (
    select 1 from public.devices d
    where d.id = p_device_id
      and d.owner_id = auth.uid()
      and d.is_enabled = true
  ) then
    raise exception 'device not allowed';
  end if;

  update public.commands c
  set
    status = 'claimed',
    claimed_by_device_id = p_device_id,
    claimed_at = now(),
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempt_count = c.attempt_count + 1
  where c.id = (
    select c2.id
    from public.commands c2
    where c2.target_device_id = p_device_id
      and c2.status = 'pending'
      and (
        c2.lease_expires_at is null
        or c2.lease_expires_at < now()
      )
    order by c2.created_at asc
    for update skip locked
    limit 1
  )
  returning * into claimed;

  if claimed.id is not null then
    insert into public.command_attempts (command_id, device_id, status)
    values (claimed.id, p_device_id, 'claimed');

    insert into public.command_locks (command_id, device_id, lease_expires_at)
    values (claimed.id, p_device_id, claimed.lease_expires_at)
    on conflict (command_id) do update
    set device_id = excluded.device_id,
        lease_expires_at = excluded.lease_expires_at,
        updated_at = now();
  end if;

  return claimed;
end;
$$;

create or replace function public.renew_command_lease(p_command_id uuid, p_device_id uuid, p_lease_seconds integer default 60)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.commands
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = p_command_id
    and claimed_by_device_id = p_device_id
    and status in ('claimed', 'running', 'waiting_user');

  update public.command_locks
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where command_id = p_command_id
    and device_id = p_device_id;

  return found;
end;
$$;

create or replace function public.touch_device_heartbeat(p_device_id uuid, p_payload jsonb default '{}'::jsonb)
returns public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_device public.devices;
begin
  update public.devices
  set
    last_seen_at = now(),
    status = 'online',
    updated_at = now(),
    capabilities = case
      when p_payload ? 'capabilities' then p_payload->'capabilities'
      else capabilities
    end
  where id = p_device_id
    and owner_id = auth.uid()
  returning * into updated_device;

  if updated_device.id is null then
    raise exception 'device not found';
  end if;

  insert into public.device_heartbeats (device_id, payload)
  values (p_device_id, coalesce(p_payload, '{}'::jsonb));

  return updated_device;
end;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.user_profiles enable row level security;
alter table public.devices enable row level security;
alter table public.device_credentials enable row level security;
alter table public.device_heartbeats enable row level security;
alter table public.projects enable row level security;
alter table public.device_projects enable row level security;
alter table public.project_files enable row level security;
alter table public.project_file_snapshots enable row level security;
alter table public.project_open_files enable row level security;
alter table public.project_git_status enable row level security;
alter table public.agents enable row level security;
alter table public.agent_sessions enable row level security;
alter table public.agent_executions enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_events enable row level security;
alter table public.terminal_sessions enable row level security;
alter table public.terminal_chunks enable row level security;
alter table public.terminal_snapshots enable row level security;
alter table public.skills enable row level security;
alter table public.skill_installations enable row level security;
alter table public.skill_secret_refs enable row level security;
alter table public.commands enable row level security;
alter table public.command_attempts enable row level security;
alter table public.command_results enable row level security;
alter table public.command_approvals enable row level security;
alter table public.command_locks enable row level security;
alter table public.brain_documents enable row level security;
alter table public.brain_meetings enable row level security;
alter table public.brain_decisions enable row level security;

create policy workspaces_select on public.workspaces for select using (public.is_workspace_member(id) or owner_id = auth.uid());
create policy workspaces_insert on public.workspaces for insert with check (owner_id = auth.uid());
create policy workspaces_update on public.workspaces for update using (owner_id = auth.uid());

create policy workspace_members_select on public.workspace_members for select using (public.is_workspace_member(workspace_id) or user_id = auth.uid());
create policy workspace_members_insert on public.workspace_members for insert with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.workspaces w
    where w.id = workspace_members.workspace_id
      and w.owner_id = auth.uid()
  )
);

create policy user_profiles_select on public.user_profiles for select using (id = auth.uid());
create policy user_profiles_update on public.user_profiles for update using (id = auth.uid());

create policy devices_all on public.devices for all using (public.is_workspace_member(workspace_id) and owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy device_credentials_all on public.device_credentials for all using (
  exists (select 1 from public.devices d where d.id = device_id and d.owner_id = auth.uid())
) with check (
  exists (select 1 from public.devices d where d.id = device_id and d.owner_id = auth.uid())
);
create policy device_heartbeats_all on public.device_heartbeats for all using (
  exists (select 1 from public.devices d where d.id = device_id and d.owner_id = auth.uid())
) with check (
  exists (select 1 from public.devices d where d.id = device_id and d.owner_id = auth.uid())
);

create policy projects_all on public.projects for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy device_projects_all on public.device_projects for all using (
  exists (
    select 1 from public.devices d
    join public.projects p on p.id = project_id
    where d.id = device_id and d.owner_id = auth.uid() and public.is_workspace_member(p.workspace_id)
  )
) with check (
  exists (
    select 1 from public.devices d
    join public.projects p on p.id = project_id
    where d.id = device_id and d.owner_id = auth.uid() and public.is_workspace_member(p.workspace_id)
  )
);

create policy project_files_all on public.project_files for all using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id))
);
create policy project_file_snapshots_all on public.project_file_snapshots for all using (
  exists (
    select 1 from public.project_files pf
    join public.projects p on p.id = pf.project_id
    where pf.id = project_file_id and public.is_workspace_member(p.workspace_id)
  )
) with check (
  exists (
    select 1 from public.project_files pf
    join public.projects p on p.id = pf.project_id
    where pf.id = project_file_id and public.is_workspace_member(p.workspace_id)
  )
);
create policy project_open_files_all on public.project_open_files for all using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id))
);
create policy project_git_status_all on public.project_git_status for all using (
  exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id))
) with check (
  exists (select 1 from public.projects p where p.id = project_id and public.is_workspace_member(p.workspace_id))
);

create policy agents_all on public.agents for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy agent_sessions_all on public.agent_sessions for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy agent_executions_all on public.agent_executions for all using (
  exists (select 1 from public.agent_sessions s where s.id = session_id and public.is_workspace_member(s.workspace_id))
) with check (
  exists (select 1 from public.agent_sessions s where s.id = session_id and public.is_workspace_member(s.workspace_id))
);
create policy agent_messages_all on public.agent_messages for all using (
  exists (select 1 from public.agent_sessions s where s.id = session_id and public.is_workspace_member(s.workspace_id))
) with check (
  exists (select 1 from public.agent_sessions s where s.id = session_id and public.is_workspace_member(s.workspace_id))
);
create policy agent_events_all on public.agent_events for all using (
  exists (
    select 1 from public.agent_executions e
    join public.agent_sessions s on s.id = e.session_id
    where e.id = execution_id and public.is_workspace_member(s.workspace_id)
  )
) with check (
  exists (
    select 1 from public.agent_executions e
    join public.agent_sessions s on s.id = e.session_id
    where e.id = execution_id and public.is_workspace_member(s.workspace_id)
  )
);

create policy terminal_sessions_all on public.terminal_sessions for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy terminal_chunks_all on public.terminal_chunks for all using (
  exists (select 1 from public.terminal_sessions t where t.id = session_id and public.is_workspace_member(t.workspace_id))
) with check (
  exists (select 1 from public.terminal_sessions t where t.id = session_id and public.is_workspace_member(t.workspace_id))
);
create policy terminal_snapshots_all on public.terminal_snapshots for all using (
  exists (select 1 from public.terminal_sessions t where t.id = session_id and public.is_workspace_member(t.workspace_id))
) with check (
  exists (select 1 from public.terminal_sessions t where t.id = session_id and public.is_workspace_member(t.workspace_id))
);

create policy skills_all on public.skills for all using (workspace_id is null or public.is_workspace_member(workspace_id)) with check (workspace_id is null or public.is_workspace_member(workspace_id));
create policy skill_installations_all on public.skill_installations for all using (
  exists (select 1 from public.devices d where d.id = device_id and d.owner_id = auth.uid())
) with check (
  exists (select 1 from public.devices d where d.id = device_id and d.owner_id = auth.uid())
);
create policy skill_secret_refs_all on public.skill_secret_refs for all using (
  exists (select 1 from public.skills s where s.id = skill_id and (s.workspace_id is null or public.is_workspace_member(s.workspace_id)))
) with check (
  exists (select 1 from public.skills s where s.id = skill_id and (s.workspace_id is null or public.is_workspace_member(s.workspace_id)))
);

create policy commands_all on public.commands for all using (public.is_workspace_member(workspace_id)) with check (
  public.is_workspace_member(workspace_id)
  and created_by = auth.uid()
  and exists (
    select 1
    from public.devices d
    where d.id = commands.target_device_id
      and d.workspace_id = commands.workspace_id
  )
);
create policy command_attempts_all on public.command_attempts for all using (
  exists (select 1 from public.commands c where c.id = command_id and public.is_workspace_member(c.workspace_id))
) with check (
  exists (select 1 from public.commands c where c.id = command_id and public.is_workspace_member(c.workspace_id))
);
create policy command_results_all on public.command_results for all using (
  exists (select 1 from public.commands c where c.id = command_id and public.is_workspace_member(c.workspace_id))
) with check (
  exists (select 1 from public.commands c where c.id = command_id and public.is_workspace_member(c.workspace_id))
);
create policy command_approvals_all on public.command_approvals for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy command_locks_all on public.command_locks for all using (
  exists (select 1 from public.commands c where c.id = command_id and public.is_workspace_member(c.workspace_id))
) with check (
  exists (select 1 from public.commands c where c.id = command_id and public.is_workspace_member(c.workspace_id))
);

create policy brain_documents_all on public.brain_documents for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy brain_meetings_all on public.brain_meetings for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy brain_decisions_all on public.brain_decisions for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

grant usage on schema public to anon, authenticated;
grant execute on function public.is_workspace_member(uuid) to anon, authenticated;
grant execute on function public.claim_command(uuid, integer) to authenticated;
grant execute on function public.renew_command_lease(uuid, uuid, integer) to authenticated;
grant execute on function public.touch_device_heartbeat(uuid, jsonb) to authenticated;
