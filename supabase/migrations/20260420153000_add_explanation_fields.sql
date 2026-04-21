alter table public.world_state
add column if not exists explanation_status text check (explanation_status in ('idle', 'pending', 'streaming', 'complete', 'error')) default 'idle',
add column if not exists explanation_target_path text,
add column if not exists explanation_agent_id text,
add column if not exists explanation_content_hash text,
add column if not exists explanation_text text,
add column if not exists explanation_error text,
add column if not exists explanation_updated_at_tick integer;
