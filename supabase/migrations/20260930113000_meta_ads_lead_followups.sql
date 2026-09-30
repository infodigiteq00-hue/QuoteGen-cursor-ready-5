-- Super-admin remarks, follow-up call time, and reminder lead time on Meta ads leads.

ALTER TABLE public.meta_ads_leads
  ADD COLUMN IF NOT EXISTS remarks text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_minutes integer NOT NULL DEFAULT 10;

ALTER TABLE public.meta_ads_leads
  DROP CONSTRAINT IF EXISTS meta_ads_leads_reminder_minutes_check;

ALTER TABLE public.meta_ads_leads
  ADD CONSTRAINT meta_ads_leads_reminder_minutes_check
  CHECK (reminder_minutes IN (5, 10, 15, 30, 60, 1440));

CREATE INDEX IF NOT EXISTS meta_ads_leads_follow_up_at_idx
  ON public.meta_ads_leads (follow_up_at)
  WHERE follow_up_at IS NOT NULL;

COMMENT ON COLUMN public.meta_ads_leads.remarks IS
  'Super-admin notes on this lead.';
COMMENT ON COLUMN public.meta_ads_leads.follow_up_at IS
  'Next follow-up call time.';
COMMENT ON COLUMN public.meta_ads_leads.reminder_minutes IS
  'Minutes before follow_up_at to alert the super-admin.';

NOTIFY pgrst, 'reload schema';
