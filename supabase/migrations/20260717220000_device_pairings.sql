create table if not exists public.device_pairings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null,
  code text not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  claimed_device_id uuid references public.devices(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (code)
);

create index if not exists device_pairings_code_status_idx
  on public.device_pairings (code, status);

alter table public.device_pairings enable row level security;

drop policy if exists device_pairings_select on public.device_pairings;
create policy device_pairings_select on public.device_pairings for select
  using (public.is_workspace_member(workspace_id) or created_by = auth.uid());

drop policy if exists device_pairings_insert on public.device_pairings;
create policy device_pairings_insert on public.device_pairings for insert
  with check (created_by = auth.uid() and public.is_workspace_member(workspace_id));

drop policy if exists device_pairings_update on public.device_pairings;
create policy device_pairings_update on public.device_pairings for update
  using (public.is_workspace_member(workspace_id) or created_by = auth.uid())
  with check (public.is_workspace_member(workspace_id) or created_by = auth.uid());

create or replace function public.claim_device_pairing(
  p_code text,
  p_device_id uuid,
  p_name text default null,
  p_hostname text default null,
  p_architecture text default null,
  p_capabilities jsonb default '{}'::jsonb
)
returns public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  pairing public.device_pairings;
  new_device public.devices;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into pairing
  from public.device_pairings
  where code = upper(trim(p_code))
    and status = 'pending'
    and expires_at > now()
  for update;

  if pairing.id is null then
    raise exception 'invalid or expired pairing code';
  end if;

  if pairing.created_by <> auth.uid() then
    raise exception 'pairing belongs to another account';
  end if;

  insert into public.devices (
    id,
    workspace_id,
    owner_id,
    name,
    hostname,
    platform,
    architecture,
    runtime_version,
    status,
    last_seen_at,
    is_enabled,
    is_default,
    capabilities
  )
  values (
    p_device_id,
    pairing.workspace_id,
    auth.uid(),
    coalesce(nullif(trim(p_name), ''), pairing.name),
    p_hostname,
    'macos',
    p_architecture,
    '1.0.0',
    'online',
    now(),
    true,
    not exists (
      select 1 from public.devices d
      where d.owner_id = auth.uid() and d.is_default = true and d.is_enabled = true
    ),
    coalesce(p_capabilities, '{}'::jsonb)
  )
  on conflict (id) do update
  set
    workspace_id = excluded.workspace_id,
    name = excluded.name,
    hostname = excluded.hostname,
    architecture = excluded.architecture,
    status = 'online',
    last_seen_at = now(),
    is_enabled = true,
    capabilities = excluded.capabilities,
    updated_at = now()
  returning * into new_device;

  update public.device_pairings
  set
    status = 'claimed',
    claimed_device_id = new_device.id,
    claimed_at = now()
  where id = pairing.id;

  return new_device;
end;
$$;

grant execute on function public.claim_device_pairing(text, uuid, text, text, text, jsonb) to authenticated;
