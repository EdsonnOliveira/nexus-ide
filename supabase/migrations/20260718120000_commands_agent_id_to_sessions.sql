alter table public.commands
  drop constraint if exists commands_agent_id_fkey;

alter table public.commands
  add constraint commands_agent_id_fkey
  foreign key (agent_id) references public.agent_sessions(id) on delete set null;
