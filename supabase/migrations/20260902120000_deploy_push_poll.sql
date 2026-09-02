create table if not exists public.user_render_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  credential_id text not null,
  label text not null default 'Conta Render',
  token text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, credential_id)
);

create index if not exists user_render_tokens_user_id_idx
  on public.user_render_tokens (user_id);

create table if not exists public.render_deploy_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_deployment jsonb,
  deployments jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists render_deploy_snapshots_updated_at_idx
  on public.render_deploy_snapshots (updated_at desc);

alter table public.user_render_tokens enable row level security;
alter table public.render_deploy_snapshots enable row level security;

create policy user_render_tokens_select on public.user_render_tokens
  for select using (auth.uid() = user_id);

create policy user_render_tokens_insert on public.user_render_tokens
  for insert with check (auth.uid() = user_id);

create policy user_render_tokens_update on public.user_render_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy user_render_tokens_delete on public.user_render_tokens
  for delete using (auth.uid() = user_id);

create policy render_deploy_snapshots_select on public.render_deploy_snapshots
  for select using (auth.uid() = user_id);

create policy render_deploy_snapshots_insert on public.render_deploy_snapshots
  for insert with check (auth.uid() = user_id);

create policy render_deploy_snapshots_update on public.render_deploy_snapshots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy render_deploy_snapshots_delete on public.render_deploy_snapshots
  for delete using (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.render_deploy_snapshots;
exception
  when duplicate_object then
    null;
end;
$$;

do $$
declare
  jid bigint;
begin
  for jid in
    select jobid from cron.job
    where jobname in ('nexus-poll-vercel-deploys', 'nexus-poll-render-deploys')
  loop
    perform cron.unschedule(jid);
  end loop;

  perform cron.schedule(
    'nexus-poll-vercel-deploys',
    '*/2 * * * *',
    $cron$ select public.invoke_nexus_edge_function('poll-vercel-deploys'); $cron$
  );

  perform cron.schedule(
    'nexus-poll-render-deploys',
    '*/2 * * * *',
    $cron$ select public.invoke_nexus_edge_function('poll-render-deploys'); $cron$
  );
end;
$$;
