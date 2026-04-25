-- Fix missing columns that cause PGRST204 errors during engine sync

-- entities table
alter table public.entities
add column if not exists z integer not null default 0 check (z >= 0 and z < 50);

alter table public.entities
add column if not exists tether_to text[] default null,
add column if not exists tether_from text[] default null,
add column if not exists tether_broken boolean default null;

-- Update type check to include pheromone
alter table public.entities
drop constraint if exists entities_type_check;

alter table public.entities
add constraint entities_type_check
check (type in ('agent', 'wall', 'goal', 'file', 'directory', 'pheromone'));

-- world_state table
alter table public.world_state
add column if not exists queen_cycle integer default null,
add column if not exists queen_alarm integer default null check (queen_alarm >= 0 and queen_alarm <= 255),
add column if not exists queen_urgency integer default null check (queen_urgency >= 0 and queen_urgency <= 255),
add column if not exists agent_activities jsonb default null;
