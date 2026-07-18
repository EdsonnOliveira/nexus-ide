alter table public.agent_sessions
  add column if not exists cursor_chat_id text,
  add column if not exists model_id text;

comment on column public.agent_sessions.cursor_chat_id is 'Cursor agent chat id for --resume';
comment on column public.agent_sessions.model_id is 'Selected model id for follow-up prompts';
comment on column public.agent_sessions.status is 'running | active | error | closed';
