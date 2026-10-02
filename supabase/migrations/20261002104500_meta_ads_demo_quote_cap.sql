-- Count demo quotations made from quotegen.ai/demo, capped in the app at 10.
alter table public.meta_ads_leads
  add column if not exists demo_quotes_used integer not null default 0;

notify pgrst, 'reload schema';
