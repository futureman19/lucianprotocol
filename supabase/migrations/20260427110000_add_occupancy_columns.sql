-- Add multi-tile occupancy columns for true 3×3 building lots

alter table public.entities
add column if not exists occupancy_width integer not null default 1 check (occupancy_width >= 1 and occupancy_width <= 3),
add column if not exists occupancy_depth integer not null default 1 check (occupancy_depth >= 1 and occupancy_depth <= 3);
