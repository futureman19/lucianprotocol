alter table public.entities
add column if not exists last_commit_sha text,
add column if not exists last_commit_message text,
add column if not exists last_commit_author text,
add column if not exists last_commit_date text,
add column if not exists git_diff text;

alter table public.operator_controls
add column if not exists pending_edit_path text,
add column if not exists pending_edit_content text,
add column if not exists commit_message text,
add column if not exists should_push boolean not null default false;

alter table public.world_state
add column if not exists pending_edit_path text,
add column if not exists pending_edit_content text,
add column if not exists commit_message text,
add column if not exists should_push boolean not null default false;
