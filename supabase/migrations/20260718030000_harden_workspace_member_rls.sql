drop policy if exists workspace_members_insert on public.workspace_members;
create policy workspace_members_insert on public.workspace_members for insert with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.workspaces w
    where w.id = workspace_members.workspace_id
      and w.owner_id = auth.uid()
  )
);

drop policy if exists commands_all on public.commands;
create policy commands_all on public.commands for all using (public.is_workspace_member(workspace_id)) with check (
  public.is_workspace_member(workspace_id)
  and created_by = auth.uid()
  and exists (
    select 1
    from public.devices d
    where d.id = commands.target_device_id
      and d.workspace_id = commands.workspace_id
  )
);
