-- QuoteGen: Meta ads landing page leads (trial form).
-- Public form posts via service role API. Super-admin reads via authenticated admin API.

CREATE TABLE IF NOT EXISTS public.meta_ads_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  company text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'meta_ads_landing',
  path text NOT NULL DEFAULT '',
  query text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_ads_leads_created_at_idx
  ON public.meta_ads_leads (created_at DESC);

CREATE INDEX IF NOT EXISTS meta_ads_leads_email_idx
  ON public.meta_ads_leads (email);

COMMENT ON TABLE public.meta_ads_leads IS
  'Leads from /metaadslanding trial form. Inserted by server service role; listed for super-admin.';

ALTER TABLE public.meta_ads_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_ads_leads FROM anon, authenticated;
GRANT ALL ON TABLE public.meta_ads_leads TO service_role;

NOTIFY pgrst, 'reload schema';
