create table if not exists knowledge_graphs (
  id uuid primary key default gen_random_uuid(),
  repo_name text not null,
  head_sha text not null,
  graph_json jsonb not null,
  generated_at timestamptz not null default now(),
  unique(repo_name, head_sha)
);

create index idx_knowledge_graphs_repo on knowledge_graphs(repo_name, head_sha desc);

alter table knowledge_graphs enable row level security;
