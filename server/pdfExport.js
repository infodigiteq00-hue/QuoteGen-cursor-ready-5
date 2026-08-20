/**
 * Turns the quotation editor's print view into a real PDF file.
 *
 * The browser posts the quotation exactly as it already rendered it, with the
 * app's own stylesheets inlined, and a headless Chrome prints that document.
 * Printing the same DOM with the same CSS is what keeps the letterhead, the
 * nested tax/discount headers, tinted columns, image cells and the repeating
 * table header identical to what `window.print()` produced; a canvas-based
 * client library would rasterise all of that and break it across pages.
 *
 * Chrome is reused from the machine (no bundled Chromium download): set
 * CHROME_PATH to override the search below.
 *
 * Security: the route is registered under /api, so app.use('/api', requireAuth)
 * gates it, and the content to print comes from the caller's own screen rather
 * than being looked up by id — there is no way to ask this route for somebody
 * else's quotation.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const windowsProgramFiles = process.env.PROGRAMFILES || 'C:\\Program Files'
const windowsProgramFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
const windowsLocalAppData = process.env.LOCALAPPDATA || ''

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  join(windowsProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(windowsProgramFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  windowsLocalAppData && join(windowsLocalAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  join(windowsProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  join(windowsProgramFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
].filter(Boolean)

const MAX_HTML_CHARS = 28 * 1024 * 1024
const RENDER_TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS) || 45000
const A4_WIDTH_PX = 794
const A4_HEIGHT_PX = 1123

function pdfError(message, code, status = 500) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
}

function mmToPx(mm) {
  return Math.max(1, Math.round(Number(mm) * 96 / 25.4))
}

/** Path of the first Chrome/Chromium that actually exists on this machine. */
export function findChrome() {
  return CHROME_CANDIDATES.find(path => existsSync(path)) || null
}

/** Keep a client-supplied name usable as a download filename. */
export function safeFileName(raw) {
  const cleaned = String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 120)
    .trim()
  const base = cleaned.replace(/\.pdf$/i, '').trim()
  return `${base || 'Quotation'}.pdf`
}

function runChrome(binary, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 2000) })
    child.on('error', error => {
      clearTimeout(timer)
      reject(pdfError(`Could not start Chrome: ${error.message}`, 'CHROME_SPAWN_FAILED', 500))
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (timedOut) {
        return reject(pdfError(`Rendering timed out after ${Math.round(timeoutMs / 1000)}s.`, 'PDF_TIMEOUT', 504))
      }
      if (code !== 0) {
        return reject(pdfError(`Chrome exited with code ${code}. ${stderr.trim().split('\n').slice(-1)[0] || ''}`.trim(), 'CHROME_FAILED', 502))
      }
      resolve()
    })
  })
}

/**
 * Read the quotation's own @page size so the headless window matches the
 * sheet. Linux Chromium's default 800×600 window is landscape; pairing that
 * with a portrait @page writes /Rotate 90 and the PDF comes out on its side.
 */
function inferPageSizeMm(html) {
  const source = String(html || '')
  const named = source.match(/@page\s+qg-studio\s*\{[^}]*size:\s*([\d.]+)mm\s+([\d.]+)mm/i)
  const any = source.match(/@page[^{]*\{[^}]*size:\s*([\d.]+)mm\s+([\d.]+)mm/i)
  const match = named || any
  if (!match) return null
  const widthMm = Number(match[1])
  const heightMm = Number(match[2])
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm < 10 || heightMm < 10) return null
  return { widthMm, heightMm }
}

function viewportForPage(size) {
  if (!size) return { width: A4_WIDTH_PX, height: A4_HEIGHT_PX, deviceScaleFactor: 1 }
  const width = Math.max(A4_WIDTH_PX, mmToPx(size.widthMm))
  const height = Math.max(A4_HEIGHT_PX, mmToPx(size.heightMm))
  /* Portrait sheet: keep the window taller than wide. A landscape 800×600
     default window is what made Chromium stamp /Rotate 90. */
  if (size.widthMm <= size.heightMm) {
    return { width, height: Math.max(height, width + 1), deviceScaleFactor: 1 }
  }
  return { width, height, deviceScaleFactor: 1 }
}

/** Last-wins CSS so screen-fit zoom cannot leak into print, and Linux
 * Chromium is told not to rotate a wide sheet onto a portrait MediaBox. */
function withUprightPageCss(html, size) {
  const sizeDecl = size
    ? `size: ${size.widthMm}mm ${size.heightMm}mm !important;`
    : 'size: 210mm 297mm !important;'
  const css = `<style data-qg-pdf-orientation>
html, body { zoom: 1 !important; transform: none !important; }
.qg-studio-canvas { container-type: normal !important; overflow: visible !important; padding: 0 !important; }
.qg-studio-paper-frame, .qg-studio-paper, .quote-paper, .upload-word-page {
  zoom: 1 !important;
  transform: none !important;
}
@page { ${sizeDecl} margin: 0 !important; page-orientation: upright !important; }
@page qg-studio { ${sizeDecl} margin: 0 !important; page-orientation: upright !important; }
@media print {
  @page { ${sizeDecl} margin: 0 !important; page-orientation: upright !important; }
  @page qg-studio { ${sizeDecl} margin: 0 !important; page-orientation: upright !important; }
  .qg-studio-paper-frame, .qg-studio-paper, .quote-paper, .upload-word-page {
    zoom: 1 !important;
    transform: none !important;
  }
}
</style>`
  const source = String(html || '')
  if (/<\/head>/i.test(source)) return source.replace(/<\/head>/i, `${css}</head>`)
  return `<!doctype html><head>${css}</head>${source}`
}

function assertPdf(bytes) {
  if (!bytes || bytes.length < 1000 || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw pdfError('Chrome produced an unreadable PDF.', 'PDF_INVALID', 502)
  }
  return bytes
}

/**
 * Linux Chromium --print-to-pdf / page.pdf() sometimes stamps /Rotate 90 on
 * every page even when layout was portrait. That is a viewer-only flag; the
 * content stream is already upright, so clearing it restores the sheet.
 */
function normalizePdfRotation(pdf) {
  let latin1 = Buffer.from(pdf).toString('latin1')
  const original = latin1
  const hadSideways = /\/Rotate\s+(?:90|270)\b/.test(latin1)
  latin1 = latin1.replace(/\/Rotate\s+(?:90|180|270)(?:\.\d+)?\b/g, '/Rotate 0')
  /* Chromium often pairs /Rotate 90 with a portrait MediaBox. After clearing
     rotate, swap the box so a wide sheet stays a wide sheet, upright. */
  if (hadSideways) {
    latin1 = latin1.replace(/\/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]/g, (full, x0, y0, x1, y1) => {
      const left = Number(x0)
      const bottom = Number(y0)
      const w = Number(x1) - left
      const h = Number(y1) - bottom
      if (!(w > 0 && h > 0) || w >= h) return full
      return `/MediaBox [ ${x0} ${y0} ${left + h} ${bottom + w} ]`
    })
  }
  if (latin1 === original) return Buffer.from(pdf)
  return Buffer.from(latin1, 'latin1')
}

function pdfOptionsFor(timeoutMs, size) {
  const widthMm = size?.widthMm || 210
  const heightMm = size?.heightMm || 297
  return {
    printBackground: true,
    preferCSSPageSize: false,
    landscape: false,
    width: `${widthMm}mm`,
    height: `${heightMm}mm`,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    scale: 1,
    timeout: timeoutMs
  }
}

/**
 * CDP print (page.pdf) instead of CLI --print-to-pdf. Needed on Linux hosts
 * (Railway, Vercel, containers) where Chromium treats a landscape viewport as
 * "rotate the sheet". Local Windows still uses spawn, which already works.
 */
async function renderHtmlToPdfWithPuppeteer(html, timeoutMs, systemBinary) {
  let chromium = null
  let puppeteer
  let executablePath = systemBinary || null
  let args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--hide-scrollbars',
    '--font-render-hinting=none',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-color-profile=srgb'
  ]
  let headless = true

  try {
    puppeteer = await import('puppeteer-core')
  } catch {
    throw pdfError(
      'No Chrome or Chromium was found on the server. Install Google Chrome or set CHROME_PATH in .env.',
      'CHROME_MISSING',
      503
    )
  }

  if (!executablePath) {
    try {
      chromium = (await import('@sparticuz/chromium')).default
      chromium.setGraphicsMode = false
      executablePath = await chromium.executablePath()
      args = [...chromium.args]
      headless = chromium.headless ?? true
    } catch {
      throw pdfError(
        'No Chrome or Chromium was found on the server. Install Google Chrome or set CHROME_PATH in .env.',
        'CHROME_MISSING',
        503
      )
    }
  }

  const size = inferPageSizeMm(html)
  const viewport = viewportForPage(size)
  args = [
    ...args,
    `--window-size=${viewport.width},${viewport.height}`,
    '--font-render-hinting=none',
    '--hide-scrollbars'
  ]
  const browser = await puppeteer.default.launch({
    args,
    defaultViewport: viewport,
    executablePath,
    headless
  })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(timeoutMs)
    await page.setViewport(viewport)
    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs })
    await page.emulateMediaType('print')
    const pdf = await page.pdf(pdfOptionsFor(timeoutMs, size))
    return assertPdf(Buffer.from(pdf))
  } finally {
    await browser.close().catch(() => {})
  }
}

async function renderHtmlToPdfWithSpawn(html, timeoutMs, binary) {
  const size = inferPageSizeMm(html)
  const viewport = viewportForPage(size)
  const dir = await mkdtemp(join(tmpdir(), 'quotegen-pdf-'))
  const htmlPath = join(dir, 'quotation.html')
  const pdfPath = join(dir, 'quotation.pdf')
  try {
    await writeFile(htmlPath, html, 'utf8')
    const args = [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      `--window-size=${viewport.width},${viewport.height}`,
      // A throwaway profile: never attach to the operator's own Chrome session.
      `--user-data-dir=${join(dir, 'profile')}`,
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href
    ]
    if (process.platform === 'linux') {
      args.unshift('--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage')
    }
    await runChrome(binary, args, timeoutMs)

    const pdf = await readFile(pdfPath)
    return assertPdf(pdf)
  } catch (error) {
    if (error?.code === 'ENOENT') throw pdfError('Chrome did not write a PDF file.', 'PDF_MISSING', 502)
    throw error
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function usePuppeteerPrint(binary) {
  if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT) return true
  if (process.platform === 'linux') return true
  return !binary
}

/**
 * Print a standalone HTML document to PDF bytes.
 * Chrome applies print media itself, so the app's `@media print` rules —
 * including `@page { size: A4; margin: 10mm }` — drive the page geometry.
 */
export async function renderHtmlToPdf(html, { timeoutMs = RENDER_TIMEOUT_MS } = {}) {
  const binary = findChrome()
  const size = inferPageSizeMm(html)
  const prepared = withUprightPageCss(html, size)

  let pdf
  if (usePuppeteerPrint(binary)) {
    try {
      pdf = await renderHtmlToPdfWithPuppeteer(prepared, timeoutMs, binary)
    } catch (error) {
      if (!binary || error?.code === 'CHROME_MISSING') throw error
      pdf = await renderHtmlToPdfWithSpawn(prepared, timeoutMs, binary)
    }
  } else if (binary) {
    pdf = await renderHtmlToPdfWithSpawn(prepared, timeoutMs, binary)
  } else {
    throw pdfError(
      'No Chrome or Chromium was found on the server. Install Google Chrome or set CHROME_PATH in .env.',
      'CHROME_MISSING',
      503
    )
  }
  return normalizePdfRotation(pdf)
}

export function registerPdfRoutes(app) {
  app.post('/api/quotation-pdf', async (req, res) => {
    const requestId = `pdf-${Date.now()}`
    const html = typeof req.body?.html === 'string' ? req.body.html : ''
    if (!html.trim()) {
      return res.status(400).json({ error: 'html is required.', code: 'VALIDATION_ERROR', requestId })
    }
    if (html.length > MAX_HTML_CHARS) {
      return res.status(413).json({
        error: 'This quotation is too large to render as a PDF. Try smaller images.',
        code: 'PAYLOAD_TOO_LARGE',
        requestId
      })
    }

    const fileName = safeFileName(req.body?.fileName)
    const started = Date.now()
    try {
      const pdf = await renderHtmlToPdf(html)
      console.info(`[${requestId}] quotation PDF rendered`, {
        user: req.userId, bytes: pdf.length, ms: Date.now() - started
      })
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
      res.setHeader('Content-Length', String(pdf.length))
      res.send(pdf)
    } catch (error) {
      console.error(`[${requestId}] quotation PDF failed`, error?.code, error?.message)
      res.status(error?.status || 500).json({
        error: error?.message || 'PDF generation failed.',
        code: error?.code || 'PDF_ERROR',
        requestId
      })
    }
  })
}
