-- QuoteGen: two company-level additions.
--
-- numbering_note / invoice_numbering_note: an optional free-text description
-- of how the user wants their quotation/invoice numbers to work (e.g. "we're
-- currently on QG-2026-0530, continue from there, no leading zeros past 4
-- digits"). The AI reads this once, when the user asks it to set the series
-- up, and fills in the real series_prefix/padding/next_number columns that
-- already drive the deterministic per-quote counter — the note itself never
-- runs at generation time, so numbering stays sequential and safe.
--
-- default_upload_template_id: which uploaded layout (upload_templates.id) new
-- quotations start from by default. Null = the built-in QuoteGen layout.
--
-- Access model unchanged: service_role only (RLS on, no anon/authenticated policies).

ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS numbering_note text,
  ADD COLUMN IF NOT EXISTS invoice_numbering_note text,
  ADD COLUMN IF NOT EXISTS default_upload_template_id text;

COMMENT ON COLUMN public.company_profile.numbering_note IS 'Free-text instructions for the quotation number series, interpreted by AI into series_prefix/padding/next_number.';
COMMENT ON COLUMN public.company_profile.invoice_numbering_note IS 'Free-text instructions for the invoice number series, interpreted by AI into invoice_prefix/padding/next_number.';
COMMENT ON COLUMN public.company_profile.default_upload_template_id IS 'upload_templates.id to use for every new quotation by default; null = built-in QuoteGen layout.';
