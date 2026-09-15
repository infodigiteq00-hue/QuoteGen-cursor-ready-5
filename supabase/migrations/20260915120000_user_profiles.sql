-- QuoteGen: per-user contact profile (mobile) for signup + super-admin directory.
-- Service role only (same access model as feature_interest / quotations).

CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  phone_digits text,
  phone_e164 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_phone_digits_chk
    CHECK (phone_digits IS NULL OR phone_digits ~ '^[6-9][0-9]{9}$'),
  CONSTRAINT user_profiles_phone_e164_chk
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+91[6-9][0-9]{9}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_phone_digits_uidx
  ON public.user_profiles (phone_digits)
  WHERE phone_digits IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_profiles_email_idx
  ON public.user_profiles (email);

COMMENT ON TABLE public.user_profiles IS
  'Signup contact details (India +91 mobile). Passwords stay in Auth hashes only.';

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.user_profiles FROM anon, authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;

NOTIFY pgrst, 'reload schema';
