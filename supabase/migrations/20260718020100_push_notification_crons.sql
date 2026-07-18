create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

create or replace function public.invoke_nexus_edge_function(p_function_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  project_url text := coalesce(
    nullif(current_setting('app.settings.supabase_url', true), ''),
    'https://ktmngnpwmgvciutrgqbq.supabase.co'
  );
  service_key text := nullif(current_setting('app.settings.service_role_key', true), '');
  notify_secret text := coalesce(nullif(current_setting('app.settings.notify_secret', true), ''), '');
begin
  if service_key is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/' || p_function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key,
      'x-nexus-notify-secret', notify_secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.invoke_nexus_edge_function(text) from public;
grant execute on function public.invoke_nexus_edge_function(text) to service_role;
