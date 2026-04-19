alter table public.entities
add column if not exists agent_role text check (agent_role in ('visionary', 'architect', 'critic')),
add column if not exists node_state text check (node_state in ('task', 'in-progress', 'asymmetry', 'stable', 'verified')),
add column if not exists lock_owner text,
add column if not exists lock_tick integer,
add column if not exists state_tick integer,
add column if not exists objective_path text;
