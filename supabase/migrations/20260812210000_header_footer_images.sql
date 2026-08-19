-- QuoteGen: uploadable header and footer images for the quotation letterhead.
--
-- The logo sits beside the company name; these are full-width banner images that
-- REPLACE the header block / footer line entirely, for companies whose letterhead
-- is a designed graphic rather than text.
--
-- Access model unchanged: service_role only (RLS on, no anon/authenticated policies).

ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS header_image_url  text,
  ADD COLUMN IF NOT EXISTS header_image_path text,
  ADD COLUMN IF NOT EXISTS footer_image_url  text,
  ADD COLUMN IF NOT EXISTS footer_image_path text;

COMMENT ON COLUMN public.company_profile.header_image_url  IS 'Public URL (or inline data URL) of the header banner; replaces the text header when set.';
COMMENT ON COLUMN public.company_profile.header_image_path IS 'Storage object path for the header banner, so a replaced image can be deleted.';
COMMENT ON COLUMN public.company_profile.footer_image_url  IS 'Public URL (or inline data URL) of the footer banner; replaces the footer text when set.';
COMMENT ON COLUMN public.company_profile.footer_image_path IS 'Storage object path for the footer banner, so a replaced image can be deleted.';
