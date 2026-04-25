alter table public.entities
add column if not exists lmm_rule text default null,
add column if not exists cargo integer not null default 0 check (cargo >= 0),
add column if not exists birth_tick integer not null default 0 check (birth_tick >= 0),
add column if not exists state_register integer not null default 0 check (state_register >= 0 and state_register <= 255);
