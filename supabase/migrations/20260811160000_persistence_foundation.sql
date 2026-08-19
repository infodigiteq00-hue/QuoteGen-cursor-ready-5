-- QuoteGen Step 1: persistence foundation
-- Access model: Express uses SUPABASE_SERVICE_ROLE_KEY only.
-- RLS is enabled with no anon/authenticated policies (service_role bypasses RLS).

-- ---------------------------------------------------------------------------
-- company_profile (single-tenant settings + quotation series)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL DEFAULT '',
  header_text text NOT NULL DEFAULT '',
  footer_text text NOT NULL DEFAULT '',
  logo_url text,
  logo_path text,
  logo_width integer,
  logo_height integer,
  series_prefix text NOT NULL DEFAULT 'QG',
  series_padding integer NOT NULL DEFAULT 4 CHECK (series_padding >= 1 AND series_padding <= 12),
  series_next_number integer NOT NULL DEFAULT 1 CHECK (series_next_number >= 1),
  series_include_year boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.company_profile IS 'Single-tenant company settings and configurable quotation series.';
COMMENT ON COLUMN public.company_profile.header_text IS 'Placeholder for quotation header text (UI later).';
COMMENT ON COLUMN public.company_profile.footer_text IS 'Placeholder for quotation footer text (UI later).';
COMMENT ON COLUMN public.company_profile.logo_url IS 'Public or signed logo URL placeholder.';
COMMENT ON COLUMN public.company_profile.logo_path IS 'Storage path placeholder for logo asset.';
COMMENT ON COLUMN public.company_profile.logo_width IS 'Logo display width placeholder (px).';
COMMENT ON COLUMN public.company_profile.logo_height IS 'Logo display height placeholder (px).';

-- ---------------------------------------------------------------------------
-- quotations (full quote JSON; columns may include optional type)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text,
  title text,
  quote_date text,
  layout_ref text,
  -- Full quote payload for autosave later:
  -- { title, number, date, columns:[{id,label,type?}], customer, items, notes,
  --   clarifications, terms, layout refs, ... }
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotations_updated_at_idx ON public.quotations (updated_at DESC);
CREATE INDEX IF NOT EXISTS quotations_number_idx ON public.quotations (number);
CREATE INDEX IF NOT EXISTS quotations_data_gin_idx ON public.quotations USING gin (data);

COMMENT ON COLUMN public.quotations.data IS 'Full quotation JSON including columns with optional type for default and uploaded layouts.';

-- ---------------------------------------------------------------------------
-- products (HSN/GST cache seed source; AI lookup UI later)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  description text NOT NULL DEFAULT '',
  hsn text NOT NULL DEFAULT '',
  gst text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_key_unique UNIQUE (key)
);

CREATE INDEX IF NOT EXISTS products_key_idx ON public.products (key);
CREATE INDEX IF NOT EXISTS products_updated_at_idx ON public.products (updated_at DESC);

-- ---------------------------------------------------------------------------
-- hsn_cache (lookup cache keyed by product/description text)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.hsn_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  description text NOT NULL DEFAULT '',
  hsn text NOT NULL DEFAULT '',
  gst text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hsn_cache_key_unique UNIQUE (key)
);

CREATE INDEX IF NOT EXISTS hsn_cache_key_idx ON public.hsn_cache (key);

-- ---------------------------------------------------------------------------
-- knowledge_documents (stub for later knowledge base)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  mime text,
  extracted_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS knowledge_documents_created_at_idx
  ON public.knowledge_documents (created_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS company_profile_set_updated_at ON public.company_profile;
CREATE TRIGGER company_profile_set_updated_at
  BEFORE UPDATE ON public.company_profile
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS quotations_set_updated_at ON public.quotations;
CREATE TRIGGER quotations_set_updated_at
  BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS products_set_updated_at ON public.products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS hsn_cache_set_updated_at ON public.hsn_cache;
CREATE TRIGGER hsn_cache_set_updated_at
  BEFORE UPDATE ON public.hsn_cache
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Atomic quotation number allocation (FOR UPDATE)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.allocate_quotation_number()
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
  SELECT * INTO r
  FROM public.company_profile
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.company_profile DEFAULT VALUES
    RETURNING * INTO r;
  END IF;

  padded := lpad(r.series_next_number::text, r.series_padding, '0');
  IF r.series_include_year THEN
    year_part := to_char(timezone('utc', now()), 'YYYY');
    formatted := r.series_prefix || '-' || year_part || '-' || padded;
  ELSE
    formatted := r.series_prefix || '-' || padded;
  END IF;

  UPDATE public.company_profile
  SET series_next_number = r.series_next_number + 1,
      updated_at = now()
  WHERE id = r.id;

  RETURN QUERY SELECT
    formatted,
    r.series_prefix,
    r.series_padding,
    r.series_next_number,
    r.series_include_year;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_quotation_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_quotation_number() TO service_role;

-- ---------------------------------------------------------------------------
-- Seed: default company profile + product-master sample
-- ---------------------------------------------------------------------------
INSERT INTO public.company_profile (
  company_name, series_prefix, series_padding, series_next_number, series_include_year
)
SELECT 'QuoteGen', 'QG', 4, 1, true
WHERE NOT EXISTS (SELECT 1 FROM public.company_profile);

INSERT INTO public.products (key, description, hsn, gst)
VALUES ('ss 304 flanges', 'SS 304 Flanges', '7307', '18')
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    hsn = EXCLUDED.hsn,
    gst = EXCLUDED.gst,
    updated_at = now();

INSERT INTO public.hsn_cache (key, description, hsn, gst)
VALUES ('ss 304 flanges', 'SS 304 Flanges', '7307', '18')
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    hsn = EXCLUDED.hsn,
    gst = EXCLUDED.gst,
    updated_at = now();

-- ---------------------------------------------------------------------------
-- RLS: enabled, no public policies — Data API blocked for anon/authenticated.
-- service_role bypasses RLS for Express server access.
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hsn_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_profile FROM anon, authenticated;
REVOKE ALL ON TABLE public.quotations FROM anon, authenticated;
REVOKE ALL ON TABLE public.products FROM anon, authenticated;
REVOKE ALL ON TABLE public.hsn_cache FROM anon, authenticated;
REVOKE ALL ON TABLE public.knowledge_documents FROM anon, authenticated;

GRANT ALL ON TABLE public.company_profile TO service_role;
GRANT ALL ON TABLE public.quotations TO service_role;
GRANT ALL ON TABLE public.products TO service_role;
GRANT ALL ON TABLE public.hsn_cache TO service_role;
GRANT ALL ON TABLE public.knowledge_documents TO service_role;
