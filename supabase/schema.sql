create table if not exists public.entities (
  id text primary key,
  type text not null check (type in ('agent', 'wall', 'goal', 'file', 'directory')),
  x integer not null check (x >= 0 and x < 50),
  y integer not null check (y >= 0 and y < 50),
  mass integer not null default 1,
  tick_updated integer not null default 0,
  agent_role text check (agent_role in ('visionary', 'architect', 'critic')),
  node_state text check (node_state in ('task', 'in-progress', 'asymmetry', 'stable', 'verified')),
  lock_owner text,
  lock_tick integer,
  state_tick integer,
  objective_path text,
  name text,
  path text,
  extension text,
  descriptor text,
  content text,
  content_preview text,
  content_hash text,
  git_status text,
  repo_root text,
  is_binary boolean,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.world_state (
  id text primary key,
  seed text not null,
  tick integer not null default 0,
  phase integer not null default 0,
  status text not null check (status in ('booting', 'running', 'goal-reached', 'stalled')),
  updated_at timestamp with time zone not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_entities_updated_at on public.entities;
create trigger touch_entities_updated_at
before update on public.entities
for each row execute function public.touch_updated_at();

drop trigger if exists touch_world_state_updated_at on public.world_state;
create trigger touch_world_state_updated_at
before update on public.world_state
for each row execute function public.touch_updated_at();

alter table public.entities enable row level security;
alter table public.world_state enable row level security;

drop policy if exists "public read entities" on public.entities;
create policy "public read entities"
on public.entities
for select
using (true);

drop policy if exists "public read world_state" on public.world_state;
create policy "public read world_state"
on public.world_state
for select
using (true);

do $$
begin
  alter publication supabase_realtime add table public.entities;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.world_state;
exception
  when duplicate_object then null;
end $$;
