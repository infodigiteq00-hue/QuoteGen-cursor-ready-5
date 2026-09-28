import { normalizeColumnList } from '../shared/quoteColumns.js'

export const COLUMN_LAYOUT_STORAGE_KEY = 'qg-column-layout'

export function peekPreferredColumns() {
  try {
    const raw = localStorage.getItem(COLUMN_LAYOUT_STORAGE_KEY)
    if (!raw) return null
    const cols = normalizeColumnList(JSON.parse(raw))
    return cols.length ? cols : null
  } catch {
    return null
  }
}

export function writePreferredColumns(cols) {
  const next = normalizeColumnList(cols)
  if (!next.length) return next
  try { localStorage.setItem(COLUMN_LAYOUT_STORAGE_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  return next
}

export function readPreferredColumns(fallback) {
  return peekPreferredColumns() || (Array.isArray(fallback) && fallback.length ? normalizeColumnList(fallback) : [])
}
