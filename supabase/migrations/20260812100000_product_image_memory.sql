-- QuoteGen Step 8: learn images from quoted line items (auto-learn, image half)
-- Access model unchanged: service_role only (RLS, no anon policies).

-- ---------------------------------------------------------------------------
-- products.image_url / image_path — learned from an image cell a user filled
-- on a past quotation, so the same item auto-fills its image next time.
-- ---------------------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_url text NOT NULL DEFAULT '';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_path text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.products.image_url IS 'Learned image URL from a previously quoted line item; empty if none.';
COMMENT ON COLUMN public.products.image_path IS 'Storage path for the learned image (quote-assets bucket), for cleanup on replace.';
