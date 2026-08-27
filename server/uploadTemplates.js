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
import { readUploadFileMeta } from './uploadFileStorage.js'

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

export function registerUploadTemplateRoutes(app) {
  app.get('/api/upload-templates', (req, res) => {
    const store = loadCompanyStore(req)
    res.json({ templates: templatesForCompany(store, req.userId).map(summarize) })
  })

  app.get('/api/upload-templates/:id', (req, res) => {
    const store = loadCompanyStore(req)
    const tpl = findOwnedTemplate(store, req.params.id, req.userId)
    if (!tpl) return res.status(404).json({ error: 'Template not found.' })
    res.json(tpl)
  })

  app.post('/api/upload-templates', (req, res) => {
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
        const meta = readUploadFileMeta(body.fileId)
        if (!meta) return res.status(400).json({ error: 'Uploaded file not found. Please upload again.' })
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

      const store = loadCompanyStore(req)
      store.templates.unshift(template)
      writeStore(store)
      res.json({ template: summarize(template), full: template })
    } catch (error) {
      console.error('[upload-templates] save failed', error)
      res.status(500).json({ error: error?.message || 'Could not save template.' })
    }
  })

  app.delete('/api/upload-templates/:id', (req, res) => {
    const store = loadCompanyStore(req)
    const tpl = findOwnedTemplate(store, req.params.id, req.userId)
    if (!tpl) return res.status(404).json({ error: 'Template not found.' })
    store.templates = store.templates.filter(t => t.id !== req.params.id)
    writeStore(store)
    res.json({ ok: true })
  })

  app.patch('/api/upload-templates/:id', (req, res) => {
    try {
      const store = loadCompanyStore(req)
      const idx = store.templates.findIndex(t => t.id === req.params.id && t.userId === req.userId)
      if (idx < 0) return res.status(404).json({ error: 'Template not found.' })
      const body = req.body || {}
      const tpl = store.templates[idx]
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
      tpl.userId = tpl.userId || req.userId
      tpl.updatedAt = new Date().toISOString()
      store.templates[idx] = tpl
      writeStore(store)
      res.json({ template: summarize(tpl), full: tpl })
    } catch (error) {
      console.error('[upload-templates] patch failed', error)
      res.status(500).json({ error: error?.message || 'Could not update template.' })
    }
  })
}

export { TEMP_ROLES }
