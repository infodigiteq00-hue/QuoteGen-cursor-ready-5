import React, { useEffect, useRef, useState } from 'react'

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
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
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
        if (!wrapRef.current?.contains(document.activeElement)) {
          setOpen(false)
          onBlur?.()
        }
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
        <SuggestionMenu items={list} active={active} onPick={pick} onHover={setActive} />
      ) : null}
    </div>
  )
}

export function SuggestionMenu({ items, active, onPick, onHover }) {
  return (
    <div className="qg-suggest-list no-print" role="listbox">
      {items.map((item, i) => (
        <button
          key={item.id || `${item.title}-${i}`}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`qg-suggest-item ${i === active ? 'qg-suggest-item--on' : ''}`}
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
