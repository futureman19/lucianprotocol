grant select on table public.knowledge_graphs to anon, authenticated;
grant select, insert, update, delete on table public.knowledge_graphs to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'knowledge_graphs'
      and policyname = 'public read knowledge_graphs'
  ) then
    create policy "public read knowledge_graphs"
      on public.knowledge_graphs
      for select
      to anon, authenticated
      using (true);
  end if;
end $$;
