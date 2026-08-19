/**
 * Step 10: named quotation revisions.
 *
 * The live `quotations` row is always the current revision; `quotation_revisions`
 * holds frozen snapshots of every superseded one. Creating a revision freezes
 * "what the customer has right now" as Rev N and moves the live quote to Rev N+1.
 *
 * Every route degrades cleanly when the migration has not been applied yet, in
 * the same spirit as the rest of the codebase: the app keeps working without
 * revisions rather than erroring out.
 */
import { getSupabase, isSupabaseConfigured, supabaseError } from './db.js'

const MISSING_SCHEMA = /relation|does not exist|schema cache|PGRST20[24]|42P01|42703/i

function requireDb(res, requestId) {
  if (!isSupabaseConfigured()) {
    const err = new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env')
    err.code = 'SUPABASE_UNAVAILABLE'
    err.status = 503
    supabaseError(err, res, requestId)
    return null
  }
  return getSupabase()
}

function schemaMissing(res, requestId, error) {
  return res.status(503).json({
    error: 'Revision history is not set up yet. Apply supabase/migrations/20260812140000_quotation_revisions.sql, then retry.',
    code: 'REVISIONS_SCHEMA_MISSING',
    detail: error?.message,
    requestId
  })
}

function mapRevision(row, { fullData = false } = {}) {
  if (!row) return null
  const data = row.data && typeof row.data === 'object' ? row.data : {}
  const items = Array.isArray(data.items) ? data.items : []
  return {
    id: row.id,
    quotationId: row.quotation_id,
    revision: row.revision_number,
    label: row.label ?? '',
    number: row.number ?? null,
    title: row.title ?? null,
    itemCount: items.length,
    data: fullData ? data : undefined,
    createdAt: row.created_at
  }
}

export function registerRevisionRoutes(app) {
  // ----- list revisions for a quotation -----
  app.get('/api/quotations/:id/revisions', async (req, res) => {
    const requestId = `rev-list-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data: quote, error: qErr } = await supabase
        .from('quotations')
        .select('id, number, title, revision')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .maybeSingle()
      if (qErr) {
        if (MISSING_SCHEMA.test(qErr.message || '')) return schemaMissing(res, requestId, qErr)
        throw qErr
      }
      if (!quote) return res.status(404).json({ error: 'Quotation not found.', code: 'NOT_FOUND', requestId })

      const { data, error } = await supabase
        .from('quotation_revisions')
        .select('id, quotation_id, revision_number, label, number, title, data, created_at')
        .eq('quotation_id', req.params.id)
        .eq('user_id', req.userId)
        .order('revision_number', { ascending: false })
      if (error) {
        if (MISSING_SCHEMA.test(error.message || '')) return schemaMissing(res, requestId, error)
        throw error
      }

      res.json({
        current: { revision: quote.revision ?? 0, number: quote.number, title: quote.title },
        revisions: (data || []).map(r => mapRevision(r))
      })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // ----- read one frozen revision in full -----
  app.get('/api/quotations/:id/revisions/:revisionId', async (req, res) => {
    const requestId = `rev-get-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('quotation_revisions')
        .select('*')
        .eq('id', req.params.revisionId)
        .eq('quotation_id', req.params.id)
        .eq('user_id', req.userId)
        .maybeSingle()
      if (error) {
        if (MISSING_SCHEMA.test(error.message || '')) return schemaMissing(res, requestId, error)
        throw error
      }
      if (!data) return res.status(404).json({ error: 'Revision not found.', code: 'NOT_FOUND', requestId })
      res.json({ revision: mapRevision(data, { fullData: true }) })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // ----- create a revision: freeze current as Rev N, live quote becomes Rev N+1 -----
  app.post('/api/quotations/:id/revisions', async (req, res) => {
    const requestId = `rev-create-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    const label = String(req.body?.label || '').trim().slice(0, 200)
    try {
      const { data, error } = await supabase.rpc('create_quotation_revision', {
        p_quotation_id: req.params.id,
        p_user_id: req.userId,
        p_label: label
      })
      if (error) {
        if (/no_data_found|Quotation not found/i.test(error.message || '')) {
          return res.status(404).json({ error: 'Quotation not found.', code: 'NOT_FOUND', requestId })
        }
        if (MISSING_SCHEMA.test(error.message || '')) return schemaMissing(res, requestId, error)
        throw error
      }
      const row = Array.isArray(data) ? data[0] : data
      res.status(201).json({
        revisionId: row?.revision_id ?? null,
        frozenRevision: row?.frozen_revision ?? null,
        revision: row?.new_revision ?? null,
        requestId
      })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // ----- restore a frozen revision back into the live quote -----
  app.post('/api/quotations/:id/revisions/:revisionId/restore', async (req, res) => {
    const requestId = `rev-restore-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data: revision, error: rErr } = await supabase
        .from('quotation_revisions')
        .select('*')
        .eq('id', req.params.revisionId)
        .eq('quotation_id', req.params.id)
        .eq('user_id', req.userId)
        .maybeSingle()
      if (rErr) {
        if (MISSING_SCHEMA.test(rErr.message || '')) return schemaMissing(res, requestId, rErr)
        throw rErr
      }
      if (!revision) return res.status(404).json({ error: 'Revision not found.', code: 'NOT_FOUND', requestId })

      // Snapshot the current state first, so restoring can never lose work.
      const { error: snapErr } = await supabase.rpc('create_quotation_revision', {
        p_quotation_id: req.params.id,
        p_user_id: req.userId,
        p_label: `Auto-saved before restoring Rev ${revision.revision_number}`
      })
      if (snapErr) {
        if (MISSING_SCHEMA.test(snapErr.message || '')) return schemaMissing(res, requestId, snapErr)
        throw snapErr
      }

      // Restore the old content, but keep the new (post-bump) revision number:
      // restoring is itself a new revision, not a rewind of history.
      const { data: live, error: liveErr } = await supabase
        .from('quotations')
        .select('revision')
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .maybeSingle()
      if (liveErr) throw liveErr

      const restoredData = { ...(revision.data && typeof revision.data === 'object' ? revision.data : {}) }
      restoredData.revision = live?.revision ?? null
      restoredData.restoredFromRevision = revision.revision_number

      const { data: updated, error: upErr } = await supabase
        .from('quotations')
        .update({
          title: revision.title,
          data: restoredData
        })
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .select('*')
        .maybeSingle()
      if (upErr) throw upErr
      if (!updated) return res.status(404).json({ error: 'Quotation not found.', code: 'NOT_FOUND', requestId })

      res.json({
        ok: true,
        restoredFrom: revision.revision_number,
        revision: updated.revision,
        quotation: {
          id: updated.id,
          number: updated.number,
          title: updated.title,
          date: updated.quote_date,
          layoutRef: updated.layout_ref,
          revision: updated.revision,
          data: updated.data && typeof updated.data === 'object' ? updated.data : {},
          createdAt: updated.created_at,
          updatedAt: updated.updated_at
        },
        requestId
      })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })

  // ----- delete a frozen revision -----
  app.delete('/api/quotations/:id/revisions/:revisionId', async (req, res) => {
    const requestId = `rev-del-${Date.now()}`
    const supabase = requireDb(res, requestId)
    if (!supabase) return
    try {
      const { data, error } = await supabase
        .from('quotation_revisions')
        .delete()
        .eq('id', req.params.revisionId)
        .eq('quotation_id', req.params.id)
        .eq('user_id', req.userId)
        .select('id')
        .maybeSingle()
      if (error) {
        if (MISSING_SCHEMA.test(error.message || '')) return schemaMissing(res, requestId, error)
        throw error
      }
      if (!data) return res.status(404).json({ error: 'Revision not found.', code: 'NOT_FOUND', requestId })
      res.json({ ok: true, id: data.id })
    } catch (error) {
      supabaseError(error, res, requestId)
    }
  })
}
