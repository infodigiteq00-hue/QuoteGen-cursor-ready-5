-- New /demo accounts are metered. Existing accounts leave these null and stay unlimited.
alter table public.user_profiles
  add column if not exists billing_plan text,
  add column if not exists quote_credits integer,
  add column if not exists subscribed_at timestamptz,
  add column if not exists password_set_at timestamptz;

notify pgrst, 'reload schema';
