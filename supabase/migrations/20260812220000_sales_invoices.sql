-- QuoteGen: convert a quotation into a sales (tax) invoice.
--
-- Model: an invoice is a `quotations` row with doc_type = 'invoice'. It reuses the
-- same editor, autosave, typed columns, revisions and PDF export, and keeps a link
-- back to the quotation it came from. The quotation itself is never modified, so
-- "what we quoted" and "what we invoiced" both stay on record.
--
-- Invoices get their OWN number series, because tax invoice numbering must be a
-- continuous sequence of its own and cannot share the quotation counter.
--
-- Access model unchanged: service_role only via Express, filtered by user_id.

-- ---------------------------------------------------------------------------
-- quotations: document type + provenance
-- ---------------------------------------------------------------------------
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'quotation',
  ADD COLUMN IF NOT EXISTS source_quotation_id uuid REFERENCES public.quotations(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.quotations
    ADD CONSTRAINT quotations_doc_type_check CHECK (doc_type IN ('quotation', 'invoice'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS quotations_doc_type_idx ON public.quotations (user_id, doc_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS quotations_source_idx ON public.quotations (source_quotation_id);

COMMENT ON COLUMN public.quotations.doc_type IS 'quotation or invoice. Invoices are converted from a quotation and carry their own number series.';
COMMENT ON COLUMN public.quotations.source_quotation_id IS 'The quotation this invoice was converted from; null for quotations.';

-- ---------------------------------------------------------------------------
-- company_profile: invoice number series, separate from the quotation series
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS invoice_prefix text NOT NULL DEFAULT 'INV',
  ADD COLUMN IF NOT EXISTS invoice_padding integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS invoice_next_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS invoice_include_year boolean NOT NULL DEFAULT true,
  -- Seller GSTIN printed on the invoice. Kept separate from free-form header text
  -- so it can be shown in the invoice's tax details block.
  ADD COLUMN IF NOT EXISTS gst_number text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.company_profile.invoice_prefix IS 'Prefix for the sales invoice series, e.g. INV.';
COMMENT ON COLUMN public.company_profile.gst_number IS 'Seller GSTIN shown on invoices.';

-- ---------------------------------------------------------------------------
-- Atomic per-account invoice numbering, mirroring allocate_quotation_number.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.allocate_invoice_number(uuid);

CREATE FUNCTION public.allocate_invoice_number(p_user_id uuid)
RETURNS TABLE (
  number text,
  prefix text,
  padding integer,
  allocated integer,
  include_year boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.company_profile%ROWTYPE;
  year_part text;
  padded text;
  formatted text;
BEGIN
  -- Without this guard a null id would match no profile and silently insert a
  -- fresh orphan row on every call, handing out duplicate invoice numbers.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'allocate_invoice_number requires a user id';
  END IF;

  SELECT * INTO r
  FROM public.company_profile
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.company_profile (user_id, company_name)
    VALUES (p_user_id, 'My Company')
    RETURNING * INTO r;
  END IF;

  padded := lpad(r.invoice_next_number::text, r.invoice_padding, '0');
  IF r.invoice_include_year THEN
    year_part := to_char(timezone('utc', now()), 'YYYY');
    formatted := r.invoice_prefix || '-' || year_part || '-' || padded;
  ELSE
    formatted := r.invoice_prefix || '-' || padded;
  END IF;

  UPDATE public.company_profile
  SET invoice_next_number = r.invoice_next_number + 1,
      updated_at = now()
  WHERE id = r.id;

  RETURN QUERY SELECT
    formatted, r.invoice_prefix, r.invoice_padding, r.invoice_next_number, r.invoice_include_year;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_invoice_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_invoice_number(uuid) TO service_role;
