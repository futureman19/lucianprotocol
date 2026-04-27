alter table public.entities
drop constraint if exists entities_type_check;

alter table public.entities
add constraint entities_type_check
check (type in ('agent', 'wall', 'goal', 'file', 'directory', 'pheromone', 'command_center', 'particle', 'rubble'));

alter table public.entities
add column if not exists ttl_ticks integer default null check (ttl_ticks is null or ttl_ticks >= 0),
add column if not exists target_height integer not null default 0 check (target_height >= 0),
add column if not exists current_height integer not null default 0 check (current_height >= 0),
add column if not exists edit_count integer not null default 0 check (edit_count >= 0),
add column if not exists last_edit_tick integer default null check (last_edit_tick is null or last_edit_tick >= 0),
add column if not exists ivy_coverage double precision not null default 0 check (ivy_coverage >= 0 and ivy_coverage <= 1),
add column if not exists building_archetype text default null check (building_archetype is null or building_archetype in ('tower', 'warehouse', 'shopfront', 'campus', 'factory', 'civic', 'substation', 'landmark')),
add column if not exists importance_tier integer not null default 0 check (importance_tier >= 0 and importance_tier <= 3),
add column if not exists activity_level double precision not null default 0 check (activity_level >= 0 and activity_level <= 1),
add column if not exists occupancy double precision not null default 0 check (occupancy >= 0 and occupancy <= 1),
add column if not exists condition text default null check (condition is null or condition in ('pristine', 'maintained', 'worn', 'decaying', 'condemned')),
add column if not exists upgrade_level integer not null default 0 check (upgrade_level >= 0 and upgrade_level <= 3),
add column if not exists power_state text default null check (power_state is null or power_state in ('normal', 'strained', 'overloaded', 'offline')),
add column if not exists network_load double precision not null default 0 check (network_load >= 0 and network_load <= 1),
add column if not exists traffic_load double precision not null default 0 check (traffic_load >= 0 and traffic_load <= 1),
add column if not exists construction_phase text default 'complete' check (construction_phase in ('excavation', 'frame', 'facade', 'fitout', 'complete')),
add column if not exists demolition_phase text default null check (demolition_phase is null or demolition_phase in ('marked', 'stripping', 'collapse', 'cleared')),
add column if not exists weather_wetness double precision not null default 0 check (weather_wetness >= 0 and weather_wetness <= 1),
add column if not exists weather_snow_cover double precision not null default 0 check (weather_snow_cover >= 0 and weather_snow_cover <= 1),
add column if not exists weather_fog_factor double precision not null default 0 check (weather_fog_factor >= 0 and weather_fog_factor <= 1),
add column if not exists landmark_role text not null default 'none' check (landmark_role in ('none', 'entry', 'critical', 'hub', 'control'));

alter table public.world_state
add column if not exists weather text default 'clear'
check (weather in ('clear', 'rain', 'snow', 'fog'));

alter table public.operator_controls
add column if not exists weather_override text default null
check (weather_override is null or weather_override in ('clear', 'rain', 'snow', 'fog'));
