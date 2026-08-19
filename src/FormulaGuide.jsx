import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  canHaveFormula,
  chainToTokens,
  defaultFormulaTokens,
  formulaOperandOptions,
  isFormulaColumn,
  normalizeFormula,
  tokensToChain
} from '../shared/quoteFormulas.js'

const SIGNS = [
  { value: '*', label: '×' },
  { value: '/', label: '÷' },
  { value: '+', label: '+' },
  { value: '-', label: '−' },
  { value: 'pctOf', label: '% of' }
]
const ARITH_SIGNS = SIGNS.filter(sign => sign.value !== 'pctOf')
const ARITH_OPS = ARITH_SIGNS.map(sign => sign.value)

function isPctOfRightValue(chain, valueIndex) {
  return chain[valueIndex]?.kind === 'value'
    && chain[valueIndex - 1]?.kind === 'op'
    && chain[valueIndex - 1].op === 'pctOf'
}

function isPctOfFollowOp(chain, opIndex) {
  return chain[opIndex]?.kind === 'op'
    && ARITH_OPS.includes(chain[opIndex].op)
    && isPctOfRightValue(chain, opIndex - 1)
}

function emptyChain() {
  return [
    { kind: 'value', key: '' },
    { kind: 'op', op: '*' },
    { kind: 'value', key: '' }
  ]
}

function chainForColumn(col, columns) {
  const existing = normalizeFormula(col?.formula)
  const tokens = existing?.tokens?.length ? existing.tokens : defaultFormulaTokens(col, columns)
  return tokensToChain(tokens, columns)
}

function placePanel(anchorEl, panelEl) {
  const box = (anchorEl?.closest?.('th,td') || anchorEl)?.getBoundingClientRect?.()
  if (!box) return { top: 8, left: 8, width: 400, maxHeight: 480 }
  const margin = 8
  const width = Math.min(400, window.innerWidth - margin * 2)
  let left = box.left
  if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
  if (left < margin) left = margin

  const wanted = panelEl?.offsetHeight || 260
  const spaceBelow = window.innerHeight - box.bottom - margin
  const spaceAbove = box.top - margin
  const openBelow = spaceBelow >= 180 || spaceBelow >= spaceAbove

  if (openBelow) {
    const top = box.bottom + 6
    return { top, left, width, maxHeight: Math.max(160, window.innerHeight - top - margin) }
  }
  const maxHeight = Math.max(160, spaceAbove - 6)
  const top = Math.max(margin, box.top - 6 - Math.min(wanted, maxHeight))
  return { top, left, width, maxHeight }
}

const selectClass = 'max-w-[9.5rem] rounded-md border border-sand bg-white px-1.5 py-1 text-[12px] text-slate-700 outline-none focus:border-moss'

export default function FormulaGuide({ col, columns, onSave, onClose }) {
  const options = useMemo(() => formulaOperandOptions(columns, col?.id), [columns, col?.id])
  const [chain, setChain] = useState(() => chainForColumn(col, columns))
  const [pos, setPos] = useState({ top: 0, left: 0, width: 400, maxHeight: 480, ready: false })
  const anchorRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    setChain(chainForColumn(col, columns))
  }, [col?.id, col?.label, col?.formula])

  useLayoutEffect(() => {
    const update = () => setPos({ ...placePanel(anchorRef.current, panelRef.current), ready: true })
    update()
    const id = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [col?.id, chain])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!col || !canHaveFormula(col, columns)) return null

  const setValue = (index, key) => {
    setChain(prev => prev.map((item, i) => (i === index && item.kind === 'value' ? { ...item, key } : item)))
  }

  const setOp = (index, op) => {
    setChain(prev => prev.map((item, i) => (i === index && item.kind === 'op' ? { ...item, op } : item)))
  }

  const setFollowOp = (valueIndex, op) => {
    if (!ARITH_OPS.includes(op)) return
    setChain(prev => {
      if (!isPctOfRightValue(prev, valueIndex)) return prev
      if (prev[valueIndex + 1]?.kind === 'op') {
        return prev.map((item, i) => (i === valueIndex + 1 && item.kind === 'op' ? { ...item, op } : item))
      }
      const next = [...prev]
      next.splice(valueIndex + 1, 0, { kind: 'op', op }, { kind: 'value', key: '' })
      return next
    })
  }

  const addMore = () => {
    setChain(prev => [...prev, { kind: 'op', op: '+' }, { kind: 'value', key: '' }])
  }

  const removeAt = (valueIndex) => {
    setChain(prev => {
      if (prev.filter(item => item.kind === 'value').length <= 2) return prev
      const next = prev.filter((_, i) => i !== valueIndex && i !== valueIndex - 1)
      return next.length >= 3 ? next : emptyChain()
    })
  }

  const save = () => {
    const tokens = chainToTokens(chain, options)
    if (!tokens.length) {
      onSave(null)
      return
    }
    onSave(normalizeFormula({ version: 1, tokens }))
  }

  const valueCount = chain.filter(item => item.kind === 'value').length

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${col.label || 'Column'} formula`}
      className="qg-formula-pop no-print rounded-xl border border-sand bg-white p-3 text-left font-normal normal-case tracking-normal shadow-lg"
      style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight, visibility: pos.ready ? 'visible' : 'hidden' }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <p className="text-[13px] font-semibold text-slate-800">
        {col.label || 'This column'} =
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">Pick columns and a sign. Add more if you need a longer line.</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-sand bg-[#f7f9f7] p-2">
        {chain.map((item, i) => {
          if (item.kind === 'op') {
            if (isPctOfFollowOp(chain, i)) return null
            const rhs = i + 1
            const followOp = item.op === 'pctOf' && chain[rhs]?.kind === 'value' && chain[rhs + 1]?.kind === 'op' && ARITH_OPS.includes(chain[rhs + 1].op)
              ? chain[rhs + 1].op
              : ''
            return (
              <span key={`op-${i}`} className="inline-flex items-center gap-0.5">
                {item.op === 'pctOf' && (
                  <select
                    value={followOp}
                    onChange={e => setFollowOp(rhs, e.target.value)}
                    aria-label="Sign before percent"
                    className="h-8 rounded-md border border-sand bg-white px-1 text-[13px] font-semibold text-slate-700 outline-none focus:border-moss"
                  >
                    <option value="" disabled hidden />
                    {ARITH_SIGNS.map(sign => (
                      <option key={sign.value} value={sign.value}>{sign.label}</option>
                    ))}
                  </select>
                )}
                <select
                  value={item.op}
                  onChange={e => setOp(i, e.target.value)}
                  aria-label="Sign"
                  className="h-8 rounded-md border border-sand bg-white px-1 text-[13px] font-semibold text-slate-700 outline-none focus:border-moss"
                >
                  {SIGNS.map(sign => (
                    <option key={sign.value} value={sign.value}>{sign.label}</option>
                  ))}
                </select>
              </span>
            )
          }
          const extra = i > 2 && valueCount > 2
          return (
            <span key={`val-${i}`} className="inline-flex items-center gap-0.5">
              <select
                value={item.key}
                onChange={e => setValue(i, e.target.value)}
                aria-label="Select column"
                className={selectClass}
              >
                <option value="">Select column</option>
                {options.map(option => (
                  <option key={option.key} value={option.key}>{option.label}</option>
                ))}
              </select>
              {extra && (
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  title="Remove this part"
                  className="h-6 w-6 rounded-md text-[13px] text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  ×
                </button>
              )}
            </span>
          )
        })}
        <button
          type="button"
          onClick={addMore}
          className="h-8 rounded-md border border-dashed border-sand bg-white px-2 text-[12px] font-semibold text-moss hover:border-moss hover:bg-blue-50"
        >
          + Add more
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => { setChain(emptyChain()); onSave(null) }}
          className="text-[12px] text-slate-400 hover:text-rose-600"
        >
          {isFormulaColumn(col) ? 'Remove formula' : 'No formula'}
        </button>
        <div className="flex gap-1.5">
          <button type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-[12px] text-slate-500 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={save} className="rounded-md bg-moss px-3 py-1 text-[12px] font-semibold text-white hover:bg-[#1558b0]">
            Use formula
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <span ref={anchorRef} aria-hidden className="pointer-events-none absolute left-0 top-full h-px w-px" />
      {typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
    </>
  )
}
