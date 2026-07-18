create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint)
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

create table if not exists public.push_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  agent_enabled boolean not null default true,
  deploy_enabled boolean not null default true,
  device_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_vercel_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.push_notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  dedupe_key text not null,
  sent_at timestamptz not null default now(),
  unique (user_id, kind, dedupe_key)
);

create index if not exists push_notification_log_sent_at_idx
  on public.push_notification_log (sent_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.push_preferences enable row level security;
alter table public.user_vercel_tokens enable row level security;
alter table public.push_notification_log enable row level security;

create policy push_subscriptions_select on public.push_subscriptions
  for select using (auth.uid() = user_id);

create policy push_subscriptions_insert on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

create policy push_subscriptions_update on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy push_subscriptions_delete on public.push_subscriptions
  for delete using (auth.uid() = user_id);

create policy push_preferences_select on public.push_preferences
  for select using (auth.uid() = user_id);

create policy push_preferences_insert on public.push_preferences
  for insert with check (auth.uid() = user_id);

create policy push_preferences_update on public.push_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy push_preferences_delete on public.push_preferences
  for delete using (auth.uid() = user_id);

create policy user_vercel_tokens_select on public.user_vercel_tokens
  for select using (auth.uid() = user_id);

create policy user_vercel_tokens_insert on public.user_vercel_tokens
  for insert with check (auth.uid() = user_id);

create policy user_vercel_tokens_update on public.user_vercel_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy user_vercel_tokens_delete on public.user_vercel_tokens
  for delete using (auth.uid() = user_id);

create policy push_notification_log_select on public.push_notification_log
  for select using (auth.uid() = user_id);

create or replace function public.claim_push_dedupe(
  p_user_id uuid,
  p_kind text,
  p_dedupe_key text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_id uuid;
begin
  insert into public.push_notification_log (user_id, kind, dedupe_key)
  values (p_user_id, p_kind, p_dedupe_key)
  on conflict (user_id, kind, dedupe_key) do nothing
  returning id into inserted_id;

  return inserted_id is not null;
end;
$$;

revoke all on function public.claim_push_dedupe(uuid, text, text) from public;
grant execute on function public.claim_push_dedupe(uuid, text, text) to service_role;
