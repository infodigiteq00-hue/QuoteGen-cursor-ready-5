# QuoteGen

A lightweight AI quotation engineer for turning raw enquiries into editable quotation drafts.

## Run locally

```bash
npm install
cp .env.example .env
# Add OPENAI_API_KEY to .env for AI generation
npm run dev
```

Open `http://localhost:5173`.

Without an API key, QuoteGen remains usable in Draft mode and extracts likely line items locally. Add an OpenAI key for the full AI quotation-engineer flow.

## Supabase persistence (Step 1)

QuoteGen stores company settings, quotations, product/HSN cache, and knowledge-document stubs in Supabase Postgres. The **Express server** talks to Supabase with the **service role** key. The browser only calls Express `/api/*` routes — never put `SUPABASE_SERVICE_ROLE_KEY` in frontend env.

1. Create a Supabase project.
2. In the SQL Editor, run `supabase/migrations/20260811160000_persistence_foundation.sql` (or apply it with the Supabase CLI).
3. Copy **Project URL** and **service_role** key from Project Settings → API into `.env`:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

4. Restart `npm run dev`. Check `GET /api/health/persistence` — `configured` should be `true`.

Without these env vars the app still runs; persistence APIs return `503` with `SUPABASE_UNAVAILABLE`, and quotation numbers fall back to a local random `QG-YYYY-NNNN`. The landing page shows a clear **configure Supabase** message for series settings and history.

RLS is enabled on all tables with no anon/authenticated policies, so the Data API is not publicly readable. Only the server service role accesses data.

## Series, autosave & history (Step 2)

With Supabase configured:

- **Quotation number series** on the home page — edit prefix, padding, next number, and whether to include the year; preview the next number; save via company profile.
- **Autosave** — editing a quotation (default or uploaded layout) debounces a create/update to `/api/quotations` with the full quote JSON.
- **Recent quotations** — open a draft to continue, or **Use as base** to clone content and allocate a new series number.

Without Supabase, generate → edit → PDF still works; cloud save and history stay unavailable until credentials are set.

## Knowledge base & autofill (Steps 4–5)

With Supabase configured:

1. On the home page, open **Knowledge base** and upload catalogues, bills, or old quotations (PDF, Word `.docx`, Excel `.xlsx`, CSV, plain text; images use OCR when `eng.traineddata` is present).
2. Extracted text is stored in `knowledge_documents`. Clear product + HSN/rate patterns are upserted into `products` (best-effort).
3. **Generate quotation** matches line items against products + knowledge text and fills rate / HSN / GST / description when confidence is reasonable. Rows show a small **KB** mark.
4. In the editor, use **Autofill from knowledge** or edit a description and blur — matching runs again.

Apply the follow-up migration for full-text search + `products.rate`:

`supabase/migrations/20260811170000_knowledge_autofill.sql`

(Without it, uploads and autofill still work; rate may only live in knowledge metadata, and search falls back to in-process matching.)

## HSN / GST fetch (Step 6)

Per line item, use **Fetch HSN/GST** in the default quotation editor (or under Quick edits on an uploaded template):

1. The API checks `products` / `hsn_cache` by a normalized description key.
2. **Cache hit** → returns HSN + GST with `source: "cache"` (no AI tokens).
3. **Cache miss** → one OpenAI call, then upserts both tables and returns `source: "ai"`.
4. Values are written into matching columns (`HSN Code`, `GST %`, etc.); those columns are added automatically if missing.

Endpoint: `POST /api/hsn-gst/lookup` with `{ description }` or `{ item, columns }`.

Requires the persistence foundation migration (`products`, `hsn_cache`). Without Supabase or without an API key on a miss, the button shows a clear error and the rest of the app keeps working.

## Rows & typed columns (Step 7)

### Rows

In the quotation editor every row has controls on the right: **↑+** inserts a blank row above, **⧉** duplicates the row, **×** removes it. **+ Add line item** appends at the end. A new row is seeded with the correct keys for whatever column types are in play.

### Columns, after generation

Open **Table columns → Edit columns** inside the editor to add, rename, retype, reorder (← →), and remove columns on an existing draft. The same options are available before generating, under **Quotation columns** on the home page. Column edits update both the live table and the autosaved quotation JSON.

### Column types

The column model is `{ id, label, type, color?, imageWidth? }`. Unknown types degrade to `text`.

| Type | Behaviour |
| --- | --- |
| `text` | Default free-text cell |
| `custom` | You supply only the name; plain text cell |
| `image` | Per-row image picker — thumbnail in the editor, full image in print. Width is configurable (24–320 px) |
| `highlight` | Header and every cell tinted; pick a swatch or any colour. Prints in colour via `print-color-adjust: exact` |
| `tax` | Merged header over **Rate** and **Amount** sub-columns; adds to the row total |
| `discount` | Same nested header; reduces the taxable base |

### Amount = Quantity × Rate

The **Amount** cell calculates itself. Type a Quantity and a Rate and the Amount appears; change either one and it follows, rounded to 2 decimals. If Quantity or Rate is empty or not a number, Amount stays **blank** rather than showing `0` or `NaN` — a Quantity of `0` is a real `0.00`.

You can still type your own Amount. Doing so marks the row as a **manual override**, recorded in the same `__src` marker the nested columns use (`${amountColumn}__src` = `auto` or `manual`):

- The override sticks. Changing Quantity or Rate afterwards does **not** discard what you typed.
- An overridden cell is tinted amber and carries a small **↺** button; its tooltip shows what Quantity × Rate would be, and clicking it returns the cell to the calculated value.
- Clearing the Amount cell also hands it back to the formula.

The row's Amount is the base for tax and discount, so changing Quantity or Rate cascades: Amount → each discount → taxable value → each tax → the totals footer. An overridden Amount is the base too — taxes are charged on the figure you typed.

**Amounts that arrive with a row** (AI generation, knowledge autofill, opening from history, **Use as base** cloning) are never silently overwritten. On load, a row with no marker is judged by its data: an Amount equal to Quantity × Rate is adopted as calculated and keeps following the formula, an Amount that disagrees is treated as deliberate and kept as a manual override, and a missing Amount is calculated. Knowledge autofill filling a Rate recalculates the Amount that hangs off it.

Columns are matched by the same fuzzy header mapping as everything else, so `Qty` / `Unit Price` / `Value` calculate exactly like `Quantity` / `Rate` / `Amount`, whatever order they sit in. **If the layout has no Quantity column or no Rate column, Amount stays an ordinary free-text cell** — nothing is derived and nothing is cleared. Uploaded Word/Excel layouts show the calculated Amount in their own matching cell.

### Nested tax / discount columns

A tax or discount column renders as one merged top-level header spanning two sub-columns, **Rate** and **Amount** — the same structure as a printed `CGST | Rate | Amount` block. The top label is editable, so name them `CGST`, `SGST`, `IGST`, `Trade Discount`, and so on. Add as many as you need.

The maths is bidirectional per row:

- Type a **Rate (%)** and the Amount is computed from the row's taxable base.
- Type an **Amount** and the Rate is back-computed.
- Whichever side you typed last stays authoritative, so the field you are typing in is never overwritten.

The base is the row's Amount column when it has a value, otherwise quantity × rate; column headers are matched fuzzily (`Qty`, `Unit Price`, and similar all resolve). **Discounts are applied first, then tax is charged on the reduced value**, and the taxable base never goes below zero. Money is rounded to 2 dp and rates keep up to 2 dp, so repeated recalculation is stable. An empty or unparseable base leaves the derived cell blank rather than producing `0`, `NaN`, or `Infinity`.

The totals footer follows the same order: **Subtotal → less each discount → Taxable value → add each tax → Total**.

**Fetch HSN/GST** writes into a nested tax column too: with one tax column it fills the full GST rate, and with a `CGST` + `SGST`/`UTGST` pair it splits the rate evenly. Other combinations (for example CGST + IGST) are left for you to fill in.

### Image cells

Images upload through Express to the public Supabase Storage bucket `quote-assets`; the server creates the bucket on first use with the service role. If Storage is unavailable, the image is embedded as a data URL inside the quote JSON instead (up to 400 KB), the same fallback the company logo uses. The storage path is kept alongside the URL so replacing an image deletes the old object.

Endpoints: `POST /api/quote-assets/image` (multipart `image`, 4 MB max, png/jpg/webp/gif/svg) and `DELETE /api/quote-assets/image?path=…`.

### Persistence and print

Column `type`, `color`, and `imageWidth`, plus every nested and image cell value, round-trip through autosave → `quotations.data` → reopen → **Use as base** clone. Nested headers, tinted columns, and images all render in the print/PDF output, and the table header repeats across page breaks.

Optional migration (the bucket is also created automatically on first upload):

`supabase/migrations/20260812090000_quote_assets.sql`

### Uploaded Word/Excel layouts

Uploaded layouts keep their own table structure, so typed columns degrade gracefully and the editor shows a note explaining how: a nested tax/discount column collapses to its calculated amount in a single matching cell (no merged header), and image columns only appear where the layout has a matching header. Rate and Amount for each nested column stay editable under **Quick edits**. Switch to the QuoteGen default layout for the full nested header and inline images.

### Checks

Run `node scripts/verify-step7.mjs` to exercise the calculation engine (Amount = Quantity × Rate, manual overrides, tax/discount), column operations, totals, persistence round-trip and uploaded-template degradation.

## PDF

**Download PDF** saves a file directly — no print dialog. The browser snapshots the quotation as it is on screen (form values baked in, stylesheets inlined, images embedded) and posts it to `POST /api/quotation-pdf`, where a headless Chrome prints it with the app's own print stylesheet. That is why the letterhead, nested tax/discount headers, tinted columns, image cells and the repeating table header all survive: it is the same CSS the print path always used.

The file is named after the quotation, e.g. `Quotation-QTN-2026-0007-Acme-Industries.pdf`.

The route sits under `/api`, so it requires a signed-in session, and it renders the HTML the caller sends rather than looking a quotation up by id — it cannot be used to read another account's quote. If rendering fails, the editor shows the reason and falls back to the browser print dialog.

Chrome is reused from the machine (no bundled Chromium download). Set `CHROME_PATH` in `.env` if it lives somewhere unusual; `PDF_TIMEOUT_MS` (default 45000) caps a render.
