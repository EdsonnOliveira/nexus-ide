alter table public.agent_sessions
  add column if not exists source text not null default 'cloud';

comment on column public.agent_sessions.source is 'cloud | desktop_pane';

create index if not exists agent_sessions_device_source_status_idx
  on public.agent_sessions (device_id, source, status);
