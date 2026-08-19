-- ===========================================================================
-- QuoteGen — ONE-SHOT SETUP FOR PER-ACCOUNT DATA
--
-- HOW TO RUN
--   Supabase dashboard -> your project (fonozbojyzdnmgyhonfr)
--   -> SQL Editor -> New query -> paste this whole file -> Run
--
-- WHAT IT DOES
--   A. Adds the two products image columns from Step 8 (that migration was
--      written but never applied).
--   B. Makes company_profile / quotations / products / knowledge_documents
--      per-account, backfills every existing row to your account, and gives
--      each account its own quotation number series.
--
-- It is wrapped in a transaction: if anything fails, nothing is applied.
-- It is safe to run more than once.
--
-- Mirrors: supabase/migrations/20260812100000_product_image_memory.sql
--          supabase/migrations/20260812120000_multi_tenant_auth.sql
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- A. Step 8 image memory columns (never applied)
--    server/knowledge.js writes these; without them it silently retries the
--    upsert without the image and learned images are lost.
-- ---------------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url  text NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_path text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.products.image_url IS 'Learned image URL from a previously quoted line item; empty if none.';
COMMENT ON COLUMN public.products.image_path IS 'Storage path for the learned image (quote-assets bucket), for cleanup on replace.';

-- ---------------------------------------------------------------------------
-- B1. user_id columns
--
--     hsn_cache is intentionally NOT included: HSN codes and GST percentages
--     are public statutory tax data, so one shared cache means a code looked
--     up once is never paid for again. Rates are per-account (products).
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- B2. BACKFILL — hand every existing row to dharmikchokhaliya62@gmail.com
--     (auth.users id 85adff78-ea45-4607-b22e-299fdf59ea0c)
--
--     Skip this and your 16 quotations, 23 products, 5 knowledge documents and
--     company branding become visible to nobody, because from here on every
--     server query filters by user_id.
-- ---------------------------------------------------------------------------
UPDATE public.company_profile     SET user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c' WHERE user_id IS NULL;
UPDATE public.quotations          SET user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c' WHERE user_id IS NULL;
UPDATE public.products            SET user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c' WHERE user_id IS NULL;
UPDATE public.knowledge_documents SET user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c' WHERE user_id IS NULL;

-- ---------------------------------------------------------------------------
-- B3. user_id is mandatory from here on, so a row can never be orphaned.
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_profile     ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.quotations          ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.products            ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.knowledge_documents ALTER COLUMN user_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- B4. Indexes and constraints
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS company_profile_user_id_unique
  ON public.company_profile (user_id);

CREATE INDEX IF NOT EXISTS quotations_user_id_idx ON public.quotations (user_id);
CREATE INDEX IF NOT EXISTS knowledge_documents_user_id_idx ON public.knowledge_documents (user_id);

-- Product keys unique PER ACCOUNT. The old global UNIQUE (key) would have let
-- the second account's upsert overwrite the first account's rate.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_key_unique;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_user_key_unique;
ALTER TABLE public.products
  ADD CONSTRAINT products_user_key_unique UNIQUE (user_id, key);

-- ---------------------------------------------------------------------------
-- B5. allocate_quotation_number becomes PER ACCOUNT.
--     The old no-argument version read whichever company_profile row was
--     created first, so every account would have shared one number sequence.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.allocate_quotation_number();
DROP FUNCTION IF EXISTS public.allocate_quotation_number(uuid);

CREATE FUNCTION public.allocate_quotation_number(p_user_id uuid)
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
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'allocate_quotation_number requires a user id';
  END IF;

  SELECT * INTO r
  FROM public.company_profile
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.company_profile (
      user_id, company_name, series_prefix, series_padding, series_next_number, series_include_year
    )
    VALUES (p_user_id, 'My Company', 'QG', 4, 1, true)
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
    formatted, r.series_prefix, r.series_padding, r.series_next_number, r.series_include_year;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_quotation_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_quotation_number(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- B6. search_knowledge_documents becomes PER ACCOUNT, so one account's
--     knowledge base can never be retrieved for another account's enquiry.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_knowledge_documents(text, integer);
DROP FUNCTION IF EXISTS public.search_knowledge_documents(text, uuid, integer);

CREATE FUNCTION public.search_knowledge_documents(
  query text,
  p_user_id uuid,
  max_rows integer DEFAULT 12
)
RETURNS TABLE (
  id uuid,
  filename text,
  mime text,
  snippet text,
  rank real,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT websearch_to_tsquery('english', coalesce(nullif(trim(query), ''), 'empty')) AS tsq
  )
  SELECT
    d.id, d.filename, d.mime,
    left(coalesce(d.extracted_text, ''), 600) AS snippet,
    ts_rank_cd(d.search_tsv, q.tsq) AS rank,
    d.created_at
  FROM public.knowledge_documents d, q
  WHERE d.user_id = p_user_id AND d.search_tsv @@ q.tsq
  ORDER BY rank DESC, d.created_at DESC
  LIMIT greatest(1, least(coalesce(max_rows, 12), 50));
$$;

REVOKE ALL ON FUNCTION public.search_knowledge_documents(text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_knowledge_documents(text, uuid, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- B7. Re-assert the access model. An anon key now ships in the browser bundle,
--     so the Data API must stay shut to it: RLS on, no policies, no grants to
--     anon/authenticated. Only service_role (Express) gets through.
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_profile     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hsn_cache           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_profile     FROM anon, authenticated;
REVOKE ALL ON TABLE public.quotations          FROM anon, authenticated;
REVOKE ALL ON TABLE public.products            FROM anon, authenticated;
REVOKE ALL ON TABLE public.hsn_cache           FROM anon, authenticated;
REVOKE ALL ON TABLE public.knowledge_documents FROM anon, authenticated;

GRANT ALL ON TABLE public.company_profile     TO service_role;
GRANT ALL ON TABLE public.quotations          TO service_role;
GRANT ALL ON TABLE public.products            TO service_role;
GRANT ALL ON TABLE public.hsn_cache           TO service_role;
GRANT ALL ON TABLE public.knowledge_documents TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Confirmation: every count below should equal your existing row count, and
-- orphans must be 0.
-- ---------------------------------------------------------------------------
SELECT 'company_profile' AS table_name, count(*) AS rows_for_you FROM public.company_profile     WHERE user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c'
UNION ALL SELECT 'quotations',          count(*) FROM public.quotations          WHERE user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c'
UNION ALL SELECT 'products',            count(*) FROM public.products            WHERE user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c'
UNION ALL SELECT 'knowledge_documents', count(*) FROM public.knowledge_documents WHERE user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c';
