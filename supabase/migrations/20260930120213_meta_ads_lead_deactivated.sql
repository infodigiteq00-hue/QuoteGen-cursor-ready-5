-- Grey out a Meta ads lead without deleting the row.

ALTER TABLE public.meta_ads_leads
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

COMMENT ON COLUMN public.meta_ads_leads.deactivated_at IS
  'Set when a lead is inactive. The row stays; the admin list greys it out.';

NOTIFY pgrst, 'reload schema';
