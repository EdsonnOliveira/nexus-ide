create table if not exists public.nexus_cron_secrets (
  id int primary key default 1 check (id = 1),
  supabase_url text not null,
  service_role_key text not null,
  notify_secret text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.nexus_cron_secrets enable row level security;

revoke all on table public.nexus_cron_secrets from anon, authenticated;
grant select, insert, update on table public.nexus_cron_secrets to service_role;

create or replace function public.invoke_nexus_edge_function(p_function_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cfg public.nexus_cron_secrets%rowtype;
begin
  select * into cfg from public.nexus_cron_secrets where id = 1;
  if cfg.service_role_key is null or cfg.service_role_key = '' then
    return;
  end if;

  perform net.http_post(
    url := rtrim(cfg.supabase_url, '/') || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || cfg.service_role_key,
      'x-nexus-notify-secret', coalesce(cfg.notify_secret, '')
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.invoke_nexus_edge_function(text) from public;
grant execute on function public.invoke_nexus_edge_function(text) to service_role;
