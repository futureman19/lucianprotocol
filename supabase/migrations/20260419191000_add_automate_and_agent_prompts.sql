alter table public.operator_controls
add column if not exists automate boolean not null default false,
add column if not exists visionary_prompt text not null default '',
add column if not exists architect_prompt text not null default '',
add column if not exists critic_prompt text not null default '';

alter table public.world_state
add column if not exists automate boolean not null default false,
add column if not exists visionary_prompt text not null default '',
add column if not exists architect_prompt text not null default '',
add column if not exists critic_prompt text not null default '';
