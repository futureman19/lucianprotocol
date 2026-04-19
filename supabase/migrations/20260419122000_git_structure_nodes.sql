alter table public.entities
drop constraint if exists entities_type_check;

alter table public.entities
add constraint entities_type_check
check (type in ('agent', 'wall', 'goal', 'file', 'directory'));

alter table public.entities
add column if not exists name text,
add column if not exists path text,
add column if not exists extension text,
add column if not exists descriptor text,
add column if not exists content text,
add column if not exists content_preview text,
add column if not exists content_hash text,
add column if not exists git_status text,
add column if not exists repo_root text,
add column if not exists is_binary boolean;
