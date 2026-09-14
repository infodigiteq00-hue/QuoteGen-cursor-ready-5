-- QuoteGen: waitlist votes for features (e.g. custom Word/Excel upload).
-- One row per user per feature. Service role only (same access model as quotations).

CREATE TABLE IF NOT EXISTS public.feature_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  email text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, feature)
);

CREATE INDEX IF NOT EXISTS feature_interest_feature_idx
  ON public.feature_interest (feature, created_at DESC);

COMMENT ON TABLE public.feature_interest IS
  'Users who tapped “Yes I’m interested” on a coming-soon feature. One vote per account.';

ALTER TABLE public.feature_interest ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.feature_interest FROM anon, authenticated;
GRANT ALL ON TABLE public.feature_interest TO service_role;

-- Ensure PostgREST sees the new table immediately.
NOTIFY pgrst, 'reload schema';
