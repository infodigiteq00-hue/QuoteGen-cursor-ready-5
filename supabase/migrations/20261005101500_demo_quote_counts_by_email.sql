create table if not exists public.demo_quote_counts (
  email text primary key,
  used integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.demo_quote_counts enable row level security;

notify pgrst, 'reload schema';
