-- Custom local/trade names for products (e.g. customer says "plates" or "bags"
-- for the catalogue item "blades"). Matching writes the standard name into
-- the quotation's "Our suggested" column and never rewrites the enquiry text.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS keywords text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.products.keywords IS
  'Comma-separated customer aliases / local names for this product.';
