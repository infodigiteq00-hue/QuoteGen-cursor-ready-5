import React, { useEffect, useRef, useState } from 'react'
import logoUrl from './assets/landing/quotegen-logo.png'
import googleIconUrl from './assets/landing/google-g.jpeg'
import './marketingLanding.css'

const SAMPLES = [
  { label: 'Client email', text: "Hi, we're after a price to supply and fit new oak flooring in the front room (about 24 m2) plus acoustic underlay. Old carpet needs taking away. Can you start w/c 14th?" },
  { label: 'WhatsApp thread', text: 'Client: can you do the two bathrooms as well?\nMe: same spec as the kitchen?\nClient: yes but chrome not brass, and add the towel rails' },
  { label: 'Spec sheet notes', text: 'Job: retail fit-out, 3 units. 42 linear m shopfitting, 6 display plinths, LED track x 18, install over 2 nights.' }
]

const FAQS = [
  { q: 'Does it use my own prices?', a: 'Yes. Upload your rate card or price list once and every generated line item is matched against it. QuoteGen never invents a price you haven\'t set.' },
  { q: 'What can I feed it?', a: 'Email threads with attachments, WhatsApp text, PDFs, Excel or CSV, photos of handwritten notes, and voice notes. You can also start a quote from scratch and let QuoteGen fill the rest.' },
  { q: 'Can I edit before sending?', a: 'Every quote opens in an editor first. Adjust quantities, swap a rate, add a note, then send as a branded PDF or a link that tracks opens.' },
  { q: 'Does it connect to my accounting?', a: 'Accepted quotes push to Xero or QuickBooks as a draft invoice, and deposits can be collected through Stripe.' },
  { q: 'What does it cost?', a: "Your first 2 quotes are free, no card needed. After that you pick a plan — you'll see the pricing before you're asked for anything." }
]

const NAV_MAIN = [
  { id: 'home', label: 'Home', title: 'Home', sub: 'Everything starts here' },
  { id: 'recent', label: 'Recent quotations', title: 'Recent quotations', sub: 'Every quotation in your workspace', badge: true },
  { id: 'insights', label: 'Insights', title: 'Insights', sub: 'How your quoting is going' },
  { id: 'knowledge', label: 'Knowledge', title: 'Knowledge', sub: 'Your uploaded rate lists and catalogues' }
]

const NAV_SETUP = [
  { id: 'company', label: 'Company', title: 'Company', sub: 'Set up once, used on every quotation' },
  { id: 'account', label: 'Account', title: 'Account', sub: 'Your own details' },
  { id: 'billing', label: 'Billing', title: 'Billing', sub: 'Plan, usage and invoices' }
]

const HOME_STATS = [
  { k: 'Drafts to finish', v: '29', note: 'Not yet converted' },
  { k: 'Completed', v: '12', note: 'Converted to invoice' },
  { k: 'This month', v: '41', note: 'Quotations touched' },
  { k: 'Total quoted', v: '₹7,92,19,202', note: 'Across 29 quotations' }
]

const DRAFTS = [
  { date: '13/08/2026', client: 'Western Petrochem Industries Ltd.', title: 'Expansion of chemical processing line — Phase II', value: '₹1,95,04,456', items: '20 items' },
  { date: '14/08/2026', client: 'Plant & Manufacturing Division', title: 'Process equipment supply', value: '₹84,32,000', items: '7 items' },
  { date: '14/08/2026', client: 'Bharat Fabricators LLP', title: 'Structural steel fabrication', value: '₹60,300', items: '6 items' }
]

const CLIENTS = [
  { initial: 'W', name: 'Western Petrochem Industries Ltd.', count: '4 quotations', value: '₹7,05,14,166', date: '14/08/2026' },
  { initial: 'P', name: 'Plant & Manufacturing Division', count: '1 quotation', value: '₹84,32,000', date: '14/08/2026' },
  { initial: 'B', name: 'Bharat Fabricators LLP', count: '1 quotation', value: '₹60,300', date: '12/08/2026' },
  { initial: 'X', name: 'XYZ Company', count: '3 quotations', value: '₹10,920', date: '12/08/2026' }
]

const INSIGHT_STATS = [
  { k: 'Total quoted', v: '₹7,92,19,202', note: 'Across 29 quotations' },
  { k: 'Completed value', v: '₹1,04,60,000', note: '12 quotations' },
  { k: 'Average quotation', v: '₹27,31,696', note: 'Per enquiry' },
  { k: 'Drafts pending', v: '29', note: 'Finish these first' }
]

const TOP_CLIENTS = [
  { rank: 1, name: 'Western Petrochem Industries Ltd.', value: '₹7,05,14,166', pct: 100 },
  { rank: 2, name: 'Plant & Manufacturing Division', value: '₹84,32,000', pct: 22 },
  { rank: 3, name: 'Bharat Fabricators LLP', value: '₹60,300', pct: 8 },
  { rank: 4, name: 'XYZ Company', value: '₹10,920', pct: 5 }
]

const DOCS = [
  { name: 'Rate card 2026.xlsx', meta: 'Indexed · 412 line items' },
  { name: 'Pump catalogue — Grundfos.pdf', meta: 'Indexed · 88 pages' },
  { name: 'Old quotation — Petrochem.pdf', meta: 'Indexed · 20 line items' }
]

const FEATURES = [
  { num: '01', tag: 'UPLOAD ONCE', title: 'Knowledge base', text: 'Upload past quotations, bills or catalogues. QuoteGen learns your pricing from them.', col: 1 },
  { num: '02', tag: 'YOUR SPEC', title: 'AI that follows your rules', text: 'The AI drafts to your requirements. Fully editable, with your own templates.', col: 2 },
  { num: '03', tag: 'ONE CLICK', title: 'Quotation to invoice', text: 'Turn any quotation into an invoice in one click. No re-entry.', col: 1 }
]

function navBtnStyle(active) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    textAlign: 'left',
    border: 0,
    cursor: 'pointer',
    borderRadius: '10px',
    padding: '11px 12px',
    fontSize: '14px',
    fontWeight: active ? 700 : 600,
    color: active ? '#2447F0' : '#3B4657',
    background: active ? '#EAF0FE' : 'transparent'
  }
}

function EmailSignup({ email, onEmailChange, onSignUp, signedUp, dark = false }) {
  const labelColor = dark ? '#fff' : '#0D1117'
  const inputBorder = dark ? '#344054' : '#C7D0E0'
  const dividerColor = dark ? '#6C7788' : '#9AA4B5'
  const dividerLine = dark ? '#232C3B' : '#E1E7F2'
  const googleBtnStyle = dark
    ? { background: '#fff', border: 0, color: '#0D1117' }
    : { background: 'transparent', border: '1px solid #D8DFEC', color: '#0D1117' }

  return (
    <div>
      <label style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: labelColor }}>Email</label>
      <input
        type="email"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        placeholder="you@email.com"
        style={{
          width: '100%',
          marginTop: '6px',
          border: 0,
          borderBottom: `1.5px solid ${inputBorder}`,
          padding: '9px 2px',
          fontSize: '14.5px',
          color: dark ? '#fff' : '#0D1117',
          outline: 'none',
          background: 'transparent'
        }}
      />
      <button
        type="button"
        onClick={onSignUp}
        className="qg-btn-primary"
        style={{
          width: '100%',
          marginTop: '14px',
          borderRadius: '999px',
          padding: dark ? '12px 18px' : '11px 18px',
          fontSize: dark ? '15px' : '14.5px',
          fontWeight: 700
        }}
      >
        {signedUp ? 'Continue to sign up' : 'Start free trial now'}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '14px 0', color: dividerColor, fontSize: '12px' }}>
        <span style={{ flex: 1, height: '1px', background: dividerLine }} />
        or
        <span style={{ flex: 1, height: '1px', background: dividerLine }} />
      </div>
      <button
        type="button"
        onClick={onSignUp}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '9px',
          borderRadius: '999px',
          padding: '10px 18px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: 'pointer',
          ...googleBtnStyle
        }}
      >
        <img src={googleIconUrl} alt="" style={{ width: '20px', height: '20px', flex: 'none', objectFit: 'contain' }} />
        Continue with Google
      </button>
    </div>
  )
}

function AppPreview({ tab, setTab, onSignUp }) {
  const meta = NAV_MAIN.concat(NAV_SETUP).find((n) => n.id === tab) || NAV_MAIN[0]

  return (
    <div className="qg-appframe" style={{
      marginTop: '44px',
      padding: '14px',
      borderRadius: '26px',
      background: 'linear-gradient(115deg,#2447F0,#0B2A6B 26%,#00A3B6 50%,#2447F0 76%,#0B2A6B)',
      backgroundSize: '200% 200%',
      animation: 'qgSheen 9s linear infinite'
    }}>
      <div className="qg-app" style={{
        borderRadius: '16px',
        overflow: 'hidden',
        background: '#F4F6FA',
        display: 'grid',
        gridTemplateColumns: '250px 1fr',
        minHeight: '620px'
      }}>
        <aside className="qg-appnav" style={{
          background: '#fff',
          borderRight: '1px solid #E8EBF2',
          padding: '20px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 6px' }}>
            <img src={logoUrl} alt="" style={{ width: '30px', height: '30px', objectFit: 'contain' }} />
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontFamily: 'Archivo', fontWeight: 800, fontSize: '16px', letterSpacing: '-.02em' }}>
                Quote<span style={{ color: '#0B2A6B' }}>Gen</span>
              </div>
              <div style={{ fontSize: '11.5px', color: '#7A8598' }}>Your AI quotation employee</div>
            </div>
          </div>
          <button type="button" className="qg-btn-primary" onClick={() => setTab('home')} style={{
            width: '100%',
            borderRadius: '12px',
            padding: '13px 16px',
            fontSize: '14.5px',
            fontWeight: 700,
            boxShadow: '0 10px 20px -12px rgba(36,71,240,.9)',
            whiteSpace: 'nowrap'
          }}>
            +  Make a new quote
          </button>
          <div className="qg-navgroup" style={{ display: 'grid', gap: '2px' }}>
            {NAV_MAIN.map((n) => (
              <button key={n.id} type="button" onClick={() => setTab(n.id)} style={navBtnStyle(tab === n.id)}>
                <span>{n.label}</span>
                {n.badge && tab !== n.id && (
                  <span style={{ marginLeft: 'auto', background: '#EAF0FE', color: '#2447F0', fontSize: '11.5px', fontWeight: 700, borderRadius: '999px', padding: '2px 8px' }}>29</span>
                )}
              </button>
            ))}
          </div>
          <div className="qg-navlabel" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.09em', color: '#9AA4B5', padding: '8px 10px 0' }}>SET UP ONCE</div>
          <div className="qg-navgroup" style={{ display: 'grid', gap: '2px' }}>
            {NAV_SETUP.map((n) => (
              <button key={n.id} type="button" onClick={() => setTab(n.id)} style={navBtnStyle(tab === n.id)}>
                <span>{n.label}</span>
              </button>
            ))}
          </div>
          <div className="qg-navuser" style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '10px', borderTop: '1px solid #EEF1F7', paddingTop: '14px' }}>
            <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#EAF0FE', color: '#2447F0', fontSize: '12px', fontWeight: 700, display: 'grid', placeItems: 'center' }}>DH</span>
            <div style={{ fontSize: '12.5px', lineHeight: 1.3 }}>
              <div style={{ fontWeight: 700, color: '#0D1117' }}>Quotegen@…</div>
              <div style={{ color: '#7A8598' }}>Account and sign out</div>
            </div>
          </div>
        </aside>

        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ background: '#fff', borderBottom: '1px solid #E8EBF2', padding: '16px 26px' }}>
            <div style={{ fontFamily: 'Archivo', fontWeight: 700, fontSize: '19px', letterSpacing: '-.02em' }}>{meta.title}</div>
            <div style={{ fontSize: '13px', color: '#7A8598', marginTop: '2px' }}>{meta.sub}</div>
          </div>
          <div style={{ padding: '22px 26px 26px', display: 'grid', gap: '18px', alignContent: 'start' }}>
            {tab === 'home' && (
              <div style={{ display: 'grid', gap: '18px' }}>
                <div style={{ background: '#fff', border: '1px solid #E8EBF2', borderRadius: '14px', padding: '26px' }}>
                  <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#7A8598' }}>Good morning, Dharmik</div>
                  <h4 style={{ margin: '8px 0 0', fontFamily: 'Archivo', fontWeight: 800, fontSize: 'clamp(1.3rem,2.2vw,1.75rem)', letterSpacing: '-.03em' }}>Paste the enquiry. Check the rates. Send the quotation.</h4>
                  <p style={{ margin: '10px 0 0', fontSize: '14.5px', lineHeight: 1.6, color: '#4A5566', maxWidth: '62ch' }}>Email, WhatsApp message, phone notes, a PDF or a catalogue. Put it in the box and QuoteGen prepares the draft. You review every line before anything goes out.</p>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '18px' }}>
                    <button type="button" className="qg-btn-primary" onClick={() => setTab('home')} style={{ borderRadius: '11px', padding: '12px 20px', fontSize: '14.5px', fontWeight: 700, whiteSpace: 'nowrap' }}>+  Make a new quote</button>
                    <button type="button" className="qg-btn-ghost" onClick={() => setTab('recent')} style={{ borderRadius: '11px', padding: '12px 20px', fontSize: '14.5px', fontWeight: 600, whiteSpace: 'nowrap' }}>Open Recent quotations</button>
                  </div>
                </div>
                <div className="qg-stats" style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(4,1fr)' }}>
                  {HOME_STATS.map((s) => (
                    <div key={s.k} style={{ background: '#fff', border: '1px solid #E8EBF2', borderRadius: '14px', padding: '18px' }}>
                      <div style={{ fontSize: '13px', color: '#7A8598' }}>{s.k}</div>
                      <div style={{ fontFamily: 'Archivo', fontWeight: 800, fontSize: '1.55rem', letterSpacing: '-.03em', marginTop: '6px' }}>{s.v}</div>
                      <div style={{ fontSize: '12px', color: '#9AA4B5', marginTop: '6px' }}>{s.note}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <h5 style={{ margin: 0, fontFamily: 'Archivo', fontWeight: 700, fontSize: '1.15rem', letterSpacing: '-.02em', whiteSpace: 'nowrap' }}>Carry on where you left off</h5>
                  <button type="button" onClick={() => setTab('recent')} style={{ background: 'none', border: 0, color: '#2447F0', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none' }}>See all</button>
                </div>
                <div className="qg-stats" style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(3,1fr)' }}>
                  {DRAFTS.map((d) => (
                    <div key={d.client + d.date} data-lift="" style={{ background: '#fff', border: '1px solid #E8EBF2', borderRadius: '14px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                        <span style={{ background: '#F0F2F7', color: '#68738A', fontSize: '10.5px', fontWeight: 800, letterSpacing: '.07em', borderRadius: '6px', padding: '4px 8px' }}>DRAFT</span>
                        <span style={{ fontSize: '12px', color: '#9AA4B5' }}>{d.date}</span>
                      </div>
                      <div style={{ fontFamily: 'Archivo', fontWeight: 700, fontSize: '15px', letterSpacing: '-.015em' }}>{d.client}</div>
                      <div style={{ fontSize: '13px', color: '#68738A', lineHeight: 1.45 }}>{d.title}</div>
                      <div style={{ borderTop: '1px solid #EEF1F7', paddingTop: '10px', display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'Archivo', fontWeight: 800, fontSize: '1.05rem' }}>{d.value}</span>
                        <span style={{ fontSize: '12px', color: '#9AA4B5', whiteSpace: 'nowrap', flex: 'none' }}>{d.items}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button type="button" className="qg-btn-primary" onClick={onSignUp} style={{ flex: 1, borderRadius: '9px', padding: '9px 12px', fontSize: '13px', fontWeight: 700 }}>Open</button>
                        <button type="button" className="qg-btn-ghost" onClick={onSignUp} style={{ flex: 1, borderRadius: '9px', padding: '9px 12px', fontSize: '13px', fontWeight: 600 }}>Use as base</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'recent' && (
              <div style={{ display: 'grid', gap: '14px' }}>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '200px', background: '#fff', border: '1px solid #E2E7F1', borderRadius: '11px', padding: '11px 16px', fontSize: '14px', color: '#9AA4B5' }}>Search by company or heading</div>
                  <button type="button" className="qg-btn-primary" style={{ borderRadius: '11px', padding: '11px 20px', fontSize: '13.5px', fontWeight: 700 }}>All</button>
                  <button type="button" className="qg-btn-ghost" style={{ borderRadius: '11px', padding: '11px 20px', fontSize: '13.5px', fontWeight: 600 }}>Drafts</button>
                  <button type="button" className="qg-btn-ghost" style={{ borderRadius: '11px', padding: '11px 20px', fontSize: '13.5px', fontWeight: 600 }}>Completed</button>
                </div>
                {CLIENTS.map((c) => (
                  <div key={c.name} data-lift="" style={{ background: '#fff', border: '1px solid #E8EBF2', borderRadius: '14px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <span style={{ width: '36px', height: '36px', flex: 'none', borderRadius: '10px', background: '#EAF0FE', color: '#2447F0', fontWeight: 800, display: 'grid', placeItems: 'center' }}>{c.initial}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'Archivo', fontWeight: 700, fontSize: '15px', letterSpacing: '-.015em' }}>{c.name}</div>
                      <div style={{ fontSize: '12.5px', color: '#7A8598', marginTop: '2px' }}>{c.count}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      <div style={{ fontFamily: 'Archivo', fontWeight: 800, fontSize: '15px' }}>{c.value}</div>
                      <div style={{ fontSize: '12px', color: '#9AA4B5', marginTop: '2px' }}>{c.date}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'insights' && (
              <div style={{ display: 'grid', gap: '18px' }}>
                <div className="qg-stats" style={{ display: 'grid', gap: '14px', gridTemplateColumns: 'repeat(4,1fr)' }}>
                  {INSIGHT_STATS.map((s) => (
                    <div key={s.k} style={{ background: '#fff', border: '1px solid #E8EBF2', borderRadius: '14px', padding: '18px' }}>
                      <div style={{ fontSize: '13px', color: '#7A8598' }}>{s.k}</div>
                      <div style={{ fontFamily: 'Archivo', fontWeight: 800, fontSize: '1.4rem', letterSpacing: '-.03em', marginTop: '6px' }}>{s.v}</div>
                      <div style={{ fontSize: '12px', color: '#9AA4B5', marginTop: '6px' }}>{s.note}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: '#fff', border: '1px solid #E8EBF2', borderRadius: '14px', padding: '22px' }}>
                  <div style={{ fontFamily: 'Archivo', fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-.02em' }}>Top clients by value quoted</div>
                  <div style={{ fontSize: '13px', color: '#7A8598', marginTop: '4px' }}>Based on the quotations in your workspace.</div>
                  <div style={{ display: 'grid', gap: '16px', marginTop: '18px' }}>
                    {TOP_CLIENTS.map((t) => (
                      <div key={t.rank} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        <span style={{ width: '26px', height: '26px', flex: 'none', borderRadius: '8px', background: '#EAF0FE', color: '#2447F0', fontSize: '12px', fontWeight: 800, display: 'grid', placeItems: 'center' }}>{t.rank}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '14px' }}>
                            <span style={{ fontWeight: 600 }}>{t.name}</span>
                            <span style={{ fontFamily: 'Archivo', fontWeight: 800 }}>{t.value}</span>
                          </div>
                          <div style={{ height: '8px', borderRadius: '999px', background: '#EDF1F8', marginTop: '8px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: '999px', background: '#2447F0', width: `${t.pct}%`, transition: 'width .8s cubic-bezier(.2,.7,.2,1)' }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'knowledge' && (
              <div style={{ background: '#fff', border: '1px solid #E8EBF2', borderRadius: '14px', padding: '24px' }}>
                <div style={{ fontFamily: 'Archivo', fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-.02em' }}>Knowledge base</div>
                <div style={{ fontSize: '13.5px', color: '#7A8598', marginTop: '4px' }}>Upload catalogues, bills, or old quotations. QuoteGen extracts the text and autofills matching line items.</div>
                <div style={{ marginTop: '18px', border: '1px dashed #D3DBEA', background: '#FAFBFE', borderRadius: '12px', padding: '18px', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '14.5px' }}>Upload files</div>
                    <div style={{ fontSize: '12.5px', color: '#7A8598', marginTop: '3px' }}>PDF, Word, Excel, CSV, plain text or images (OCR) · max 20 MB each</div>
                  </div>
                  <button type="button" className="qg-btn-primary" onClick={onSignUp} style={{ marginLeft: 'auto', borderRadius: '10px', padding: '10px 18px', fontSize: '13.5px', fontWeight: 700 }}>Upload files</button>
                </div>
                <div style={{ marginTop: '18px', fontWeight: 700, fontSize: '14px' }}>Stored documents</div>
                <div style={{ display: 'grid', gap: '8px', marginTop: '10px' }}>
                  {DOCS.map((d) => (
                    <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '14px', border: '1px solid #EEF1F7', borderRadius: '10px', padding: '12px 14px', fontSize: '13.5px' }}>
                      <span style={{ fontWeight: 600 }}>{d.name}</span>
                      <span style={{ color: '#9AA4B5' }}>{d.meta}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(tab === 'company' || tab === 'billing') && (
              <div style={{ background: '#fff', border: '1px solid #E8EBF2', borderRadius: '14px', padding: '30px', maxWidth: '640px' }}>
                <div style={{ fontFamily: 'Archivo', fontWeight: 700, fontSize: '1.25rem', letterSpacing: '-.02em' }}>
                  {tab === 'company' ? 'We set this up with you' : 'Plans and invoices live here'}
                </div>
                <p style={{ margin: '12px 0 0', fontSize: '15px', lineHeight: 1.6, color: '#4A5566' }}>
                  {tab === 'company'
                    ? 'Company details, logo, tax numbers, terms and your rate card — we walk you through all of it once you sign up, and it only ever needs doing once. Every quotation after that comes out branded and priced correctly.'
                    : "You'll see your plan, usage and every invoice here once you sign up. Your first 2 quotations are free, so there is nothing to pay before you've tried it."}
                </p>
                <button type="button" onClick={onSignUp} className="qg-btn-primary" style={{ display: 'inline-block', marginTop: '20px', fontSize: '14.5px', fontWeight: 700, padding: '12px 22px', borderRadius: '11px' }}>Start free trial</button>
              </div>
            )}

            {tab === 'account' && (
              <div style={{ background: '#fff', border: '1px solid #E8EBF2', borderRadius: '14px', padding: '24px', display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap', maxWidth: '640px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '15px' }}>Signed in as</div>
                  <div style={{ fontSize: '14px', color: '#7A8598', marginTop: '4px' }}>you@yourcompany.com</div>
                </div>
                <span style={{ marginLeft: 'auto', border: '1px solid #F0D3D3', color: '#C0392B', borderRadius: '10px', padding: '10px 18px', fontSize: '13.5px', fontWeight: 700 }}>Sign out</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function useRevealAnimation(rootRef) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const els = [...root.querySelectorAll('[data-reveal]')]
    if (!els.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    const show = (el) => {
      el.style.opacity = ''
      el.style.transform = ''
      el.style.transition = ''
    }

    els.forEach((el) => {
      el.style.opacity = '0'
      el.style.transform = 'translateY(20px)'
      el.style.transition = 'opacity .7s ease, transform .7s cubic-bezier(.2,.7,.2,1)'
    })

    const reveal = (el) => {
      el.style.opacity = '1'
      el.style.transform = 'none'
      setTimeout(() => show(el), 900)
    }

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          reveal(e.target)
          io.unobserve(e.target)
        }
      })
    }, { rootMargin: '0px 0px -8% 0px' })

    els.forEach((el) => io.observe(el))

    const poll = setInterval(() => {
      const vh = window.innerHeight || 800
      els.forEach((el) => {
        if (el.style.opacity === '0' && el.getBoundingClientRect().top < vh * 0.95) reveal(el)
      })
    }, 250)

    const safety = setTimeout(() => {
      clearInterval(poll)
      els.forEach(show)
      io.disconnect()
    }, 15000)

    return () => {
      clearInterval(poll)
      clearTimeout(safety)
      io.disconnect()
    }
  }, [rootRef])
}

export default function MarketingLanding({ onSignIn, onSignUp }) {
  const rootRef = useRef(null)
  const [email, setEmail] = useState('')
  const [draft, setDraft] = useState('')
  const [generating, setGenerating] = useState(false)
  const [openFaq, setOpenFaq] = useState(-1)
  const [previewTab, setPreviewTab] = useState('home')
  const generateTimerRef = useRef(null)

  useRevealAnimation(rootRef)

  useEffect(() => () => {
    if (generateTimerRef.current) clearTimeout(generateTimerRef.current)
  }, [])

  const handleSignUp = () => onSignUp(email.trim())

  const handleGenerate = () => {
    if (!draft.trim() || generating) return
    setGenerating(true)
    generateTimerRef.current = setTimeout(() => setGenerating(false), 1400)
  }

  const handleKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleGenerate()
  }

  return (
    <div ref={rootRef} className="qg-marketing">
      <header style={{ position: 'sticky', top: 0, zIndex: 40, height: '68px', display: 'flex', alignItems: 'center', padding: '0 28px', background: 'rgba(255,255,255,.82)', backdropFilter: 'blur(14px) saturate(180%)', borderBottom: '1px solid #E8EBF2' }}>
        <div className="qg-shell" style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontFamily: 'Archivo', fontWeight: 800, fontSize: '19px', letterSpacing: '-.02em' }}>
            <img src={logoUrl} alt="QuoteGen" style={{ width: '30px', height: '30px', objectFit: 'contain' }} />
            <span>Quote<span style={{ color: '#0B2A6B' }}>Gen</span></span>
          </div>
          <nav style={{ display: 'flex', gap: '26px', fontSize: '14.5px', fontWeight: 600, color: '#3B4657', whiteSpace: 'nowrap' }}>
            <a href="#how" style={{ color: '#3B4657' }}>How it works</a>
            <a href="#features" style={{ color: '#3B4657' }}>Features</a>
            <a href="#faq" style={{ color: '#3B4657' }}>FAQ</a>
          </nav>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '14px', whiteSpace: 'nowrap' }}>
            <button type="button" onClick={onSignIn} style={{ background: 'none', border: 0, fontSize: '14.5px', fontWeight: 600, color: '#3B4657', cursor: 'pointer', padding: 0 }}>Sign in</button>
            <a href="#hero" className="qg-btn-primary" style={{ fontSize: '14.5px', fontWeight: 700, padding: '10px 18px', borderRadius: '9px' }}>Start free trial</a>
          </div>
        </div>
      </header>

      <section id="hero" style={{ position: 'relative', overflow: 'hidden', padding: '88px 28px 96px', background: 'linear-gradient(180deg,#F7F9FF 0%,#EEF3FF 46%,#ffffff 100%)' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(#DCE4F7 1px,transparent 1px),linear-gradient(90deg,#DCE4F7 1px,transparent 1px)', backgroundSize: '64px 64px', opacity: 0.5, maskImage: 'radial-gradient(120% 80% at 50% 0%,#000 20%,transparent 75%)' }} />
        <div className="qg-hero qg-shell" style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: '56px', alignItems: 'start' }}>
          <div style={{ width: '100%', minWidth: 0 }}>
            <div className="qg-head" style={{ display: 'flex', alignItems: 'flex-start', gap: '48px' }}>
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <h1 style={{ margin: 0, fontFamily: 'Archivo', fontWeight: 800, fontSize: 'clamp(2.6rem,5.6vw,4.4rem)', lineHeight: 1.04, letterSpacing: '-.035em', maxWidth: '19ch' }}>What are we<br />quoting today?</h1>
                <p style={{ margin: '20px 0 0', fontSize: '18.5px', lineHeight: 1.6, color: '#4A5566', maxWidth: '56ch', textWrap: 'pretty' }}>Any enquiry, any format — text, an image, a PDF, a spreadsheet. QuoteGen turns it into a priced quote.</p>
              </div>
              <div className="qg-signup" style={{ flex: '0 0 300px', minWidth: 0, paddingTop: '10px' }}>
                <EmailSignup email={email} onEmailChange={setEmail} onSignUp={handleSignUp} signedUp={false} />
              </div>
            </div>

            <div style={{ marginTop: '34px', background: '#fff', border: '1px solid #DFE5F0', borderRadius: '22px', boxShadow: '0 24px 60px -30px rgba(20,35,80,.34),0 2px 6px rgba(20,35,80,.05)', overflow: 'hidden' }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste an enquiry, describe what you need, or drop a PDF / Excel / image..."
                style={{ width: '100%', minHeight: '190px', resize: 'vertical', border: 0, outline: 'none', padding: '26px 26px 18px', fontSize: '16.5px', lineHeight: 1.6, color: '#0D1117', background: 'transparent' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '14px 18px', borderTop: '1px solid #EDF0F7', background: '#FBFCFE' }}>
                <button type="button" className="qg-btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '11px', padding: '9px 14px', fontSize: '14px', fontWeight: 600 }}>Attach files</button>
                <button type="button" className="qg-btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '11px', padding: '9px 14px', fontSize: '14px', fontWeight: 600 }}>Record voice note</button>
                <button type="button" onClick={onSignIn} className="qg-btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: '8px', borderRadius: '11px', padding: '9px 14px', fontSize: '14px', fontWeight: 600 }}>Build manually</button>
                <button type="button" onClick={handleGenerate} className="qg-btn-primary" style={{ marginLeft: 'auto', borderRadius: '12px', padding: '12px 26px', fontSize: '15px', fontWeight: 700, boxShadow: '0 8px 20px -8px rgba(36,71,240,.7)' }}>
                  {generating ? 'Reading…' : 'Generate quote'}
                </button>
              </div>
            </div>
            <div style={{ marginTop: '12px', display: 'flex', gap: '18px', flexWrap: 'wrap', fontSize: '13.5px', color: '#68738A' }}>
              <span>Ctrl / ⌘ + Enter to generate</span>
              <span>First 2 quotes free, no card</span>
            </div>
            <div style={{ marginTop: '26px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {SAMPLES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setDraft(s.text)}
                  style={{ background: 'rgba(255,255,255,.7)', border: '1px solid #DCE3F0', borderRadius: '999px', padding: '8px 15px', fontSize: '13.5px', fontWeight: 600, color: '#3B4657', cursor: 'pointer' }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="how" style={{ background: '#fff', padding: '96px 28px 20px' }}>
        <div style={{ maxWidth: '1240px', margin: '0 auto' }}>
          <h2 data-reveal="" style={{ margin: 0, fontFamily: 'Archivo', fontWeight: 700, fontSize: 'clamp(2rem,3.4vw,2.9rem)', lineHeight: 1.08, letterSpacing: '-.03em', maxWidth: '24ch' }}>From messy enquiry to signed quote in under a minute</h2>
          <p data-reveal="" style={{ margin: '16px 0 0', fontSize: '17.5px', lineHeight: 1.6, color: '#4A5566', maxWidth: '60ch' }}>QuoteGen reads the request, matches your price book, and writes the line items. You check the numbers and send.</p>
          <AppPreview tab={previewTab} setTab={setPreviewTab} onSignUp={handleSignUp} />
        </div>
      </section>

      <section id="features" style={{ background: '#0D1117', padding: '104px 28px' }}>
        <div style={{ maxWidth: '1240px', margin: '0 auto' }}>
          <span data-reveal="" style={{ display: 'inline-block', fontFamily: 'ui-monospace,monospace', fontSize: '12px', letterSpacing: '.16em', color: '#7A8598' }}>WHAT YOU GET</span>
          <h2 data-reveal="" style={{ margin: '14px 0 0', fontFamily: 'Archivo', fontWeight: 800, fontSize: 'clamp(2.1rem,4vw,3.1rem)', lineHeight: 1.06, letterSpacing: '-.035em', maxWidth: '26ch', color: '#fff' }}>Three things that make quoting stop hurting</h2>
          <div style={{ marginTop: '52px' }}>
            {FEATURES.map((f) => (
              <div key={f.num} data-reveal="" className="qg-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '64px', padding: '44px 0', borderTop: '1px solid #1E2735' }}>
                <div style={{ gridColumn: f.col, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px' }}>
                    <span style={{ fontFamily: 'Archivo', fontWeight: 800, fontSize: '2.1rem', lineHeight: 1, letterSpacing: '-.04em', color: '#2E3A4C' }}>{f.num}</span>
                    <span style={{ fontFamily: 'ui-monospace,monospace', fontSize: '11.5px', letterSpacing: '.14em', color: '#7FE0C8' }}>{f.tag}</span>
                  </div>
                  <h3 style={{ margin: '16px 0 0', fontFamily: 'Archivo', fontWeight: 700, fontSize: 'clamp(1.5rem,2.4vw,2rem)', lineHeight: 1.14, letterSpacing: '-.025em', color: '#fff', maxWidth: '22ch' }}>{f.title}</h3>
                  <p style={{ margin: '14px 0 0', fontSize: '16.5px', lineHeight: 1.62, color: '#A9B3C4', maxWidth: '46ch' }}>{f.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ background: '#F5F7FB', padding: '90px 28px 40px' }}>
        <div data-reveal="" className="qg-inline-signup" style={{ maxWidth: '1240px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 340px', gap: '48px', alignItems: 'center', background: '#fff', border: '1px solid #E4E9F2', borderRadius: '24px', padding: '40px' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: 'Archivo', fontWeight: 700, fontSize: 'clamp(1.7rem,2.8vw,2.3rem)', lineHeight: 1.12, letterSpacing: '-.03em', maxWidth: '24ch' }}>Start free. Your first 2 quotations are on us.</h2>
            <p style={{ margin: '14px 0 0', fontSize: '16.5px', lineHeight: 1.6, color: '#4A5566', maxWidth: '52ch' }}>No card, no setup call needed to begin. Enter your email and QuoteGen is ready in minutes.</p>
          </div>
          <div style={{ minWidth: 0 }}>
            <EmailSignup email={email} onEmailChange={setEmail} onSignUp={handleSignUp} signedUp={false} />
          </div>
        </div>
      </section>

      <section id="faq" style={{ background: '#fff', padding: '96px 28px' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 data-reveal="" style={{ margin: 0, fontFamily: 'Archivo', fontWeight: 700, fontSize: 'clamp(1.9rem,3.2vw,2.6rem)', letterSpacing: '-.03em' }}>Questions, answered</h2>
          <div data-reveal="" style={{ marginTop: '32px', borderTop: '1px solid #E8EBF2' }}>
            {FAQS.map((f, i) => {
              const open = openFaq === i
              return (
                <div key={f.q} style={{ borderBottom: '1px solid #E8EBF2' }}>
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? -1 : i)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '20px', textAlign: 'left', background: 'none', border: 0, padding: '24px 0', cursor: 'pointer', fontFamily: 'Archivo', fontWeight: 600, fontSize: '1.15rem', letterSpacing: '-.015em', color: '#0D1117' }}
                  >
                    <span style={{ flex: 1 }}>{f.q}</span>
                    <span style={{ width: '28px', height: '28px', flex: 'none', borderRadius: '50%', background: '#F0F3FA', color: '#2447F0', display: 'grid', placeItems: 'center', fontSize: '18px', lineHeight: 1 }}>{open ? '–' : '+'}</span>
                  </button>
                  <div style={{ display: 'grid', gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0, transition: 'grid-template-rows .42s cubic-bezier(.3,.8,.3,1),opacity .32s ease' }}>
                    <div style={{ overflow: 'hidden' }}>
                      <p style={{ margin: 0, padding: '0 48px 26px 0', fontSize: '16px', lineHeight: 1.65, color: '#4A5566' }}>{f.a}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section style={{ background: '#0D1117', color: '#fff', padding: '100px 28px', textAlign: 'center' }}>
        <div data-reveal="" style={{ maxWidth: '820px', margin: '0 auto' }}>
          <h2 style={{ margin: 0, fontFamily: 'Archivo', fontWeight: 800, fontSize: 'clamp(2.2rem,4.4vw,3.5rem)', lineHeight: 1.06, letterSpacing: '-.035em' }}>
            Stop rewriting quotes.<br /><span style={{ color: '#7FE0C8' }}>Start sending them.</span>
          </h2>
          <p style={{ margin: '18px auto 0', maxWidth: '48ch', fontSize: '17.5px', lineHeight: 1.6, color: '#A9B3C4' }}>Paste your next enquiry and see the quote it produces. Your first 2 are free.</p>
          <div style={{ maxWidth: '400px', margin: '32px auto 0', textAlign: 'left' }}>
            <EmailSignup email={email} onEmailChange={setEmail} onSignUp={handleSignUp} signedUp={false} dark />
          </div>
        </div>
      </section>

      <footer style={{ background: '#fff', padding: '56px 28px', borderTop: '1px solid #E8EBF2' }}>
        <div style={{ maxWidth: '1240px', margin: '0 auto', display: 'flex', gap: '40px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontFamily: 'Archivo', fontWeight: 800, fontSize: '18px', letterSpacing: '-.02em' }}>
            <img src={logoUrl} alt="QuoteGen" style={{ width: '26px', height: '26px', objectFit: 'contain' }} />
            <span>Quote<span style={{ color: '#0B2A6B' }}>Gen</span></span>
          </div>
          <div style={{ display: 'flex', gap: '56px', flexWrap: 'wrap', fontSize: '14.5px', lineHeight: 2, color: '#4A5566' }}>
            <div>
              <strong style={{ display: 'block', color: '#0D1117', fontSize: '13px', marginBottom: '6px' }}>Product</strong>
              <a href="#how" style={{ color: '#4A5566' }}>Price books</a><br />
              <span style={{ color: '#4A5566' }}>Pricing</span>
            </div>
            <div>
              <strong style={{ display: 'block', color: '#0D1117', fontSize: '13px', marginBottom: '6px' }}>Company</strong>
              <a href="#features" style={{ color: '#4A5566' }}>Features</a><br />
              <span style={{ color: '#4A5566' }}>Careers</span><br />
              <span style={{ color: '#4A5566' }}>Contact</span>
            </div>
            <div>
              <strong style={{ display: 'block', color: '#0D1117', fontSize: '13px', marginBottom: '6px' }}>Legal</strong>
              <span style={{ color: '#4A5566' }}>Privacy</span><br />
              <span style={{ color: '#4A5566' }}>Terms</span><br />
              <span style={{ color: '#4A5566' }}>Security</span>
            </div>
          </div>
        </div>
        <p style={{ maxWidth: '1240px', margin: '40px auto 0', fontSize: '13px', color: '#7A8598' }}>© 2026 QuoteGen Ltd.</p>
      </footer>
    </div>
  )
}
