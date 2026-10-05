create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  lead_id uuid,
  amount integer not null check (amount > 0 and amount <= 500000),
  label text not null,
  quotes_per_month integer,
  period text not null default 'month',
  valid_till date,
  status text not null default 'pending',
  phonepe_order_id text,
  created_at timestamptz not null default now()
);

create index if not exists payment_requests_email_status_idx
  on public.payment_requests (email, status, created_at desc);

alter table public.payment_requests enable row level security;

notify pgrst, 'reload schema';
