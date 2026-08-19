-- QuoteGen Steps 4–5: knowledge base search + product rate for autofill
-- Access model unchanged: service_role only (RLS, no anon policies).

-- ---------------------------------------------------------------------------
-- products.rate — optional commercial field filled from catalogues / bills
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS rate text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.products.rate IS 'Unit rate when known from knowledge base extraction; empty if unknown.';

-- ---------------------------------------------------------------------------
-- knowledge_documents: full-text search for MVP retrieval
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_documents
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(filename, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(extracted_text, '')), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS knowledge_documents_search_tsv_idx
  ON public.knowledge_documents USING gin (search_tsv);

CREATE INDEX IF NOT EXISTS knowledge_documents_filename_idx
  ON public.knowledge_documents (filename);

-- Lightweight search helper (service_role). Returns ranked snippets.
CREATE OR REPLACE FUNCTION public.search_knowledge_documents(
  query text,
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
  WHERE d.search_tsv @@ q.tsq
  ORDER BY rank DESC, d.created_at DESC
  LIMIT greatest(1, least(coalesce(max_rows, 12), 50));
$$;

REVOKE ALL ON FUNCTION public.search_knowledge_documents(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_knowledge_documents(text, integer) TO service_role;
