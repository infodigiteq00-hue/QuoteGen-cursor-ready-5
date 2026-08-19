-- QuoteGen Step 10: named quotation revisions (Rev 0, Rev 1, Rev 2 …).
--
-- Model: the live `quotations` row is always the CURRENT revision, and its
-- `revision` column says which one that is. `quotation_revisions` holds frozen,
-- immutable snapshots of every superseded revision.
--
-- "New revision" therefore means: snapshot what the quote looks like right now
-- as Rev N (archived), then bump the live row to Rev N+1 and keep editing. That
-- keeps an exact record of what the customer received at each step, which is the
-- whole point of a revision in industrial quoting.
--
-- Access model unchanged: service_role only via Express, filtered by user_id.

CREATE TABLE IF NOT EXISTS public.quotation_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  label text NOT NULL DEFAULT '',
  -- Quote number as it stood at this revision, denormalised so the history list
  -- stays readable even if the live quote is later renumbered.
  number text,
  title text,
  -- Full frozen snapshot: same shape as quotations.data.
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotation_revisions_unique UNIQUE (quotation_id, revision_number)
);

CREATE INDEX IF NOT EXISTS quotation_revisions_quotation_idx
  ON public.quotation_revisions (quotation_id, revision_number DESC);

CREATE INDEX IF NOT EXISTS quotation_revisions_user_idx
  ON public.quotation_revisions (user_id);

COMMENT ON TABLE public.quotation_revisions IS
  'Frozen snapshots of superseded quotation revisions. The live quotations row is always the current (highest) revision.';

-- ---------------------------------------------------------------------------
-- quotations.revision — which revision the live row currently represents
-- ---------------------------------------------------------------------------
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.quotations.revision IS
  'Current revision number of this quotation. 0 = original. Superseded revisions live in quotation_revisions.';

-- ---------------------------------------------------------------------------
-- Atomic "create revision": freeze current state, then bump the live row.
-- Done in one function so a concurrent edit can never interleave and produce
-- two snapshots claiming the same revision number.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_quotation_revision(
  p_quotation_id uuid,
  p_user_id uuid,
  p_label text DEFAULT ''
)
RETURNS TABLE (
  revision_id uuid,
  frozen_revision integer,
  new_revision integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q public.quotations%ROWTYPE;
  new_id uuid;
BEGIN
  SELECT * INTO q
  FROM public.quotations
  WHERE id = p_quotation_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.quotation_revisions (
    quotation_id, user_id, revision_number, label, number, title, data
  )
  VALUES (
    q.id, p_user_id, q.revision, coalesce(p_label, ''), q.number, q.title, q.data
  )
  ON CONFLICT (quotation_id, revision_number) DO UPDATE
    SET label = EXCLUDED.label,
        number = EXCLUDED.number,
        title = EXCLUDED.title,
        data = EXCLUDED.data,
        created_at = now()
  RETURNING id INTO new_id;

  UPDATE public.quotations
  SET revision = q.revision + 1,
      updated_at = now()
  WHERE id = q.id;

  RETURN QUERY SELECT new_id, q.revision, q.revision + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.create_quotation_revision(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_quotation_revision(uuid, uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- RLS: enabled, no anon/authenticated policies (service_role bypasses).
-- ---------------------------------------------------------------------------
ALTER TABLE public.quotation_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quotation_revisions FROM anon, authenticated;
GRANT ALL ON TABLE public.quotation_revisions TO service_role;
