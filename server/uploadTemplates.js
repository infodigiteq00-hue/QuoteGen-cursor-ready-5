import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import {
  scrubTransientWordShell,
  scrubTransientExcelShell,
  inferTemplatePageWidth,
  pickLineItemsTable,
  mapHeaderToField,
  mapHeadersToFields
} from '../shared/templateMap.js'
import { getDataDir } from './runtimeFs.js'

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

function looksLikeHeaderRow(cells) {
  const texts = cells.map(c => String(c.value || '').toLowerCase())
  const hits = texts.filter(t =>
    /desc|item|particular|qty|quantity|rate|amount|unit|hsn|price|total/.test(t)
  ).length
  return hits >= 2
}

function scrubWordHtml(html) {
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
      slots: [
        { role: 'quote_number', permanent: false },
        { role: 'date', permanent: false },
        { role: 'customer_name', permanent: false },
        { role: 'customer_company', permanent: false },
        { role: 'subject', permanent: false },
        { role: 'line_items', permanent: false },
        { role: 'total', permanent: false },
        { role: 'company_block', permanent: true },
        { role: 'bank_details', permanent: true },
        { role: 'terms', permanent: true },
        { role: 'images', permanent: true }
      ]
    }
  }
}

function scrubExcelSheets(sheets) {
  const cleaned = scrubTransientExcelShell(sheets)
  let columns = defaultColumns()
  for (const sheet of cleaned) {
    for (let i = 0; i < Math.min(sheet.rows.length, 40); i++) {
      if (looksLikeHeaderRow(sheet.rows[i].cells)) {
        const labels = sheet.rows[i].cells.map(c => String(c.value || '').trim())
        const ids = mapHeadersToFields(labels, [])
        columns = sheet.rows[i].cells
          .map((c, idx) => {
            const id = ids[idx]
            if (id === '__sr__') return null
            return {
              id: id || slugify(c.value) || `col${idx + 1}`,
              label: String(c.value || `Column ${idx + 1}`).trim() || `Column ${idx + 1}`
            }
          })
          .filter(Boolean)
        break
      }
    }
  }
  return {
    sheets: cleaned,
    mapping: {
      columns,
      slots: [
        { role: 'line_items', permanent: false },
        { role: 'quote_number', permanent: false },
        { role: 'date', permanent: false },
        { role: 'total', permanent: false },
        { role: 'formulas', permanent: true },
        { role: 'header_footer', permanent: true },
        { role: 'images', permanent: true }
      ],
      dynamicCells: []
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

export function registerUploadTemplateRoutes(app) {
  app.get('/api/upload-templates', (_req, res) => {
    const store = readStore()
    res.json({ templates: store.templates.map(summarize) })
  })

  app.get('/api/upload-templates/:id', (req, res) => {
    const store = readStore()
    const tpl = store.templates.find(t => t.id === req.params.id)
    if (!tpl) return res.status(404).json({ error: 'Template not found.' })
    res.json(tpl)
  })

  app.post('/api/upload-templates', (req, res) => {
    try {
      const body = req.body || {}
      const name = String(body.name || '').trim()
      if (!name) return res.status(400).json({ error: 'Please give this template a name.' })
      if (!body.type || !['word', 'excel'].includes(body.type)) {
        return res.status(400).json({ error: 'Invalid template type.' })
      }

      const design = body.design && typeof body.design === 'object' ? { ...body.design } : {}
      let content
      let mapping

      if (body.type === 'word') {
        const scrubbed = scrubWordHtml(body.html || '')
        content = { html: scrubbed.html }
        mapping = scrubbed.mapping
        design.pageWidthPx = inferTemplatePageWidth('word', scrubbed.html, design)
      } else {
        const scrubbed = scrubExcelSheets(body.sheets || [])
        content = {
          sheets: scrubbed.sheets,
          activeSheet: body.activeSheet || 0
        }
        mapping = scrubbed.mapping
        design.pageWidthPx = inferTemplatePageWidth('excel', scrubbed.sheets, design)
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
        name,
        type: body.type,
        sourceFileName: body.sourceFileName || '',
        createdAt: now,
        updatedAt: now,
        design,
        content,
        mapping
      }

      const store = readStore()
      store.templates.unshift(template)
      writeStore(store)
      res.json({ template: summarize(template), full: template })
    } catch (error) {
      console.error('[upload-templates] save failed', error)
      res.status(500).json({ error: error?.message || 'Could not save template.' })
    }
  })

  app.delete('/api/upload-templates/:id', (req, res) => {
    const store = readStore()
    const before = store.templates.length
    store.templates = store.templates.filter(t => t.id !== req.params.id)
    if (store.templates.length === before) return res.status(404).json({ error: 'Template not found.' })
    writeStore(store)
    res.json({ ok: true })
  })
}

export { TEMP_ROLES }
