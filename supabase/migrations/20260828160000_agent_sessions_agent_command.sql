alter table public.agent_sessions
  add column if not exists agent_command text;

comment on column public.agent_sessions.agent_command is 'CLI used for this agent: cursor-agent | claude | opencode | agy';
