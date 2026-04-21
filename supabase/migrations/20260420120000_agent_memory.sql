alter table public.entities
add column if not exists memory jsonb default null;
