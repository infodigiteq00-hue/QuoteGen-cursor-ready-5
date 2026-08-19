import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

function place(anchorEl, panelEl, { width, align }) {
  const box = anchorEl?.getBoundingClientRect?.()
  if (!box) return { top: 8, left: 8, width, maxHeight: 480 }
  const margin = 8
  const w = Math.min(width, window.innerWidth - margin * 2)
  let left = align === 'end' ? box.right - w : box.left
  if (left + w > window.innerWidth - margin) left = window.innerWidth - margin - w
  if (left < margin) left = margin

  const wanted = panelEl?.offsetHeight || 240
  const spaceBelow = window.innerHeight - box.bottom - margin
  const spaceAbove = box.top - margin
  const openBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove

  if (openBelow) {
    const top = box.bottom + 6
    return { top, left, width: w, maxHeight: Math.max(160, window.innerHeight - top - margin) }
  }
  const maxHeight = Math.max(160, spaceAbove - 6)
  const top = Math.max(margin, box.top - 6 - Math.min(wanted, maxHeight))
  return { top, left, width: w, maxHeight }
}

export default function FloatingPop({ anchorRef, open, onClose, width = 220, align = 'start', className = '', children }) {
  const panelRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width, maxHeight: 480, ready: false })

  useLayoutEffect(() => {
    if (!open) return undefined
    const update = () => setPos({ ...place(anchorRef?.current, panelRef.current, { width, align }), ready: true })
    update()
    const id = requestAnimationFrame(update)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    if (panelRef.current && ro) ro.observe(panelRef.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(id)
      ro?.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open, width, align, anchorRef])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, onClose, anchorRef])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={panelRef}
      className={`qg-formula-pop no-print ${className}`}
      style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight, visibility: pos.ready ? 'visible' : 'hidden' }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  )
}
