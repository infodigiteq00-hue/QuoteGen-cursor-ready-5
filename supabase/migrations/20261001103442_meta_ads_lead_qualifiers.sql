-- Extra answers on the existing Meta ads lead form.
alter table public.meta_ads_leads
  add column if not exists monthly_quotes text,
  add column if not exists industry text;

notify pgrst, 'reload schema';
