import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env.local');

function loadEnv() {
  const values = {};
  if (!existsSync(envPath)) {
    return values;
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[trimmed.slice(0, eq).trim()] = value;
  }
  return values;
}

const env = loadEnv();
const projectRef = env.NEXUS_SUPABASE_PROJECT_REF || 'ktmngnpwmgvciutrgqbq';
const required = [
  'VITE_SUPABASE_URL',
  'VITE_VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  'NOTIFY_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_PASSWORD',
];
for (const key of required) {
  if (!env[key]) {
    console.error(`Missing ${key} in .env.local`);
    process.exit(1);
  }
}

const secrets = spawnSync(
  'npx',
  [
    'supabase',
    'secrets',
    'set',
    `VAPID_PUBLIC_KEY=${env.VITE_VAPID_PUBLIC_KEY}`,
    `VAPID_PRIVATE_KEY=${env.VAPID_PRIVATE_KEY}`,
    `VAPID_SUBJECT=${env.VAPID_SUBJECT}`,
    `NOTIFY_SECRET=${env.NOTIFY_SECRET}`,
    '--project-ref',
    projectRef,
  ],
  { cwd: root, stdio: 'inherit', env: process.env },
);
if (secrets.status !== 0) {
  console.error('Failed to set secrets. Login with an account that owns the Nexus project.');
  process.exit(secrets.status ?? 1);
}

const deploy = spawnSync(
  'npx',
  [
    'supabase',
    'functions',
    'deploy',
    'send-push',
    'poll-vercel-deploys',
    'check-devices-offline',
    '--project-ref',
    projectRef,
  ],
  { cwd: root, stdio: 'inherit', env: process.env },
);
if (deploy.status !== 0) {
  process.exit(deploy.status ?? 1);
}

const sql = `
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

insert into public.nexus_cron_secrets (id, supabase_url, service_role_key, notify_secret)
values (1, '${env.VITE_SUPABASE_URL.replace(/'/g, "''")}', '${env.SUPABASE_SERVICE_ROLE_KEY.replace(/'/g, "''")}', '${env.NOTIFY_SECRET.replace(/'/g, "''")}')
on conflict (id) do update set
  supabase_url = excluded.supabase_url,
  service_role_key = excluded.service_role_key,
  notify_secret = excluded.notify_secret,
  updated_at = now();

do $$
declare
  jid bigint;
begin
  for jid in
    select jobid from cron.job
    where jobname in ('nexus-poll-vercel-deploys', 'nexus-check-devices-offline')
  loop
    perform cron.unschedule(jid);
  end loop;

  perform cron.schedule(
    'nexus-poll-vercel-deploys',
    '*/2 * * * *',
    $cron$ select public.invoke_nexus_edge_function('poll-vercel-deploys'); $cron$
  );

  perform cron.schedule(
    'nexus-check-devices-offline',
    '* * * * *',
    $cron$ select public.invoke_nexus_edge_function('check-devices-offline'); $cron$
  );
end;
$$;
`;

const psql = spawnSync(
  'psql',
  [
    `postgresql://postgres:${env.SUPABASE_DB_PASSWORD}@db.${projectRef}.supabase.co:5432/postgres`,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PGPASSWORD: env.SUPABASE_DB_PASSWORD },
  },
);
process.exit(psql.status ?? 0);
