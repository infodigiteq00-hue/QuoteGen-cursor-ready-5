-- Star and colored tags on Meta ads leads.

ALTER TABLE public.meta_ads_leads
  ADD COLUMN IF NOT EXISTS starred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS meta_ads_leads_starred_idx
  ON public.meta_ads_leads (created_at DESC)
  WHERE starred;

COMMENT ON COLUMN public.meta_ads_leads.starred IS
  'Pinned to the top of the Meta ads leads list.';
COMMENT ON COLUMN public.meta_ads_leads.tags IS
  'Colored labels: [{ "label": "Hot", "color": "#C2410C" }].';

NOTIFY pgrst, 'reload schema';
