alter table public.world_state
add column if not exists active_repo_path text,
add column if not exists active_repo_name text,
add column if not exists operator_prompt text;

create table if not exists public.operator_controls (
  id text primary key,
  repo_path text not null default '',
  operator_prompt text not null default '',
  updated_at timestamp with time zone not null default now()
);

drop trigger if exists touch_operator_controls_updated_at on public.operator_controls;
create trigger touch_operator_controls_updated_at
before update on public.operator_controls
for each row execute function public.touch_updated_at();

alter table public.operator_controls enable row level security;

drop policy if exists "public read operator_controls" on public.operator_controls;
create policy "public read operator_controls"
on public.operator_controls
for select
using (true);

drop policy if exists "public insert operator_controls" on public.operator_controls;
create policy "public insert operator_controls"
on public.operator_controls
for insert
with check (true);

drop policy if exists "public update operator_controls" on public.operator_controls;
create policy "public update operator_controls"
on public.operator_controls
for update
using (true)
with check (true);

insert into public.operator_controls (id, repo_path, operator_prompt)
values ('lux-control', '', '')
on conflict (id) do nothing;

do $$
begin
  alter publication supabase_realtime add table public.operator_controls;
exception
  when duplicate_object then null;
end $$;
