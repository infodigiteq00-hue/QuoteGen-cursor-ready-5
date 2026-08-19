-- QuoteGen: seller bank details printed on quotations.
-- GSTIN stays on company_profile.gst_number (already used on invoices).

ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS bank_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_account_no text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_ifsc text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.company_profile.bank_name IS 'Seller bank name shown with quotation bank details.';
COMMENT ON COLUMN public.company_profile.bank_account_no IS 'Seller account number shown with quotation bank details.';
COMMENT ON COLUMN public.company_profile.bank_ifsc IS 'Seller IFSC shown with quotation bank details.';
