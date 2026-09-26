-- Super-admin account controls: pause / remove + quote quotas.
-- Extends user_profiles (service-role only).

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS quote_limit_count integer,
  ADD COLUMN IF NOT EXISTS quote_limit_period text,
  ADD COLUMN IF NOT EXISTS admin_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_account_status_chk'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_account_status_chk
      CHECK (account_status IN ('active', 'paused', 'removed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_quote_limit_period_chk'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_quote_limit_period_chk
      CHECK (quote_limit_period IS NULL OR quote_limit_period IN ('day', 'month', 'year'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_quote_limit_count_chk'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_quote_limit_count_chk
      CHECK (quote_limit_count IS NULL OR quote_limit_count >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.user_profiles.account_status IS
  'active = normal; paused = cannot create new quotes; removed = soft-disabled account';
COMMENT ON COLUMN public.user_profiles.quote_limit_count IS
  'Max quotations allowed in the current period; NULL = unlimited';
COMMENT ON COLUMN public.user_profiles.quote_limit_period IS
  'day | month | year — limit resets at the start of each period';

NOTIFY pgrst, 'reload schema';
