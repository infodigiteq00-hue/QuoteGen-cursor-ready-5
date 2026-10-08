alter table public.demo_quote_counts
  add column if not exists pdfs_exported integer not null default 0;

notify pgrst, 'reload schema';
