-- QuoteGen Step 7: typed quotation columns (image cells)
--
-- No table changes are required: typed columns and their values ride inside
-- public.quotations.data (columns[].type / .color / .imageWidth, and the flat
-- item keys `<col>__rate`, `<col>__amount`, `<col>__src`, `<col>__path`).
--
-- This migration only provisions the public Storage bucket used by image
-- columns. The Express server also creates it on first upload with the service
-- role, so applying this file is optional — it just makes the bucket explicit
-- and gives it a public read policy up front.

-- ---------------------------------------------------------------------------
-- quote-assets bucket (public read, 4 MB per object, images only)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'quote-assets',
  'quote-assets',
  true,
  4194304,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Public read so <img src> works in the editor and printed PDF.
-- Writes stay service-role only (service_role bypasses RLS).
DROP POLICY IF EXISTS "quote assets are publicly readable" ON storage.objects;
CREATE POLICY "quote assets are publicly readable"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'quote-assets');

COMMENT ON TABLE public.quotations IS
  'Full quotation JSON. columns[] carry Step 7 types: text | custom | image | highlight | tax | discount.';
