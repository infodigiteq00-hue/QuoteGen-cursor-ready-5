import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ''))
}

function toEditorHtml(value) {
  const raw = value == null ? '' : typeof value === 'string' ? value : String(value)
  if (!raw) return ''
  if (looksLikeHtml(raw)) return raw
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>')
}

function plainFromHtml(html) {
  try {
    const el = document.createElement('div')
    el.innerHTML = String(html || '')
    return (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ')
  } catch {
    return String(html || '').replace(/<[^>]+>/g, '')
  }
}

/**
 * Inline rich text for quote surfaces (terms, notes, headings).
 * Keeps DOM edits local while focused; commits to React on blur / format.
 */
export default function RichTextField({
  value,
  onChange,
  placeholder = '',
  className = '',
  style,
  multiline = true,
  singleLine = false
}) {
  const ref = useRef(null)
  const focusedRef = useRef(false)
  const lastEmitted = useRef(null)
  const emitTimer = useRef(null)
  const [focused, setFocused] = useState(false)
  const [toolbar, setToolbar] = useState(null)

  const safeValue = value == null ? '' : typeof value === 'string' ? value : String(value)

  useEffect(() => () => {
    if (emitTimer.current) window.clearTimeout(emitTimer.current)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || focusedRef.current) return
    const next = toEditorHtml(safeValue)
    if (el.innerHTML !== next) el.innerHTML = next || ''
  }, [safeValue])

  const readValue = () => {
    const el = ref.current
    if (!el) return ''
    const html = el.innerHTML
    const plain = plainFromHtml(html).trim()
    if (!plain) return ''
    if (looksLikeHtml(html) && /<(?:b|i|u|strong|em|span|font|br)\b/i.test(html)) return html
    return plainFromHtml(html).replace(/\n$/, '')
  }

  const emit = (force = false) => {
    try {
      const next = readValue()
      if (!force && next === lastEmitted.current) return
      if (!force && next === safeValue) {
        lastEmitted.current = next
        return
      }
      lastEmitted.current = next
      onChange?.(next)
    } catch (err) {
      console.warn('[RichTextField] emit failed', err)
    }
  }

  const placeToolbar = () => {
    const el = ref.current
    if (!el || !focusedRef.current) {
      setToolbar(null)
      return
    }
    const box = el.getBoundingClientRect()
    const width = Math.min(340, window.innerWidth - 16)
    let left = box.left
    if (left + width > window.innerWidth - 8) left = window.innerWidth - 8 - width
    if (left < 8) left = 8
    const spaceAbove = box.top
    const top = spaceAbove > 44 ? box.top - 40 : box.bottom + 6
    setToolbar({ top, left, width })
  }

  useLayoutEffect(() => {
    if (!focused) {
      setToolbar(null)
      return undefined
    }
    placeToolbar()
    const onScroll = () => placeToolbar()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [focused])

  const run = (cmd, val = null) => {
    ref.current?.focus()
    try {
      document.execCommand(cmd, false, val)
    } catch {
      /* ignore */
    }
    emit(true)
    placeToolbar()
  }

  return (
    <>
      <div
        ref={ref}
        role="textbox"
        aria-multiline={multiline && !singleLine}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className={`qg-rich-field ${singleLine ? 'qg-rich-field--single' : ''} ${className}`}
        style={style}
        onFocus={() => {
          focusedRef.current = true
          setFocused(true)
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (ref.current?.contains(document.activeElement)) return
            if (document.activeElement?.closest?.('.qg-rich-toolbar')) return
            focusedRef.current = false
            setFocused(false)
            emit(true)
          }, 120)
        }}
        onInput={() => {
          // Debounce parent updates so typing stays smooth and we avoid
          // re-render loops while the caret is in the contentEditable.
          if (emitTimer.current) window.clearTimeout(emitTimer.current)
          emitTimer.current = window.setTimeout(() => emit(false), 200)
        }}
        onKeyDown={(e) => {
          if (singleLine && e.key === 'Enter') {
            e.preventDefault()
            if (emitTimer.current) window.clearTimeout(emitTimer.current)
            emit(true)
            ref.current?.blur()
          }
        }}
      />
      {focused && toolbar ? createPortal(
        <div
          className="qg-rich-toolbar no-print"
          style={{ top: toolbar.top, left: toolbar.left, width: toolbar.width }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <button type="button" title="Bold" className="font-bold" onClick={() => run('bold')}>B</button>
          <button type="button" title="Italic" className="italic" onClick={() => run('italic')}>I</button>
          <button type="button" title="Underline" className="underline" onClick={() => run('underline')}>U</button>
          <span className="qg-rich-sep" />
          <button type="button" title="Smaller" onClick={() => run('fontSize', '2')}>A−</button>
          <button type="button" title="Larger" onClick={() => run('fontSize', '4')}>A+</button>
          <span className="qg-rich-sep" />
          <label className="qg-rich-color" title="Text color">
            <span>A</span>
            <input type="color" defaultValue="#1e293b" onChange={(e) => run('foreColor', e.target.value)} />
          </label>
          <button type="button" title="Clear formatting" onClick={() => run('removeFormat')}>Clear</button>
        </div>,
        document.body
      ) : null}
    </>
  )
}

/** Safe plain/HTML renderer for print / read-only. */
export function RichTextView({ value, className = '', style, as: Tag = 'div' }) {
  const safe = value == null ? '' : typeof value === 'string' ? value : String(value)
  if (!safe) return null
  if (looksLikeHtml(safe)) {
    return <Tag className={className} style={style} dangerouslySetInnerHTML={{ __html: safe }} />
  }
  return <Tag className={`${className} whitespace-pre-line`} style={style}>{safe}</Tag>
}
