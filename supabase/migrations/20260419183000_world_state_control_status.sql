alter table public.world_state
add column if not exists control_status text check (control_status in ('idle', 'importing', 'active', 'error')) default 'idle',
add column if not exists control_error text,
add column if not exists operator_action text check (operator_action in ('navigate', 'read', 'explain', 'maintain')),
add column if not exists operator_target_query text,
add column if not exists operator_target_path text,
add column if not exists import_started_at timestamp with time zone,
add column if not exists import_finished_at timestamp with time zone,
add column if not exists last_import_duration_ms integer,
add column if not exists last_tick_duration_ms integer,
add column if not exists last_ai_latency_ms integer,
add column if not exists max_ai_latency_ms integer,
add column if not exists queue_depth integer not null default 0;
