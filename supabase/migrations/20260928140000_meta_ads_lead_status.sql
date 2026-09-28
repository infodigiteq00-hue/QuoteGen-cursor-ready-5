-- Funnel stage on Meta ads leads: form only, started demo/setup, or paid.

ALTER TABLE public.meta_ads_leads
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'lead',
  ADD COLUMN IF NOT EXISTS intent text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS demo_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchased_at timestamptz,
  ADD COLUMN IF NOT EXISTS purchase_amount integer,
  ADD COLUMN IF NOT EXISTS purchase_order_id text;

ALTER TABLE public.meta_ads_leads
  DROP CONSTRAINT IF EXISTS meta_ads_leads_status_check;

ALTER TABLE public.meta_ads_leads
  ADD CONSTRAINT meta_ads_leads_status_check
  CHECK (status IN ('lead', 'demo', 'purchased'));

CREATE INDEX IF NOT EXISTS meta_ads_leads_status_idx
  ON public.meta_ads_leads (status);

CREATE INDEX IF NOT EXISTS meta_ads_leads_purchase_order_idx
  ON public.meta_ads_leads (purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

COMMENT ON COLUMN public.meta_ads_leads.status IS
  'Funnel stage: lead (form only), demo (started trial), purchased (PhonePe completed).';

NOTIFY pgrst, 'reload schema';
