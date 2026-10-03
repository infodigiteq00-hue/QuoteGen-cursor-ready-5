alter table public.meta_ads_leads
  add column if not exists whatsapp text;

notify pgrst, 'reload schema';
