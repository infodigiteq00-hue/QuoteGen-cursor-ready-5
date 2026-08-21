import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

function isInSuggestUi(node, wrapEl) {
  if (!node) return false
  if (wrapEl?.contains(node)) return true
  return Boolean(node.closest?.('.qg-suggest-list'))
}

function cssZoom(el) {
  if (!el) return 1
  const raw = getComputedStyle(el).zoom
  if (!raw || raw === 'normal') return 1
  const num = parseFloat(raw)
  return Number.isFinite(num) && num > 0 ? num : 1
}

function getSuggestRoot(anchorEl) {
  if (!anchorEl?.closest || typeof document === 'undefined') return document.body
  return (
    anchorEl.closest('.qg-studio-paper-frame') ||
    anchorEl.closest('.upload-word-page') ||
    document.body
  )
}

function placeSuggestList(anchorEl, rootEl) {
  const box = anchorEl?.getBoundingClientRect?.()
  const margin = 8
  const fixed = !rootEl || rootEl === document.body
  const rootBox = fixed ? { top: 0, left: 0 } : rootEl.getBoundingClientRect()
  const zoom = fixed ? 1 : cssZoom(rootEl)
  const toLocalX = (visual) => (visual - rootBox.left) / zoom
  const toLocalY = (visual) => (visual - rootBox.top) / zoom

  const fieldW = box ? box.width / zoom : 280
  const width = Math.min(Math.max(fieldW, 280), (window.innerWidth / zoom) - margin * 2)
  if (!box) {
    return { top: 8, left: 8, width, maxHeight: 220, position: fixed ? 'fixed' : 'absolute' }
  }

  let left = toLocalX(box.left)
  const maxLeft = toLocalX(window.innerWidth - margin) - width
  if (left > maxLeft) left = Math.max(margin, maxLeft)
  if (left < margin) left = margin

  const spaceBelow = window.innerHeight - box.bottom - margin
  const spaceAbove = box.top - margin
  const openBelow = spaceBelow >= 120 || spaceBelow >= spaceAbove
  const maxH = 220

  if (openBelow) {
    return {
      top: toLocalY(box.bottom + 4),
      left,
      width,
      maxHeight: Math.min(maxH, Math.max(80, spaceBelow / zoom)),
      position: fixed ? 'fixed' : 'absolute'
    }
  }
  const maxHeight = Math.min(maxH, Math.max(80, spaceAbove / zoom - 4))
  return {
    top: Math.max(margin, toLocalY(box.top) - 4 - maxHeight),
    left,
    width,
    maxHeight,
    position: fixed ? 'fixed' : 'absolute'
  }
}

export function SuggestField({
  value,
  onChange,
  onPick,
  onBlur,
  suggestions = [],
  placeholder,
  className = '',
  style,
  bold,
  large,
  inputRef,
  multiline,
  autoFocus
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef(null)
  const list = open && suggestions.length ? suggestions : []

  useEffect(() => { setActive(0) }, [value])

  useEffect(() => {
    const onDoc = (e) => {
      if (!isInSuggestUi(e.target, wrapRef.current)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (item) => {
    onPick?.(item)
    setOpen(false)
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
    value: value || '',
    placeholder,
    className: fieldClass,
    style,
    autoComplete: 'off',
    autoFocus,
    onChange: (e) => {
      onChange(e.target.value)
      setOpen(true)
    },
    onFocus: () => setOpen(true),
    onBlur: () => {
      window.setTimeout(() => {
        if (isInSuggestUi(document.activeElement, wrapRef.current)) return
        setOpen(false)
        onBlur?.()
      }, 80)
    },
    onKeyDown
  }

  return (
    <div className={`qg-suggest${list.length ? ' qg-suggest--open' : ''}`} ref={wrapRef}>
      {multiline ? (
        <textarea ref={inputRef} rows={Math.max(2, String(value || '').split('\n').length)} {...shared} />
      ) : (
        <input ref={inputRef} type="text" {...shared} />
      )}
      {list.length ? (
        <SuggestionMenu
          items={list}
          active={active}
          onPick={pick}
          onHover={setActive}
          anchorRef={wrapRef}
        />
      ) : null}
    </div>
  )
}

export function SuggestionMenu({ items, active, onPick, onHover, anchorRef }) {
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    if (!items.length || !anchorRef) return undefined
    const update = () => {
      const anchor = anchorRef.current
      if (!anchor) return
      const root = getSuggestRoot(anchor)
      setPos({ root, ...placeSuggestList(anchor, root) })
    }
    update()
    const id = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [items, anchorRef, active])

  if (!items.length || !pos?.root) return null

  return createPortal(
    <div
      className="qg-suggest-list qg-suggest-list--portal no-print"
      role="listbox"
      style={{
        position: pos.position,
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        zIndex: 500
      }}
    >
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
    </div>,
    pos.root
  )
}
