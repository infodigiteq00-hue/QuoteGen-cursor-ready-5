# Supabase migrations

Apply migrations in order to your Supabase project before using persistence APIs:

1. `migrations/20260811160000_persistence_foundation.sql`
2. `migrations/20260811170000_knowledge_autofill.sql` (knowledge FTS + `products.rate`)
3. `migrations/20260812090000_quote_assets.sql` (quote-assets storage bucket)
4. `migrations/20260812100000_product_image_memory.sql` (`products.image_url` / `products.image_path`)
5. `migrations/20260812120000_multi_tenant_auth.sql` (**required** for login/signup — adds `user_id` to every tenant table and makes `allocate_quotation_number` / `search_knowledge_documents` per-user)

**Step 9 (auth) also needs one dashboard setting, not just SQL:** Authentication → Email Templates → "Confirm signup" → make sure the template includes `{{ .Token }}` (the OTP code — this project issues 8 digits, but the length is a project setting under Authentication → Providers → Email → OTP length), not only `{{ .ConfirmationURL }}`. Supabase's default template is link-only; without `{{ .Token }}` in the template, the signup email won't contain a code to type in and OTP verification will fail even though the API call succeeds. Authentication → Providers → Email should have "Confirm email" turned on (the default) so signup actually requires verification.

**Note:** Supabase MCP in this workspace may be linked to a different project than `SUPABASE_URL` in `.env`. If MCP cannot see your QuoteGen tables, apply both SQL files in the Dashboard SQL Editor for the project that matches `.env`.

## Apply via SQL Editor

1. Open Supabase Dashboard → SQL Editor
2. Paste the migration file contents
3. Run

## Apply via CLI (optional)

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Tables: `company_profile`, `quotations`, `products` (incl. `rate`), `hsn_cache`, `knowledge_documents` (incl. FTS `search_tsv`).
Functions: `allocate_quotation_number()`, `search_knowledge_documents(query, max_rows)`.

Step 6 (HSN/GST fetch) uses `products` + `hsn_cache` from the foundation migration; the autofill migration is still recommended for knowledge FTS / `products.rate`.

Step 8 (auto-learn every quoted item — description, rate, HSN, GST, and image — so the next quotation autofills it) writes to `products` on every autosave. It works even before `20260812100000_product_image_memory.sql` is applied: description/rate/HSN/GST land in the existing `products` columns immediately, and a learned image falls back to a `knowledge_documents` row (filename `__product_image_memory__`) until the `image_url` / `image_path` columns exist, at which point it upgrades to the real columns automatically.
