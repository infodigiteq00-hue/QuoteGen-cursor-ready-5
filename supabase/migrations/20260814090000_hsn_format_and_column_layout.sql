-- QuoteGen: two company-level preferences.
--
-- hsn_code_format: how many digits Fetch HSN/GST fills in ('4' default, or '8').
-- column_layout: the saved default column set (name + type) used to seed every
-- new quotation, so a company doesn't have to rebuild its columns each time.
--
-- Access model unchanged: service_role only (RLS on, no anon/authenticated policies).

ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS hsn_code_format text NOT NULL DEFAULT '4',
  ADD COLUMN IF NOT EXISTS column_layout jsonb;

COMMENT ON COLUMN public.company_profile.hsn_code_format IS 'Digit length to show when auto-filling HSN codes: "4" or "8".';
COMMENT ON COLUMN public.company_profile.column_layout IS 'Saved default column set ([{id,label,type,...}]) used to seed every new quotation. Null = use the built-in default columns.';
