import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import {
  scrubTransientWordShell,
  scrubTransientExcelShell,
  inferTemplatePageWidth,
  pickLineItemsTable,
  mapHeadersToFields,
  lineItemHeaderScore,
  collectWordSlots,
  collectExcelMapping,
  applyPlacementRolesToSheets,
  summarizeTemplateMapping,
  buildExcelCellMap,
  placementsFromCellMap
} from '../shared/templateMap.js'
import { joinWordHtmlPages } from '../shared/uploadWordPages.js'
import { getDataDir } from './runtimeFs.js'
import { readUploadFileMeta, deleteUploadFile } from './uploadFileStorage.js'
import { getSupabase, isSupabaseConfigured } from './db.js'

function storePath() {
  return path.join(getDataDir(), 'upload-templates.json')
}

const TEMP_ROLES = new Set([
  'quote_number', 'date', 'customer_name', 'customer_company', 'customer_gst',
  'customer_location', 'line_items', 'total', 'notes', 'clarifications',
  'payment_terms', 'delivery_terms', 'validity_terms', 'freight_terms', 'tax_terms',
  'sample_item', 'enquiry_ref'
])

function defaultColumns() {
  return [
    { id: 'description', label: 'Description' },
    { id: 'unit', label: 'Unit' },
    { id: 'quantity', label: 'Quantity' },
    { id: 'rate', label: 'Rate' },
    { id: 'amount', label: 'Amount' }
  ]
}

function slugify(label) {
  const base = String(label || '').trim().toLowerCase()
    .replace(/[^a-z0-9%]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/[^a-zA-Z0-9%]/g, '')
    .replace(/^./, c => c.toLowerCase())
  return base || ''
}

function findBestLineItemHeader(sheets) {
  let bestScore = -1
  let best = null
  for (const sheet of sheets || []) {
    for (let i = 0; i < Math.min(sheet.rows?.length || 0, 80); i++) {
      const labels = (sheet.rows[i].cells || []).map(c => String(c.value || '').trim())
      const score = lineItemHeaderScore(labels)
      if (score > bestScore) {
        bestScore = score
        best = { labels, cells: sheet.rows[i].cells }
      }
    }
  }
  return bestScore >= 0 ? best : null
}

export function scrubWordHtml(html) {
  if (!html) return { html: '<p></p>', mapping: { columns: defaultColumns(), slots: [] } }

  const cleaned = scrubTransientWordShell(html)
  const picked = pickLineItemsTable(cleaned)
  let columns = defaultColumns()
  if (picked) {
    columns = picked.headers.filter(Boolean).map((label, i) => {
      const field = mapHeadersToFields(picked.headers, [])[i]
      if (field === '__sr__') return null
      const id = field || slugify(label) || `col${i + 1}`
      return { id, label }
    }).filter(Boolean)
  }
  return {
    html: cleaned,
    mapping: {
      columns: columns.length ? columns : defaultColumns(),
      slots: collectWordSlots(cleaned)
    }
  }
}

export function scrubExcelSheets(sheets) {
  const cleaned = scrubTransientExcelShell(sheets)
  let columns = defaultColumns()
  const header = findBestLineItemHeader(cleaned)
  if (header) {
    const ids = mapHeadersToFields(header.labels, [])
    columns = header.cells
      .map((c, idx) => {
        const id = ids[idx]
        if (id === '__sr__') return null
        return {
          id: id || slugify(c.value) || `col${idx + 1}`,
          label: String(c.value || `Column ${idx + 1}`).trim() || `Column ${idx + 1}`
        }
      })
      .filter(Boolean)
  }
  const detected = collectExcelMapping(cleaned)
  const cellMap = buildExcelCellMap(cleaned, columns)
  return {
    sheets: cleaned,
    mapping: {
      columns,
      slots: detected.slots,
      dynamicCells: detected.dynamicCells,
      placements: placementsFromCellMap(cellMap),
      excelCellMap: cellMap
    }
  }
}

function isMissingSchema(error) {
  return MISSING_SCHEMA.test(String(error?.message || error?.code || ''))
}

function supabaseOrNull() {
  if (!isSupabaseConfigured()) return null
  try {
    return getSupabase()
  } catch {
    return null
  }
}

function ensureStore() {
  const dir = getDataDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (!fs.existsSync(storePath())) {
    fs.writeFileSync(storePath(), JSON.stringify({ templates: [] }, null, 2))
  }
}

function readLocalStore() {
  ensureStore()
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    return { templates: Array.isArray(raw.templates) ? raw.templates : [] }
  } catch {
    return { templates: [] }
  }
}

function writeLocalStore(store) {
  ensureStore()
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2))
}

function newId() {
  return `utpl_${randomBytes(6).toString('hex')}`
}

function mapDbTemplate(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    sourceFileName: row.source_file_name || '',
    design: row.design || {},
    content: row.content || {},
    mapping: row.mapping || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toDbRow(template) {
  return {
    id: template.id,
    user_id: template.userId,
    name: template.name,
    type: template.type,
    source_file_name: template.sourceFileName || '',
    design: template.design || {},
    content: template.content || {},
    mapping: template.mapping || {},
    updated_at: template.updatedAt || new Date().toISOString()
  }
}

/** Emails that may claim pre-tenancy templates (no userId). Comma-separated env override. */
function legacyOwnerEmails() {
  const raw = process.env.UPLOAD_TEMPLATE_LEGACY_OWNER_EMAILS || 'infodigteq@gmail.com'
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
}

/**
 * Older templates had no owner and were shared with every login.
 * Claim those orphans once for the original company account so new users stay empty.
 */
function claimLegacyTemplates(store, userId, userEmail) {
  if (!userId) return false
  const email = String(userEmail || '').toLowerCase()
  if (!legacyOwnerEmails().includes(email)) return false
  let changed = false
  for (const tpl of store.templates) {
    if (!tpl.userId) {
      tpl.userId = userId
      changed = true
    }
  }
  return changed
}

function summarize(template) {
  return {
    id: template.id,
    name: template.name,
    type: template.type,
    sourceFileName: template.sourceFileName,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    columns: template.mapping?.columns || defaultColumns(),
    design: template.design || {}
  }
}

async function listTemplatesForUser(userId) {
  if (!userId) return []
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()
    // List cards only need metadata. Selecting content/mapping jsonb (full sheet
    // models + cell maps) was timing out and starving deletes/list elsewhere.
    const { data, error } = await supabase
      .from('upload_templates')
      .select('id, user_id, name, type, source_file_name, design, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) throw error
    const remote = (data || []).map(row => mapDbTemplate({ ...row, content: {}, mapping: {} }))
    // Keep showing legacy local layouts until they are re-uploaded.
    const remoteIds = new Set(remote.map(t => t.id))
    const localOrphans = readLocalStore().templates.filter(t => t.userId === userId && !remoteIds.has(t.id))
    return [...remote, ...localOrphans]
  }
  const store = readLocalStore()
  return store.templates.filter(t => t.userId === userId)
}

async function hydrateTemplateFromFile(tpl) {
  if (!tpl?.content?.fileId) return tpl
  try {
    const { refreshTemplateLayoutFromFile } = await import('./uploadDoc.js')
    return refreshTemplateLayoutFromFile(tpl)
  } catch (error) {
    console.warn('[upload-templates] hydrate import failed', error?.message || error)
    return tpl
  }
}

async function getOwnedTemplate(id, userId, { hydrate = true } = {}) {
  if (!id || !userId) return null
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('upload_templates')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    if (data) {
      const tpl = mapDbTemplate(data)
      return hydrate ? hydrateTemplateFromFile(tpl) : tpl
    }
  }
  const store = readLocalStore()
  const tpl = store.templates.find(t => t.id === id)
  if (!tpl || tpl.userId !== userId) return null
  return hydrate ? hydrateTemplateFromFile(tpl) : tpl
}

async function insertTemplate(template) {
  if (isSupabaseConfigured()) {
    if (!template.userId) {
      const err = new Error('Sign in to save layouts.')
      err.status = 401
      throw err
    }
    const supabase = getSupabase()
    const row = toDbRow(template)
    row.created_at = template.createdAt || new Date().toISOString()
    const { data, error } = await supabase
      .from('upload_templates')
      .insert(row)
      .select('*')
      .single()
    if (error) {
      const err = new Error(error.message || 'Could not save layout to Supabase.')
      err.status = 502
      err.code = error.code
      throw err
    }
    console.info('[upload-templates] saved to supabase', { id: data.id, userId: template.userId })
    return mapDbTemplate(data)
  }
  const store = readLocalStore()
  store.templates.unshift(template)
  writeLocalStore(store)
  return template
}

async function updateTemplate(template) {
  if (isSupabaseConfigured() && template.userId) {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('upload_templates')
      .update(toDbRow(template))
      .eq('id', template.id)
      .eq('user_id', template.userId)
      .select('*')
      .single()
    if (error) {
      // Legacy local-only template: keep updating disk until re-uploaded.
      if (error.code === 'PGRST116' || /0 rows/i.test(error.message || '')) {
        const store = readLocalStore()
        const idx = store.templates.findIndex(t => t.id === template.id && t.userId === template.userId)
        if (idx >= 0) {
          store.templates[idx] = template
          writeLocalStore(store)
          return template
        }
      }
      const err = new Error(error.message || 'Could not update layout in Supabase.')
      err.status = 502
      throw err
    }
    return mapDbTemplate(data)
  }
  const store = readLocalStore()
  const idx = store.templates.findIndex(t => t.id === template.id && t.userId === template.userId)
  if (idx < 0) return null
  store.templates[idx] = template
  writeLocalStore(store)
  return template
}

async function removeTemplate(id, userId) {
  const existing = await getOwnedTemplate(id, userId)
  if (!existing) return null
  const fileId = existing.content?.fileId
  if (isSupabaseConfigured()) {
    const supabase = getSupabase()
    const { error } = await supabase
      .from('upload_templates')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    if (error) throw error
    // Also clear a possible legacy local copy.
    const store = readLocalStore()
    const before = store.templates.length
    store.templates = store.templates.filter(t => !(t.id === id && t.userId === userId))
    if (store.templates.length !== before) writeLocalStore(store)
    if (fileId) await deleteUploadFile(fileId)
    return existing
  }
  const store = readLocalStore()
  store.templates = store.templates.filter(t => !(t.id === id && t.userId === userId))
  writeLocalStore(store)
  if (fileId) await deleteUploadFile(fileId)
  return existing
}

async function buildTemplatePayload(body, userId) {
  const name = String(body.name || '').trim()
  if (!name) throw Object.assign(new Error('Please give this template a name.'), { status: 400 })
  if (!body.type || !['word', 'excel'].includes(body.type)) {
    throw Object.assign(new Error('Invalid template type.'), { status: 400 })
  }

  const design = body.design && typeof body.design === 'object' ? { ...body.design } : {}
  let content
  let mapping

  if (body.fileId) {
    const meta = await readUploadFileMeta(body.fileId)
    if (!meta) throw Object.assign(new Error('Uploaded file not found. Please upload again.'), { status: 400 })
    content = { fileId: body.fileId }
    if (body.type === 'word') {
      const asIs = String(body.html || '')
      const pages = Array.isArray(body.pages) && body.pages.length > 1 ? body.pages : null
      if (pages) content.pages = pages
      if (asIs) content.html = pages ? joinWordHtmlPages(pages) : asIs
      const mapped = scrubWordHtml(asIs || '<p></p>')
      mapping = body.mapping || mapped.mapping
      design.pageWidthPx = inferTemplatePageWidth('word', asIs, design)
    } else {
      const asIs = body.sheets || []
      if (asIs.length) content.sheets = asIs
      const mapped = scrubExcelSheets(asIs.length ? asIs : [{ name: 'Sheet1', columns: [], rows: [] }])
      mapping = body.mapping ? { ...mapped.mapping, ...body.mapping } : mapped.mapping
      mapping.excelCellMap = mapped.mapping.excelCellMap
      mapping.placements = { ...mapped.mapping.placements, ...(body.mapping?.placements || {}) }
      design.pageWidthPx = inferTemplatePageWidth('excel', asIs, design)
    }
  } else if (body.type === 'word') {
    const asIs = String(body.html || '')
    const pages = Array.isArray(body.pages) && body.pages.length > 1 ? body.pages : null
    content = pages
      ? { html: joinWordHtmlPages(pages), pages }
      : { html: asIs }
    const mapped = scrubWordHtml(asIs)
    mapping = mapped.mapping
    design.pageWidthPx = inferTemplatePageWidth('word', asIs, design)
  } else {
    const asIs = body.sheets || []
    const mapped = scrubExcelSheets(asIs)
    content = {
      sheets: asIs,
      activeSheet: body.activeSheet || 0
    }
    mapping = mapped.mapping
    design.pageWidthPx = inferTemplatePageWidth('excel', asIs, design)
  }

  if (Array.isArray(body.columns) && body.columns.length) {
    mapping.columns = body.columns.map(c => ({
      id: String(c.id || slugify(c.label) || 'col'),
      label: String(c.label || c.id || 'Column')
    }))
  }

  mapping.summary = summarizeTemplateMapping(
    mapping,
    body.type === 'excel' ? (content.sheets || body.sheets || []) : null
  )

  const now = new Date().toISOString()
  return {
    id: newId(),
    userId,
    name,
    type: body.type,
    sourceFileName: body.sourceFileName || '',
    createdAt: now,
    updatedAt: now,
    design,
    content,
    mapping
  }
}

export function registerUploadTemplateRoutes(app) {
  app.get('/api/upload-templates', async (req, res) => {
    try {
      if (req.userId) {
        const store = readLocalStore()
        if (claimLegacyTemplates(store, req.userId, req.userEmail)) writeLocalStore(store)
      }
      const templates = await listTemplatesForUser(req.userId)
      res.json({ templates: templates.map(summarize) })
    } catch (error) {
      console.error('[upload-templates] list failed', error)
      res.status(500).json({ error: error?.message || 'Could not list templates.' })
    }
  })

  app.get('/api/upload-templates/:id', async (req, res) => {
    try {
      const tpl = await getOwnedTemplate(req.params.id, req.userId)
      if (!tpl) return res.status(404).json({ error: 'Template not found.' })
      res.json(tpl)
    } catch (error) {
      console.error('[upload-templates] get failed', error)
      res.status(500).json({ error: error?.message || 'Could not load template.' })
    }
  })

  app.post('/api/upload-templates/:id/fill', async (req, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Sign in to continue.', code: 'UNAUTHENTICATED' })
      }
      const tpl = await getOwnedTemplate(req.params.id, req.userId, { hydrate: false })
      if (!tpl) return res.status(404).json({ error: 'Template not found.' })
      const body = req.body || {}
      const { fillTemplateForQuote } = await import('./templateFill.js')
      const result = await fillTemplateForQuote({
        template: tpl,
        quote: body.quote || {},
        columns: body.columns || tpl.mapping?.columns || [],
        userId: req.userId,
        filledFileId: body.filledFileId || null
      })
      res.json(result)
    } catch (error) {
      console.error('[upload-templates] fill failed', error)
      const status = error?.status || 500
      res.status(status).json({ error: error?.message || 'Could not fill layout.' })
    }
  })

  app.post('/api/upload-templates', async (req, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Sign in to continue.', code: 'UNAUTHENTICATED' })
      }
      const template = await buildTemplatePayload(req.body || {}, req.userId)
      const saved = await insertTemplate(template)
      res.json({ template: summarize(saved), full: saved })
    } catch (error) {
      console.error('[upload-templates] save failed', error)
      const status = error?.status || 500
      res.status(status).json({ error: error?.message || 'Could not save template.' })
    }
  })

  app.delete('/api/upload-templates/:id', async (req, res) => {
    try {
      const removed = await removeTemplate(req.params.id, req.userId)
      if (!removed) return res.status(404).json({ error: 'Template not found.' })
      res.json({ ok: true })
    } catch (error) {
      console.error('[upload-templates] delete failed', error)
      res.status(500).json({ error: error?.message || 'Could not delete template.' })
    }
  })

  app.patch('/api/upload-templates/:id', async (req, res) => {
    try {
      const tpl = await getOwnedTemplate(req.params.id, req.userId)
      if (!tpl) return res.status(404).json({ error: 'Template not found.' })
      const body = req.body || {}
      const mapping = { ...(tpl.mapping || {}) }

      if (body.mapping?.placements && typeof body.mapping.placements === 'object') {
        mapping.placements = body.mapping.placements
      }
      if (Array.isArray(body.mapping?.dynamicCells)) {
        mapping.dynamicCells = body.mapping.dynamicCells
      }
      if (Array.isArray(body.mapping?.slots)) {
        mapping.slots = body.mapping.slots
      }

      if (Array.isArray(body.content?.sheets) && body.content.sheets.length) {
        const scrubbed = scrubExcelSheets(body.content.sheets)
        tpl.content = {
          ...(tpl.content || {}),
          sheets: scrubbed.sheets || body.content.sheets,
          activeSheet: body.content.activeSheet ?? tpl.content?.activeSheet ?? 0
        }
        if (scrubbed.mapping) {
          if (Array.isArray(scrubbed.mapping.columns)) mapping.columns = scrubbed.mapping.columns
          if (Array.isArray(scrubbed.mapping.dynamicCells)) mapping.dynamicCells = scrubbed.mapping.dynamicCells
          if (Array.isArray(scrubbed.mapping.slots)) mapping.slots = scrubbed.mapping.slots
        }
      }

      if (typeof body.content?.html === 'string' && body.content.html.trim()) {
        const html = body.content.html
        const pages = Array.isArray(body.content.pages) && body.content.pages.length
          ? body.content.pages
          : null
        tpl.content = {
          ...(tpl.content || {}),
          html: pages ? joinWordHtmlPages(pages) : html,
          ...(pages ? { pages } : {})
        }
      }

      if (mapping.placements && Array.isArray(tpl.content?.sheets) && tpl.content.sheets.length) {
        tpl.content = {
          ...tpl.content,
          sheets: applyPlacementRolesToSheets(tpl.content.sheets, mapping.placements)
        }
        const scrubbed = scrubExcelSheets(tpl.content.sheets)
        if (scrubbed.mapping?.excelCellMap) {
          mapping.excelCellMap = scrubbed.mapping.excelCellMap
          mapping.placements = { ...(mapping.placements || {}), ...scrubbed.mapping.placements }
        }
        const detected = collectExcelMapping(tpl.content.sheets)
        mapping.dynamicCells = detected.dynamicCells
        mapping.slots = detected.slots
      }

      tpl.mapping = mapping
      tpl.userId = tpl.userId || req.userId
      tpl.updatedAt = new Date().toISOString()
      const saved = await updateTemplate(tpl)
      if (!saved) return res.status(404).json({ error: 'Template not found.' })
      res.json({ template: summarize(saved), full: saved })
    } catch (error) {
      console.error('[upload-templates] patch failed', error)
      res.status(500).json({ error: error?.message || 'Could not update template.' })
    }
  })
}

export { TEMP_ROLES }
