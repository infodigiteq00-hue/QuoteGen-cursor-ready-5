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
  applyPlacementRolesToSheets
} from '../shared/templateMap.js'
import { joinWordHtmlPages } from '../shared/uploadWordPages.js'
import { getDataDir } from './runtimeFs.js'
import { getSupabase, isSupabaseConfigured } from './db.js'
import { migrateLocalFileToSupabase, readUploadFileMeta } from './uploadFileStorage.js'

const MISSING_SCHEMA = /relation|does not exist|schema cache|PGRST20[24]|42P01|42703|Could not find the table/i

function storePath() {
  return path.join(getDataDir(), 'upload-templates.json')
}

const TEMP_ROLES = new Set([
  'quote_number', 'date', 'customer_name', 'customer_company', 'customer_gst',
  'customer_location', 'line_items', 'total', 'notes', 'clarifications',
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
  return {
    sheets: cleaned,
    mapping: {
      columns,
      slots: detected.slots,
      dynamicCells: detected.dynamicCells
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

function readStore() {
  ensureStore()
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    return { templates: Array.isArray(raw.templates) ? raw.templates : [] }
  } catch {
    return { templates: [] }
  }
}

function writeStore(store) {
  ensureStore()
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2))
}

function newId() {
  return `utpl_${randomBytes(6).toString('hex')}`
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

function templatesForCompany(store, userId) {
  if (!userId) return []
  return store.templates.filter(t => t.userId === userId)
}

function findOwnedTemplate(store, id, userId) {
  const tpl = store.templates.find(t => t.id === id)
  if (!tpl || tpl.userId !== userId) return null
  return tpl
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

function loadCompanyStore(req) {
  const store = readStore()
  if (claimLegacyTemplates(store, req.userId, req.userEmail)) writeStore(store)
  return store
}

function templateToRow(tpl) {
  return {
    id: tpl.id,
    user_id: tpl.userId,
    name: tpl.name,
    type: tpl.type,
    source_file_name: tpl.sourceFileName || '',
    design: tpl.design || {},
    content: tpl.content || {},
    mapping: tpl.mapping || {},
    created_at: tpl.createdAt,
    updated_at: tpl.updatedAt
  }
}

function rowToTemplate(row) {
  if (!row) return null
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type,
    sourceFileName: row.source_file_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    design: row.design || {},
    content: row.content || {},
    mapping: row.mapping || {}
  }
}

async function listSupabaseTemplates(userId, { full = false } = {}) {
  if (!userId) return []
  const supabase = supabaseOrNull()
  if (!supabase) return null
  const columns = full
    ? '*'
    : 'id, user_id, name, type, source_file_name, created_at, updated_at, design, mapping'
  const { data, error } = await supabase
    .from('upload_templates')
    .select(columns)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return (data || []).map(rowToTemplate)
}

async function readSupabaseTemplate(id, userId) {
  const supabase = supabaseOrNull()
  if (!supabase || !id || !userId) return null
  const { data, error } = await supabase
    .from('upload_templates')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  return rowToTemplate(data)
}

async function writeSupabaseTemplate(tpl) {
  const supabase = supabaseOrNull()
  if (!supabase || !tpl?.userId) return false
  const { error } = await supabase.from('upload_templates').upsert(templateToRow(tpl), { onConflict: 'id' })
  if (error) {
    if (isMissingSchema(error)) return false
    throw error
  }
  return true
}

async function deleteSupabaseTemplate(id, userId) {
  const supabase = supabaseOrNull()
  if (!supabase) return false
  const { error } = await supabase.from('upload_templates').delete().eq('id', id).eq('user_id', userId)
  if (error) {
    if (isMissingSchema(error)) return false
    throw error
  }
  return true
}

function removeLocalTemplate(id) {
  const store = readStore()
  const next = store.templates.filter(t => t.id !== id)
  if (next.length !== store.templates.length) writeStore({ templates: next })
}

function sortByCreatedDesc(templates) {
  return templates.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
}

async function migrateLocalTemplates(req) {
  const local = templatesForCompany(loadCompanyStore(req), req.userId)
  if (!local.length) return
  const existing = await listSupabaseTemplates(req.userId)
  if (!existing) return
  const have = new Set(existing.map(t => t.id))
  for (const tpl of local) {
    if (have.has(tpl.id)) continue
    try {
      const fileId = tpl.content?.fileId
      if (fileId) await migrateLocalFileToSupabase(fileId, req.userId)
      await writeSupabaseTemplate(tpl)
    } catch (error) {
      console.warn('[upload-templates] could not migrate', tpl.id, error?.message || error)
    }
  }
}

async function templatesForRequest(req) {
  const local = templatesForCompany(loadCompanyStore(req), req.userId)
  try {
    await migrateLocalTemplates(req)
  } catch (error) {
    console.warn('[upload-templates] migrate skipped', error?.message || error)
  }
  try {
    const fromDb = await listSupabaseTemplates(req.userId)
    if (fromDb) {
      const byId = new Map()
      for (const tpl of local) byId.set(tpl.id, tpl)
      for (const tpl of fromDb) byId.set(tpl.id, tpl)
      return sortByCreatedDesc([...byId.values()])
    }
  } catch (error) {
    console.warn('[upload-templates] supabase list failed, using local disk', error?.message || error)
  }
  return local
}

async function findTemplate(req, id) {
  try {
    const fromDb = await readSupabaseTemplate(id, req.userId)
    if (fromDb) return fromDb
  } catch (error) {
    console.warn('[upload-templates] supabase read failed', error?.message || error)
  }
  const local = findOwnedTemplate(loadCompanyStore(req), id, req.userId)
  if (local) {
    try {
      const fileId = local.content?.fileId
      if (fileId) await migrateLocalFileToSupabase(fileId, req.userId)
      await writeSupabaseTemplate(local)
    } catch (error) {
      console.warn('[upload-templates] migrate on read skipped', error?.message || error)
    }
  }
  return local
}

function applyPatchToTemplate(tpl, body, userId) {
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
    const detected = collectExcelMapping(tpl.content.sheets)
    mapping.dynamicCells = detected.dynamicCells
    mapping.slots = detected.slots
  }

  tpl.mapping = mapping
  tpl.userId = tpl.userId || userId
  tpl.updatedAt = new Date().toISOString()
  return tpl
}

async function persistTemplate(req, template, { insert = false } = {}) {
  try {
    if (await writeSupabaseTemplate(template)) return
  } catch (error) {
    console.warn('[upload-templates] supabase persist failed, using local disk', error?.message || error)
  }
  const store = loadCompanyStore(req)
  if (insert) {
    store.templates.unshift(template)
  } else {
    const idx = store.templates.findIndex(t => t.id === template.id && t.userId === req.userId)
    if (idx < 0) store.templates.unshift(template)
    else store.templates[idx] = template
  }
  writeStore(store)
}

export function registerUploadTemplateRoutes(app) {
  app.get('/api/upload-templates', async (req, res) => {
    try {
      const templates = await templatesForRequest(req)
      res.json({ templates: templates.map(summarize) })
    } catch (error) {
      console.error('[upload-templates] list failed', error)
      res.status(500).json({ error: error?.message || 'Could not load templates.' })
    }
  })

  app.get('/api/upload-templates/:id', async (req, res) => {
    try {
      const tpl = await findTemplate(req, req.params.id)
      if (!tpl) return res.status(404).json({ error: 'Template not found.' })
      res.json(tpl)
    } catch (error) {
      console.error('[upload-templates] read failed', error)
      res.status(500).json({ error: error?.message || 'Could not load template.' })
    }
  })

  app.post('/api/upload-templates', async (req, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Sign in to continue.', code: 'UNAUTHENTICATED' })
      }
      const body = req.body || {}
      const name = String(body.name || '').trim()
      if (!name) return res.status(400).json({ error: 'Please give this template a name.' })
      if (!body.type || !['word', 'excel'].includes(body.type)) {
        return res.status(400).json({ error: 'Invalid template type.' })
      }

      const design = body.design && typeof body.design === 'object' ? { ...body.design } : {}
      let content
      let mapping

      if (body.fileId) {
        const meta = await readUploadFileMeta(body.fileId)
        if (!meta) return res.status(400).json({ error: 'Uploaded file not found. Please upload again.' })
        await migrateLocalFileToSupabase(body.fileId, req.userId)
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
          mapping = body.mapping || mapped.mapping
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

      // Allow client to override columns if provided
      if (Array.isArray(body.columns) && body.columns.length) {
        mapping.columns = body.columns.map(c => ({
          id: String(c.id || slugify(c.label) || 'col'),
          label: String(c.label || c.id || 'Column')
        }))
      }

      const now = new Date().toISOString()
      const template = {
        id: newId(),
        userId: req.userId,
        name,
        type: body.type,
        sourceFileName: body.sourceFileName || '',
        createdAt: now,
        updatedAt: now,
        design,
        content,
        mapping
      }

      await persistTemplate(req, template, { insert: true })
      res.json({ template: summarize(template), full: template })
    } catch (error) {
      console.error('[upload-templates] save failed', error)
      res.status(500).json({ error: error?.message || 'Could not save template.' })
    }
  })

  app.delete('/api/upload-templates/:id', async (req, res) => {
    try {
      const tpl = await findTemplate(req, req.params.id)
      if (!tpl) return res.status(404).json({ error: 'Template not found.' })
      await deleteSupabaseTemplate(req.params.id, req.userId)
      removeLocalTemplate(req.params.id)
      res.json({ ok: true })
    } catch (error) {
      console.error('[upload-templates] delete failed', error)
      res.status(500).json({ error: error?.message || 'Could not delete template.' })
    }
  })

  app.patch('/api/upload-templates/:id', async (req, res) => {
    try {
      const tpl = await findTemplate(req, req.params.id)
      if (!tpl) return res.status(404).json({ error: 'Template not found.' })
      applyPatchToTemplate(tpl, req.body || {}, req.userId)
      await persistTemplate(req, tpl)
      res.json({ template: summarize(tpl), full: tpl })
    } catch (error) {
      console.error('[upload-templates] patch failed', error)
      res.status(500).json({ error: error?.message || 'Could not update template.' })
    }
  })
}

export { TEMP_ROLES }
