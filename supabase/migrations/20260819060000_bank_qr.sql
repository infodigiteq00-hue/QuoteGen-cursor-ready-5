-- QuoteGen: UPI / payment QR printed beside company bank details.

ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS bank_qr_url text,
  ADD COLUMN IF NOT EXISTS bank_qr_path text;

COMMENT ON COLUMN public.company_profile.bank_qr_url IS 'Public URL (or inline data URL) of the payment QR shown with bank details.';
COMMENT ON COLUMN public.company_profile.bank_qr_path IS 'Storage object path for the bank QR, so a replaced image can be deleted.';
