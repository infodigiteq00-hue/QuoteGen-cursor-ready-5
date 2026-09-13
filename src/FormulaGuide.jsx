import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  canHaveFormula,
  chainToTokens,
  defaultFormulaTokens,
  formulaExpression,
  formulaOperandOptions,
  formulaSentence,
  isFormulaColumn,
  normalizeFormula,
  parsePlainFormula,
  tokensToChain
} from '../shared/quoteFormulas.js'
import { findFieldColumn } from '../shared/quoteColumns.js'
import { suggestFormulaFromAsk } from '../shared/formulaAssistant.js'

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
  if (!box) return { top: 8, left: 8, width: 440, maxHeight: 520 }
  const margin = 8
  const width = Math.min(440, window.innerWidth - margin * 2)
  let left = box.left
  if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
  if (left < margin) left = margin

  const wanted = panelEl?.offsetHeight || 280
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
  const [typed, setTyped] = useState(() => formulaExpression(normalizeFormula(col?.formula)?.tokens || [], columns))
  const [typedError, setTypedError] = useState('')
  const [pos, setPos] = useState({ top: 0, left: 0, width: 440, maxHeight: 520, ready: false })
  const [ask, setAsk] = useState('')
  const [proposal, setProposal] = useState(null)
  const [asking, setAsking] = useState(false)
  const anchorRef = useRef(null)
  const panelRef = useRef(null)
  const skipTypedSync = useRef(false)

  const amountCol = findFieldColumn(columns, 'amount')
  const isAmountCol = amountCol && col?.id === amountCol.id

  useEffect(() => {
    const next = chainForColumn(col, columns)
    setChain(next)
    const formula = normalizeFormula(col?.formula)
    setTyped(formulaExpression(formula?.tokens?.length ? formula.tokens : chainToTokens(next, options), columns))
    setTypedError('')
  }, [col?.id, col?.label, col?.formula])

  useEffect(() => {
    if (skipTypedSync.current) {
      skipTypedSync.current = false
      return
    }
    const tokens = chainToTokens(chain, options)
    setTyped(formulaExpression(tokens, columns))
  }, [chain, options, columns])

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
  }, [col?.id, chain, typed])

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

  const wrapParens = () => {
    setChain(prev => [{ kind: 'paren', paren: '(' }, ...prev, { kind: 'paren', paren: ')' }])
  }

  const insertParen = (paren) => {
    setChain(prev => [...prev, { kind: 'paren', paren }])
  }

  const removeAt = (valueIndex) => {
    setChain(prev => {
      if (prev.filter(item => item.kind === 'value').length <= 2) return prev
      const next = prev.filter((_, i) => i !== valueIndex && i !== valueIndex - 1)
      return next.length >= 3 ? next : emptyChain()
    })
  }

  const applyTyped = () => {
    const tokens = parsePlainFormula(typed, columns, col.id)
    if (!tokens.length) {
      setTypedError('Could not read that expression.')
      return
    }
    const formula = normalizeFormula({ version: 1, tokens })
    if (!formula) {
      setTypedError('Check parentheses and signs, then try again.')
      return
    }
    skipTypedSync.current = true
    setChain(tokensToChain(formula.tokens, columns))
    setTyped(formulaExpression(formula.tokens, columns))
    setTypedError('')
  }

  const save = () => {
    const fromTyped = typed.trim() ? parsePlainFormula(typed, columns, col.id) : []
    const tokens = fromTyped.length ? fromTyped : chainToTokens(chain, options)
    if (!tokens.length) {
      onSave(null)
      return
    }
    const formula = normalizeFormula({ version: 1, tokens })
    if (!formula) {
      setTypedError('Formula is incomplete — check ( ) and signs.')
      return
    }
    onSave(formula)
  }

  const applyProposal = (next) => {
    const formula = next?.formula
    if (!formula?.tokens?.length) return
    skipTypedSync.current = true
    setChain(tokensToChain(formula.tokens, columns))
    setTyped(formulaExpression(formula.tokens, columns))
    setProposal({
      status: 'ready',
      title: next.title || next.label || 'Suggested formula',
      steps: next.steps || [],
      formula,
      sentence: next.sentence || '',
      choices: null
    })
  }

  const runAsk = async (event) => {
    event?.preventDefault?.()
    const q = ask.trim()
    if (!q) return
    setAsking(true)
    const local = suggestFormulaFromAsk(q, col, columns)
    if (local.status !== 'unrecognized') {
      setProposal(local)
      if (local.status === 'ready') applyProposal(local)
      setAsking(false)
      return
    }
    try {
      const response = await fetch('/api/suggest-formula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ask: q, column: { id: col.id, label: col.label }, columns })
      })
      const data = await response.json().catch(() => null)
      const next = data?.status ? data : local
      setProposal(next)
      if (next.status === 'ready') applyProposal(next)
    } catch {
      setProposal(local)
    } finally {
      setAsking(false)
    }
  }

  const valueCount = chain.filter(item => item.kind === 'value').length
  const preview = formulaSentence(chainToTokens(chain, options), columns)

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`${col.label || 'Column'} formula`}
      className="qg-formula-pop qg-formula-pop--ai no-print rounded-2xl border border-slate-200/80 bg-white p-3.5 text-left font-normal normal-case tracking-normal shadow-[0_18px_50px_-18px_rgba(29,99,237,0.35)]"
      style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight, overflow: 'auto', visibility: pos.ready ? 'visible' : 'hidden' }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <p className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-moss text-[11px] font-bold text-white">fx</span>
        {col.label || 'This column'} =
      </p>
      <p className="mt-1 text-[11px] leading-snug text-slate-400">
        {isAmountCol
          ? 'Built-in Amount is Quantity × Rate (then discount & line tax). Set a custom formula here only if you need to override that.'
          : 'Build step by step, or type an expression. Use ( ) to group.'}
      </p>

      <label className="mt-2.5 block text-[11px] font-semibold text-slate-500">Type expression</label>
      <div className="mt-1 flex gap-1.5">
        <input
          value={typed}
          onChange={e => { setTyped(e.target.value); setTypedError('') }}
          onBlur={applyTyped}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyTyped() } }}
          placeholder="e.g. qty x rate - disc + tax%   or   (Quantity × Rate) − Discount"
          className="min-w-0 flex-1 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-[12px] text-slate-700 outline-none focus:border-moss focus:ring-2 focus:ring-blue-50"
        />
        <button
          type="button"
          onClick={applyTyped}
          className="shrink-0 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-[12px] font-semibold text-moss hover:bg-blue-50"
        >
          Apply
        </button>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-slate-400">
        Discount/tax written as % are taken off / added as real ₹ (list × % ÷ 100), not multiplied as raw numbers.
      </p>
      {typedError ? <p className="mt-1 text-[11px] text-rose-600">{typedError}</p> : null}

      <div className="mt-2 flex flex-wrap gap-1">
        <button type="button" onClick={() => insertParen('(')} className="h-7 min-w-[1.75rem] rounded-md border border-sand bg-white text-[13px] font-semibold text-slate-700 hover:border-moss"> ( </button>
        <button type="button" onClick={() => insertParen(')')} className="h-7 min-w-[1.75rem] rounded-md border border-sand bg-white text-[13px] font-semibold text-slate-700 hover:border-moss"> ) </button>
        <button type="button" onClick={wrapParens} className="h-7 rounded-md border border-dashed border-sand bg-white px-2 text-[11px] font-semibold text-moss hover:border-moss">Wrap ( )</button>
      </div>

      <p className="mt-2.5 text-[11px] font-semibold text-slate-500">Or assemble: value → sign → value</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50/80 p-2.5">
        {chain.map((item, i) => {
          if (item.kind === 'paren') {
            return (
              <button
                key={`paren-${i}`}
                type="button"
                title="Remove parenthesis"
                onClick={() => setChain(prev => prev.filter((_, idx) => idx !== i))}
                className="inline-flex h-8 min-w-[1.75rem] items-center justify-center rounded-md border border-sand bg-white text-[14px] font-bold text-slate-700 hover:border-rose-300 hover:text-rose-600"
              >
                {item.paren}
              </button>
            )
          }
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
                <option value="">Select…</option>
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
          + Add
        </button>
      </div>
      {preview ? (
        <p className="mt-2 rounded-md bg-blue-50/70 px-2 py-1 text-[11px] font-medium text-moss">{preview}</p>
      ) : null}

      <form className="qg-ai-help mt-3 rounded-xl p-[1px]" onSubmit={runAsk}>
        <div className="rounded-[11px] bg-white/90 px-2.5 py-2">
          <label className="flex items-center gap-1.5">
            <span className="qg-ai-help__badge inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
                <path d="M6 0.6l.95 3.3H10.5L7.7 6.05l.95 3.35L6 7.4 3.35 9.4l.95-3.35L1.5 3.9h3.55L6 .6z" fill="currentColor" />
              </svg>
              AI help
            </span>
            <span className="text-[11px] font-medium text-slate-500">Ask in plain English</span>
          </label>
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={ask}
              onChange={e => setAsk(e.target.value)}
              placeholder="e.g. Amount before tax"
              className="min-w-0 flex-1 rounded-lg border border-violet-100 bg-white px-2.5 py-1.5 text-[12px] text-slate-700 outline-none placeholder:text-slate-400 focus:border-moss focus:ring-2 focus:ring-blue-50"
            />
            <button
              type="submit"
              disabled={asking || !ask.trim()}
              className="shrink-0 rounded-lg bg-moss px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm disabled:opacity-50 hover:bg-[#1558b0]"
            >
              {asking ? '…' : 'Ask'}
            </button>
          </div>
        </div>
      </form>
      {proposal && (
        <div className="mt-2 space-y-1 rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/80 to-blue-50/70 px-2.5 py-2 text-[11px] text-slate-600">
          {(proposal.steps || []).map((step, i) => (
            <p key={i} className="flex gap-1.5 leading-snug">
              <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white text-[9px] font-bold text-moss shadow-sm">{i + 1}</span>
              <span>{step}</span>
            </p>
          ))}
          {proposal.sentence && proposal.status === 'ready' && (
            <p className="mt-1 rounded-md bg-white/80 px-2 py-1 font-semibold text-moss">{proposal.sentence}</p>
          )}
          {proposal.status === 'need_choice' && (proposal.choices || []).map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => applyProposal(item)}
              className="mt-1 mr-1 rounded-full border border-moss/20 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-moss hover:border-moss hover:bg-blue-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => { setChain(emptyChain()); setTyped(''); onSave(null) }}
          className="text-[12px] text-slate-400 hover:text-rose-600"
        >
          {isFormulaColumn(col) ? (isAmountCol ? 'Back to Qty × Rate' : 'Remove formula') : 'No formula'}
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
