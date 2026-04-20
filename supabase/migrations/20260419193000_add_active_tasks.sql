alter table public.world_state
add column if not exists active_tasks jsonb default null;
