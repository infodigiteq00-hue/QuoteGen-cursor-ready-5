-- QuoteGen: multi-tenant auth (Supabase Auth email/password login).
--
-- Every company_profile / quotations / products / knowledge_documents row now
-- belongs to exactly one auth.users row, so each account has its own company
-- branding, quotation history, quotation number series, product rates and
-- knowledge base.
--
-- hsn_cache stays GLOBAL on purpose: HSN codes and GST percentages are public
-- statutory tax classification data, not per-account information, so one shared
-- cache means an HSN looked up once is never paid for again by anyone. Note the
-- trade-off: hsn_cache.description is seeded from whichever account first
-- looked the item up, so item *descriptions* are shared between accounts.
-- Rates are NOT shared — those live in products, which is per-account.
--
-- Access model unchanged: Express holds SUPABASE_SERVICE_ROLE_KEY and filters
-- every query by the authenticated user's id (server/auth.js requireAuth).
-- RLS stays enabled with no anon/authenticated policies, which matters now that
-- an anon key ships in the browser: the Data API must stay shut to it.
--
-- Safe to run more than once.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. user_id columns
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
-- 2. BACKFILL — assign all pre-login rows to the first account.
--
--    dharmikchokhaliya62@gmail.com = 85adff78-ea45-4607-b22e-299fdf59ea0c
--
--    Without this, every existing row keeps user_id = NULL and becomes visible
--    to nobody, because every server query filters on user_id.
-- ---------------------------------------------------------------------------
UPDATE public.company_profile     SET user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c' WHERE user_id IS NULL;
UPDATE public.quotations          SET user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c' WHERE user_id IS NULL;
UPDATE public.products            SET user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c' WHERE user_id IS NULL;
UPDATE public.knowledge_documents SET user_id = '85adff78-ea45-4607-b22e-299fdf59ea0c' WHERE user_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. user_id is mandatory from here on.
--
--    A NULL user_id row is invisible to every account (PostgREST `eq.` never
--    matches NULL), so silently orphaning a row is worse than failing loudly.
--    Every insert path in server/ already sets user_id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_profile     ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.quotations          ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.products            ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.knowledge_documents ALTER COLUMN user_id SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Indexes and constraints
-- ---------------------------------------------------------------------------

-- Exactly one company profile (branding + series counter) per account.
CREATE UNIQUE INDEX IF NOT EXISTS company_profile_user_id_unique
  ON public.company_profile (user_id);

CREATE INDEX IF NOT EXISTS quotations_user_id_idx ON public.quotations (user_id);
CREATE INDEX IF NOT EXISTS knowledge_documents_user_id_idx ON public.knowledge_documents (user_id);

-- Product keys are unique per account, not globally: two accounts can each have
-- "ss 304 flanges" at their own rate. The old global UNIQUE (key) would have
-- made the second account's upsert overwrite the first account's row.
-- No separate products(user_id) index is needed — user_id leads this one.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_key_unique;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_user_key_unique;
ALTER TABLE public.products
  ADD CONSTRAINT products_user_key_unique UNIQUE (user_id, key);

-- quotations.number is deliberately NOT unique: each account runs its own
-- series, so QG-2026-0001 legitimately exists once per account.

-- ---------------------------------------------------------------------------
-- 5. allocate_quotation_number becomes per-account
--
--    This is the important one. The old zero-argument version took whichever
--    company_profile row was created first, so every account would have shared
--    a single number sequence.
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
  -- Guard: a NULL id would match no row and then insert an orphan profile on
  -- every call, quietly handing out duplicate numbers.
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
    formatted,
    r.series_prefix,
    r.series_padding,
    r.series_next_number,
    r.series_include_year;
END;
$$;

REVOKE ALL ON FUNCTION public.allocate_quotation_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.allocate_quotation_number(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. search_knowledge_documents becomes per-account
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
    d.id,
    d.filename,
    d.mime,
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
-- 7. Re-assert the access model.
--
--    An anon key now ships in the browser bundle, so the Data API must stay
--    closed: RLS on, zero policies, and no table grants to anon/authenticated.
--    service_role bypasses RLS and is what Express uses.
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
