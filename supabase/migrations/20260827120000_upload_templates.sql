-- QuoteGen: uploaded Word/Excel layouts live in Supabase so localhost and
-- production share the same files. Previously they were JSON + .bin files on
-- each server's disk (data/upload-templates.json and data/upload-files/).
--
-- Access model unchanged: Express uses SUPABASE_SERVICE_ROLE_KEY only.
-- RLS is enabled with no anon/authenticated policies (service_role bypasses RLS).
-- The original .docx/.xlsx bytes sit in a private Storage bucket; Express
-- continues to proxy them through /api/upload-files/:fileId.

-- ---------------------------------------------------------------------------
-- upload_files (original Word/Excel bytes metadata)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.upload_files (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name text NOT NULL DEFAULT 'upload.bin',
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  kind text NOT NULL CHECK (kind IN ('word', 'excel')),
  size integer,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upload_files_user_id_idx ON public.upload_files (user_id);

COMMENT ON TABLE public.upload_files IS 'Metadata for original uploaded .docx/.xlsx files. Bytes live in the upload-templates Storage bucket.';

-- ---------------------------------------------------------------------------
-- upload_templates (saved layouts shown in "Pick your uploaded file")
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.upload_templates (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('word', 'excel')),
  source_file_name text NOT NULL DEFAULT '',
  design jsonb NOT NULL DEFAULT '{}'::jsonb,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS upload_templates_user_id_created_at_idx
  ON public.upload_templates (user_id, created_at DESC);

COMMENT ON TABLE public.upload_templates IS 'Saved Word/Excel quotation layouts. Per-account; listed by GET /api/upload-templates.';
COMMENT ON COLUMN public.upload_templates.content IS 'Layout body: fileId plus optional html/pages (Word) or sheets (Excel).';
COMMENT ON COLUMN public.upload_templates.mapping IS 'Column ids, slots, dynamic cells, and remembered Excel placements.';

DROP TRIGGER IF EXISTS upload_files_set_updated_at ON public.upload_files;
CREATE TRIGGER upload_files_set_updated_at
  BEFORE UPDATE ON public.upload_files
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS upload_templates_set_updated_at ON public.upload_templates;
CREATE TRIGGER upload_templates_set_updated_at
  BEFORE UPDATE ON public.upload_templates
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.upload_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_templates ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Private bucket for original .docx / .xlsx bytes (25 MB, matches multer).
-- No public read policy: only the service role (Express) can fetch objects.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('upload-templates', 'upload-templates', false, 26214400)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit;
