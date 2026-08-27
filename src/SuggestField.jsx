import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

function autoGrowField(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.max(el.scrollHeight, 24)}px`
}

function isInSuggestUi(node, wrapEl) {
  if (!node) return false
  if (wrapEl?.contains(node)) return true
  return Boolean(node.closest?.('.qg-suggest-list'))
}

/** Keep scroll parents from clipping the open list (same zoom tree as the field). */
function useSuggestOverflow(open, wrapRef) {
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return undefined
    const touched = []
    let node = wrapRef.current.parentElement
    while (node && node !== document.body) {
      const style = window.getComputedStyle(node)
      const clips =
        style.overflow === 'hidden' ||
        style.overflow === 'auto' ||
        style.overflow === 'scroll' ||
        style.overflowX === 'hidden' ||
        style.overflowX === 'auto' ||
        style.overflowY === 'hidden' ||
        style.overflowY === 'auto'
      if (clips) {
        touched.push({
          el: node,
          overflow: node.style.overflow,
          overflowX: node.style.overflowX,
          overflowY: node.style.overflowY
        })
        node.style.overflow = 'visible'
        node.style.overflowX = 'visible'
        node.style.overflowY = 'visible'
      }
      if (node.classList?.contains('qg-studio-paper-frame')) break
      node = node.parentElement
    }
    return () => {
      for (const t of touched) {
        t.el.style.overflow = t.overflow
        t.el.style.overflowX = t.overflowX
        t.el.style.overflowY = t.overflowY
      }
    }
  }, [open, wrapRef])
}

function SuggestList({ items, active, onPick, onHover }) {
  if (!items.length) return null
  return (
    <div className="qg-suggest-list no-print" role="listbox">
      {items.map((item, i) => (
        <button
          key={item.id || `${item.title}-${i}`}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`qg-suggest-item ${i === active ? 'qg-suggest-item--on' : ''}`}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => onHover?.(i)}
          onClick={() => onPick(item)}
        >
          <span className="qg-suggest-title">{item.title}</span>
          {item.meta ? <span className="qg-suggest-meta">{item.meta}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function SuggestField({
  value,
  onChange,
  onPick,
  onBlur,
  onFocus,
  suggestions = [],
  placeholder,
  className = '',
  style,
  bold,
  large,
  inputRef,
  multiline,
  grow,
  autoFocus,
  cellKey
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef(null)
  const areaRef = useRef(null)
  const focusedRef = useRef(false)
  const [draft, setDraft] = useState(value || '')
  const setFieldRef = (node) => {
    areaRef.current = node
    if (!inputRef) return
    if (typeof inputRef === 'function') inputRef(node)
    else inputRef.current = node
  }
  useEffect(() => {
    if (!focusedRef.current) setDraft(value || '')
  }, [value])
  const queryLen = String(draft || '').trim().length
  const list = open && suggestions.length ? suggestions : []
  const wrap = Boolean(multiline || grow)

  useSuggestOverflow(list.length > 0, wrapRef)

  useLayoutEffect(() => {
    if (wrap) autoGrowField(areaRef.current)
  }, [draft, wrap])

  useEffect(() => { setActive(0) }, [draft])

  useEffect(() => {
    if (!focusedRef.current) return
    if (queryLen >= 1 && suggestions.length) setOpen(true)
    else if (!suggestions.length) setOpen(false)
  }, [suggestions, queryLen])

  useEffect(() => {
    const onDoc = (e) => {
      if (!isInSuggestUi(e.target, wrapRef.current)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (item) => {
    // Release the focus lock so parent-filled values (full client / product) replace the typed draft.
    focusedRef.current = false
    setOpen(false)
    onPick?.(item)
    const el = areaRef.current
    if (el && typeof el.blur === 'function') el.blur()
  }

  const onKeyDown = (e) => {
    if (!list.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive(i => (i + 1) % list.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      setActive(i => (i - 1 + list.length) % list.length)
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      pick(list[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const fieldClass = [
    'qg-inline-field',
    bold ? 'qg-inline-field--bold' : '',
    large ? 'qg-inline-field--large' : '',
    className
  ].filter(Boolean).join(' ')

  const shared = {
    value: draft,
    placeholder,
    className: fieldClass,
    style,
    autoComplete: 'off',
    autoFocus,
    'data-qg-cell-key': cellKey || undefined,
    onChange: (e) => {
      const next = e.target.value
      setDraft(next)
      onChange(next)
      if (wrap) autoGrowField(e.target)
      setOpen(String(next || '').trim().length >= 1)
    },
    onFocus: (e) => {
      focusedRef.current = true
      if (suggestions.length && String(draft || '').trim().length >= 1) setOpen(true)
      onFocus?.(e)
    },
    onBlur: () => {
      window.setTimeout(() => {
        if (isInSuggestUi(document.activeElement, wrapRef.current)) return
        focusedRef.current = false
        setOpen(false)
        onBlur?.()
      }, 80)
    },
    onKeyDown
  }

  return (
    <div className={`qg-suggest${list.length ? ' qg-suggest--open' : ''}`} ref={wrapRef}>
      {wrap ? (
        <textarea ref={setFieldRef} rows={1} {...shared} />
      ) : (
        <input ref={setFieldRef} type="text" {...shared} />
      )}
      <SuggestList items={list} active={active} onPick={pick} onHover={setActive} />
    </div>
  )
}

/** Dropdown inside an existing `.qg-suggest` wrap — same zoom context as the cell. */
export function SuggestionMenu({ items, active, onPick, onHover, anchorRef }) {
  useSuggestOverflow(items.length > 0, anchorRef)
  return <SuggestList items={items} active={active} onPick={onPick} onHover={onHover} />
}
