alter table public.operator_controls
add column if not exists paused boolean not null default false;

alter table public.world_state
add column if not exists paused boolean not null default false,
add column if not exists saved_overlay_names text[] not null default '{}';
