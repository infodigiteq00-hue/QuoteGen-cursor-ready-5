import React, { useEffect } from 'react'
import BrandMark from './BrandMark.jsx'
import './legalPages.css'

export const LEGAL_PAGES = {
  privacy: {
    path: '/privacy',
    aliases: ['/privacy-policy'],
    nav: 'Privacy',
    title: 'Privacy Policy'
  },
  terms: {
    path: '/terms',
    aliases: ['/terms-of-service', '/terms-and-conditions'],
    nav: 'Terms',
    title: 'Terms of Service'
  },
  refund: {
    path: '/refund',
    aliases: ['/refund-policy', '/cancellation'],
    nav: 'Refunds',
    title: 'Refund & Cancellation Policy'
  },
  contact: {
    path: '/contact',
    aliases: ['/contact-us'],
    nav: 'Contact',
    title: 'Contact us'
  }
}

const UPDATED = '28 September 2026'
const OPERATOR = 'Digiteq Solution'
const PRODUCT = 'QuoteGen'
const SITE = 'https://www.quotegen.ai'
const EMAIL = 'info@digiteqsolution.com'
const PHONE = '+91 90676 10118'
const PHONE_HREF = 'tel:+919067610118'
const ADDRESS = 'B-42 Aditya Nagar, India'

export function matchLegalPage(pathname) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/'
  return Object.entries(LEGAL_PAGES).find(([, page]) => (
    page.path === path || (page.aliases || []).includes(path)
  ))?.[0] || null
}

function LegalNav({ current }) {
  return (
    <header className="qg-legal-nav">
      <a className="qg-legal-brand" href="/">
        <BrandMark size={26} alt="" />
        <span>Quote<span>Gen</span></span>
      </a>
      <nav className="qg-legal-nav-links" aria-label="Legal">
        {Object.entries(LEGAL_PAGES).map(([id, page]) => (
          <a key={id} href={page.path} className={current === id ? 'is-on' : undefined}>
            {page.nav}
          </a>
        ))}
      </nav>
    </header>
  )
}

function PrivacyBody() {
  return (
    <>
      <p>
        {OPERATOR} (“we”, “us”) operates {PRODUCT} at {SITE}. This policy explains what we collect, why we collect it, and how you can ask us to change or delete it. It covers the website, the {PRODUCT} app, our trial, and advertising (including Meta / Facebook / Instagram ads and the Meta Pixel).
      </p>

      <h2>1. Who we are</h2>
      <p>
        {PRODUCT} is a quotation product of {OPERATOR}. Correspondence: {ADDRESS}. Email: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>. Phone: <a href={PHONE_HREF}>{PHONE}</a>.
      </p>

      <h2>2. Information we collect</h2>
      <ul>
        <li><strong>Account &amp; trial details:</strong> name, work email, mobile number, company name, and login credentials (passwords are stored hashed by our auth provider).</li>
        <li><strong>Advertising &amp; landing-page leads:</strong> when you submit the form on our ads landing page we store name, phone, email and company so we can start your trial and contact you.</li>
        <li><strong>Workspace data you upload:</strong> quotations, rate lists, catalogues, logos, and related files you choose to put in {PRODUCT}.</li>
        <li><strong>Payments:</strong> if you buy a plan, payment is processed by PhonePe. We receive confirmation, amount and a transaction reference — not your full card or UPI PIN.</li>
        <li><strong>Usage:</strong> pages viewed, device/browser type, approximate location from IP, and diagnostic logs so we can run and secure the service.</li>
        <li><strong>Advertising cookies / Meta Pixel:</strong> on public pages we may load the Meta Pixel. Meta may collect device identifiers, page views, and events such as viewing a landing page or starting a trial, and may match them to a Meta account. See Meta’s policy at{' '}
          <a href="https://www.facebook.com/privacy/policy/" rel="noreferrer" target="_blank">facebook.com/privacy/policy</a>.
        </li>
      </ul>

      <h2>3. How we use it</h2>
      <ul>
        <li>Create and run your {PRODUCT} account and quotations.</li>
        <li>Send one-time passwords, receipts, and service messages.</li>
        <li>Respond to enquiries from ads or the website.</li>
        <li>Process payments and prevent fraud.</li>
        <li>Measure and improve ads (including Meta ads) and our product.</li>
        <li>Meet legal and tax obligations in India.</li>
      </ul>
      <p>We do not sell your personal information.</p>

      <h2>4. Legal bases (where they apply)</h2>
      <p>
        We process data to perform a contract with you, with your consent (forms, cookies/ads where required), for our legitimate interests in running and marketing a lawful business, and where the law requires it.
      </p>

      <h2>5. Sharing</h2>
      <p>We share data only with:</p>
      <ul>
        <li>Infrastructure and auth providers that host {PRODUCT} (for example cloud database and email delivery).</li>
        <li>PhonePe, to take payment you start.</li>
        <li>Meta Platforms, when the Pixel or an ads campaign is active, as described above.</li>
        <li>Authorities if Indian law requires it.</li>
      </ul>

      <h2>6. Retention</h2>
      <p>
        Lead and account data is kept while you have an account or an open trial, and for a reasonable period after (typically up to 24 months) unless you ask us to delete it sooner or the law requires a longer hold (for example invoices).
      </p>

      <h2>7. Your choices</h2>
      <ul>
        <li>Email <a href={`mailto:${EMAIL}`}>{EMAIL}</a> to access, correct, or delete your personal data, or to close your account.</li>
        <li>You can opt out of marketing emails using the unsubscribe link or by writing to us.</li>
        <li>Browser settings can block cookies; some site features may then be limited. You can also use Meta’s ad settings to limit ads.</li>
      </ul>

      <h2>8. Children</h2>
      <p>{PRODUCT} is for businesses. We do not knowingly collect data from children under 18.</p>

      <h2>9. Security &amp; international transfers</h2>
      <p>
        We use HTTPS and access controls. Hosting may process data outside India under the provider’s terms. No method of transmission is 100% secure.
      </p>

      <h2>10. Changes</h2>
      <p>We may update this policy. The date at the top of this page is the latest version. Material changes will be posted here.</p>
    </>
  )
}

function TermsBody() {
  return (
    <>
      <p>
        These terms govern use of {PRODUCT} ({SITE}), operated by {OPERATOR}. By creating an account, starting a trial, or using the site, you agree to them. If you do not agree, do not use {PRODUCT}.
      </p>

      <h2>1. The service</h2>
      <p>
        {PRODUCT} helps businesses draft, edit and export quotations. Output is a draft for you to check. You are responsible for prices, taxes, quantities, legal wording and anything you send to a customer.
      </p>

      <h2>2. Eligibility</h2>
      <p>You must be 18 or older and able to form a contract under Indian law. You must provide accurate account details.</p>

      <h2>3. Accounts</h2>
      <p>
        Keep your login details secret. You are responsible for activity on your account. We may suspend an account that we reasonably believe is abusive, unlawful, or a risk to other users.
      </p>

      <h2>4. Free trial</h2>
      <p>
        New users may try {PRODUCT} without a card, as described on the landing page (including a limited number of quotations). Trial features can change. We may end a trial that we reasonably believe is being abused.
      </p>

      <h2>5. Paid plans</h2>
      <p>
        Paid plans (for example a monthly allowance of quotations, currently advertised around ₹499–₹799 depending on the offer) are billed through PhonePe. Prices include applicable taxes unless we say otherwise. Unused quotations in a billing period do not roll over unless we say they do. Extra quotations may be charged as described in the product.
      </p>

      <h2>6. Acceptable use</h2>
      <p>Do not use {PRODUCT} to break the law, send spam, probe our systems, or upload content you do not have the right to use. Do not reverse-engineer the service except as Indian law allows.</p>

      <h2>7. Your content</h2>
      <p>
        You keep ownership of logos, rate cards and quotations you upload. You grant us a licence to host and process that content solely to provide {PRODUCT}. We do not claim your customer relationships.
      </p>

      <h2>8. Intellectual property</h2>
      <p>{PRODUCT}, its software and branding belong to {OPERATOR}. You may not copy the product or remove marks.</p>

      <h2>9. Disclaimer</h2>
      <p>
        {PRODUCT} is provided “as is”. We do not warrant that every quotation is error-free, that AI output is complete, or that the service will be uninterrupted. You remain responsible for commercial decisions.
      </p>

      <h2>10. Liability</h2>
      <p>
        To the extent Indian law allows, {OPERATOR} is not liable for lost profits, lost data, or indirect loss. Our total liability for a claim relating to {PRODUCT} is limited to the fees you paid us for {PRODUCT} in the 3 months before the claim.
      </p>

      <h2>11. Cancellation</h2>
      <p>You may stop using {PRODUCT} at any time. See our <a href="/refund">Refund &amp; Cancellation Policy</a> for money back. We may stop the service with reasonable notice unless we must act sooner for legal or security reasons.</p>

      <h2>12. Law</h2>
      <p>These terms are governed by the laws of India. Courts at the place of {OPERATOR}’s business have jurisdiction, without limiting any rights you have as a consumer under mandatory law.</p>
    </>
  )
}

function RefundBody() {
  return (
    <>
      <p>
        This policy applies to paid {PRODUCT} subscriptions processed by {OPERATOR} via PhonePe. It does not apply to quotations you send to your own customers — those are your contracts.
      </p>

      <h2>1. Free trial</h2>
      <p>The free trial does not take a payment. There is nothing to refund for unused free quotations.</p>

      <h2>2. When you can get a refund</h2>
      <p>
        If you paid for a monthly plan and you have <strong>not used any paid quotation</strong> in that period, email <a href={`mailto:${EMAIL}`}>{EMAIL}</a> within <strong>7 days</strong> of the payment. We will refund the amount we received for that period, usually to the original PhonePe method, within 7–10 working days after we confirm the request.
      </p>

      <h2>3. When we do not refund</h2>
      <ul>
        <li>After you have generated or exported paid quotations in that billing period.</li>
        <li>Requests made more than 7 days after payment.</li>
        <li>Duplicate requests, chargebacks already in progress, or payments we did not receive.</li>
        <li>Taxes or gateway fees we cannot recover, if any — we will say so if that applies.</li>
      </ul>

      <h2>4. Cancellation</h2>
      <p>
        Email <a href={`mailto:${EMAIL}`}>{EMAIL}</a> to cancel auto-renewal. Cancellation stops the next charge. It does not by itself refund the current period (see section 2). You keep access until the end of the period you already paid for, unless we agree otherwise.
      </p>

      <h2>5. Failed or duplicate payments</h2>
      <p>If PhonePe shows a success but your plan did not activate, or you were charged twice, write to us with the transaction ID. We will reconcile with PhonePe and refund or activate as appropriate.</p>

      <h2>6. How to ask</h2>
      <p>
        Send the registered email, PhonePe / UPI reference, amount and date to <a href={`mailto:${EMAIL}`}>{EMAIL}</a>, or call <a href={PHONE_HREF}>{PHONE}</a>. We aim to reply within 2 business days.
      </p>
    </>
  )
}

function ContactBody() {
  return (
    <>
      <p>For support, billing, data requests, or advertising questions:</p>
      <ul>
        <li><strong>Business:</strong> {OPERATOR} ({PRODUCT})</li>
        <li><strong>Email:</strong> <a href={`mailto:${EMAIL}`}>{EMAIL}</a></li>
        <li><strong>Phone:</strong> <a href={PHONE_HREF}>{PHONE}</a></li>
        <li><strong>Address:</strong> {ADDRESS}</li>
        <li><strong>Website:</strong> <a href={SITE}>{SITE}</a></li>
      </ul>
      <p>Business hours: Monday–Saturday, 10:00–18:00 IST. We typically reply to email within one working day.</p>
      <p>
        Privacy requests (access or deletion): use the same email and write “Privacy request” in the subject. See the <a href="/privacy">Privacy Policy</a>.
      </p>
    </>
  )
}

const BODIES = {
  privacy: PrivacyBody,
  terms: TermsBody,
  refund: RefundBody,
  contact: ContactBody
}

export default function LegalPages({ pageId }) {
  const page = LEGAL_PAGES[pageId] || LEGAL_PAGES.privacy
  const Body = BODIES[pageId] || PrivacyBody

  useEffect(() => {
    document.title = `${page.title} — QuoteGen`
    try { window.scrollTo(0, 0) } catch { /* ignore */ }
  }, [page.title])

  return (
    <div className="qg-legal">
      <LegalNav current={pageId} />
      <article className="qg-legal-wrap">
        <h1>{page.title}</h1>
        <p className="qg-legal-updated">Last updated {UPDATED} · {OPERATOR}</p>
        <Body />
        <p className="qg-legal-foot">
          © {new Date().getFullYear()} {OPERATOR}. {PRODUCT} · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/refund">Refunds</a> · <a href="/contact">Contact</a>
        </p>
      </article>
    </div>
  )
}
