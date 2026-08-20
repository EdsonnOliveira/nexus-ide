create or replace function public.check_devices_offline_and_notify()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cutoff timestamptz := now() - interval '5 minutes';
  max_notify timestamptz := now() - interval '30 minutes';
  rec record;
  updated_id uuid;
  recipient uuid;
  notified int := 0;
  marked int := 0;
  cfg public.nexus_cron_secrets%rowtype;
  device_name text;
begin
  select * into cfg from public.nexus_cron_secrets where id = 1;

  for rec in
    select id, name, owner_id, workspace_id, last_seen_at
    from public.devices
    where status = 'online'
      and last_seen_at < cutoff
  loop
    update public.devices
    set status = 'offline', updated_at = now()
    where id = rec.id
      and status = 'online'
    returning id into updated_id;

    if updated_id is null then
      continue;
    end if;

    marked := marked + 1;

    if rec.last_seen_at is null or rec.last_seen_at < max_notify then
      continue;
    end if;

    device_name := coalesce(nullif(btrim(rec.name), ''), 'Mac');

    for recipient in
      select distinct uid
      from (
        select rec.owner_id as uid
        union
        select wm.user_id
        from public.workspace_members wm
        where wm.workspace_id = rec.workspace_id
      ) people
    loop
      if not exists (
        select 1
        from public.push_subscriptions ps
        where ps.user_id = recipient
      ) then
        continue;
      end if;

      delete from public.push_notification_log
      where user_id = recipient
        and kind = 'device'
        and dedupe_key = 'device:' || rec.id::text || ':online';

      if cfg.service_role_key is null or cfg.service_role_key = '' or cfg.supabase_url is null then
        continue;
      end if;

      perform net.http_post(
        url := rtrim(cfg.supabase_url, '/') || '/functions/v1/send-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || cfg.service_role_key,
          'x-nexus-notify-secret', coalesce(cfg.notify_secret, '')
        ),
        body := jsonb_build_object(
          'userId', recipient,
          'kind', 'device',
          'title', 'Mac offline',
          'body', device_name || ' ficou offline',
          'dedupeKey', 'device:' || rec.id::text || ':offline',
          'data', jsonb_build_object('deviceId', rec.id, 'name', device_name)
        )
      );
      notified := notified + 1;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'marked', marked, 'notified', notified);
end;
$$;

revoke all on function public.check_devices_offline_and_notify() from public;
grant execute on function public.check_devices_offline_and_notify() to postgres, service_role;

do $$
declare
  jid bigint;
begin
  for jid in
    select jobid from cron.job
    where jobname = 'nexus-check-devices-offline'
  loop
    perform cron.unschedule(jid);
  end loop;

  perform cron.schedule(
    'nexus-check-devices-offline',
    '* * * * *',
    $cron$ select public.check_devices_offline_and_notify(); $cron$
  );
end;
$$;
