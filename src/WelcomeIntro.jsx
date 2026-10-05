import React, { useEffect, useRef, useState } from 'react'
import BrandMark from './BrandMark.jsx'

export function startWelcomeMusic() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return () => {}
  const ctx = new Ctx()
  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.setValueAtTime(0.22, now)
  master.connect(ctx.destination)

  const hit = (freq, start, peak, dur = 0.28) => {
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq * 2, now + start)
    osc.frequency.exponentialRampToValueAtTime(freq, now + start + 0.12)
    gainNode.gain.setValueAtTime(0.0001, now + start)
    gainNode.gain.exponentialRampToValueAtTime(peak, now + start + 0.012)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
    osc.connect(gainNode)
    gainNode.connect(master)
    osc.start(now + start)
    osc.stop(now + start + dur + 0.02)
  }

  const crack = (start) => {
    const length = Math.floor(ctx.sampleRate * 0.35)
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(240, now + start)
    const gainNode = ctx.createGain()
    gainNode.gain.setValueAtTime(0.35, now + start)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + start + 0.32)
    source.connect(filter)
    filter.connect(gainNode)
    gainNode.connect(master)
    source.start(now + start)
  }

  const stab = (freq, start, peak) => {
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, now + start)
    gainNode.gain.setValueAtTime(0.0001, now + start)
    gainNode.gain.exponentialRampToValueAtTime(peak, now + start + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + start + 2.8)
    osc.connect(gainNode)
    gainNode.connect(master)
    osc.start(now + start)
    osc.stop(now + start + 2.9)
  }

  ;[0.08, 1.08].forEach((start, index) => hit(160 + index * 30, start, 0.08, 0.12))
  hit(62, 2.05, 0.42, 0.34)
  crack(2.08)
  hit(124, 2.22, 0.24, 0.28)
  stab(261.63, 2.34, 0.11)
  stab(329.63, 2.36, 0.08)
  stab(392, 2.38, 0.07)
  stab(523.25, 2.42, 0.05)

  ctx.resume().catch(() => {})
  return () => { ctx.close().catch(() => {}) }
}

export default function WelcomeIntro({ onDone }) {
  const [scene, setScene] = useState('black')
  const [visible, setVisible] = useState(false)
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    let cancelled = false
    const timers = []
    const wait = (ms) => new Promise((resolve) => {
      timers.push(setTimeout(resolve, ms))
    })
    const run = async () => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      if (reduce) {
        setScene('tag')
        setVisible(true)
        await wait(1600)
        if (!cancelled) doneRef.current?.()
        return
      }
      const beats = [
        ['welcome', 700],
        ['to', 620]
      ]
      for (const [beat, hold] of beats) {
        if (cancelled) return
        setScene(beat)
        setVisible(false)
        await wait(30)
        if (cancelled) return
        setVisible(true)
        await wait(hold)
        if (cancelled) return
        setVisible(false)
        await wait(320)
      }
      if (cancelled) return
      setScene('brand')
      setVisible(true)
      await wait(520)
      if (cancelled) return
      setScene('tag')
      await wait(3300)
      if (!cancelled) doneRef.current?.()
    }
    run()
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [])

  const brandOn = scene === 'brand' || scene === 'tag'
  const glow = scene === 'black' ? '' : scene

  return (
    <div className="qg-film" role="dialog" aria-label="Welcome to QuoteGen">
      <style>{`
        .qg-film {
          position: fixed;
          inset: 0;
          z-index: 400;
          background: #000;
          color: #f5f5f7;
          font-family: "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif;
          overflow: hidden;
        }
        .qg-film-glow {
          position: absolute;
          left: 50%;
          top: 46%;
          width: min(720px, 88vw);
          height: min(720px, 88vw);
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,.16) 0%, rgba(90,150,255,.08) 36%, transparent 68%);
          opacity: 0;
          transform: translate(-50%, -50%) scale(.45);
          transition: opacity 1.8s ease, transform 2.4s cubic-bezier(.22,1,.36,1);
          pointer-events: none;
        }
        .qg-film-glow.hello,
        .qg-film-glow.welcome,
        .qg-film-glow.to {
          opacity: .45;
          transform: translate(-50%, -50%) scale(.72);
        }
        .qg-film-glow.brand,
        .qg-film-glow.tag {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1.25);
        }
        .qg-film-frame {
          position: absolute;
          inset: 0;
        }
        .qg-film-beat {
          position: absolute;
          inset: 0;
          display: grid;
          place-items: center;
          margin: 0;
          opacity: 0;
          transition: opacity .35s ease;
          pointer-events: none;
        }
        .qg-film-beat.show { opacity: 1; }
        .qg-film-gen { color: #1A73E8; }
        .qg-film-hello {
          font-weight: 300;
          font-size: clamp(56px, 8vw, 92px);
          letter-spacing: -0.035em;
          line-height: 1;
        }
        .qg-film-welcome {
          font-weight: 300;
          font-size: clamp(44px, 6.4vw, 76px);
          letter-spacing: -0.03em;
          line-height: 1;
        }
        .qg-film-to {
          font-weight: 300;
          font-size: clamp(44px, 6.4vw, 76px);
          letter-spacing: -0.03em;
          line-height: 1;
          color: rgba(245,245,247,.78);
        }
        .qg-film-brand { text-align: center; }
        .qg-film-logo { margin: 0 auto 18px; }
        .qg-film-brand h1 {
          margin: 0;
          font-weight: 600;
          font-size: clamp(64px, 11vw, 124px);
          letter-spacing: -0.045em;
          line-height: .95;
        }
        .qg-film-sub {
          margin-top: 22px;
          opacity: 0;
          transition: opacity .45s ease;
        }
        .qg-film-sub.show { opacity: 1; }
        .qg-film-rule {
          display: block;
          width: 56px;
          height: 1px;
          margin: 0 auto 16px;
          background: rgba(245,245,247,.7);
          transform: scaleX(0);
          transform-origin: center;
          transition: transform 1s cubic-bezier(.22,1,.36,1);
        }
        .qg-film-sub.show .qg-film-rule { transform: scaleX(1); }
        .qg-film-sub p {
          margin: 0;
          font-weight: 400;
          font-size: clamp(16px, 2vw, 22px);
          letter-spacing: 0.01em;
          color: rgba(245,245,247,.68);
        }
        @media (prefers-reduced-motion: reduce) {
          .qg-film-beat, .qg-film-sub, .qg-film-glow, .qg-film-rule { transition: none; }
        }
      `}</style>
      <div className={`qg-film-glow ${glow}`} aria-hidden="true" />
      <div className="qg-film-frame">
        <p className={`qg-film-beat qg-film-welcome${visible && scene === 'welcome' ? ' show' : ''}`}>Welcome</p>
        <p className={`qg-film-beat qg-film-to${visible && scene === 'to' ? ' show' : ''}`}>To</p>
        <div className={`qg-film-beat qg-film-brand${visible && brandOn ? ' show' : ''}`}>
          <div>
            <BrandMark className="qg-film-logo" size={76} alt="" />
            <h1>Quote<span className="qg-film-gen">Gen</span></h1>
            <div className={`qg-film-sub${scene === 'tag' ? ' show' : ''}`}>
              <span className="qg-film-rule" aria-hidden="true" />
              <p>The future of AI quotation making</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
