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

function pdfError(message, code, status = 500) {
  const error = new Error(message)
  error.code = code
  error.status = status
  return error
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
 * Print a standalone HTML document to PDF bytes.
 * Chrome applies print media itself, so the app's `@media print` rules —
 * including `@page { size: A4; margin: 10mm }` — drive the page geometry.
 */
export async function renderHtmlToPdf(html, { timeoutMs = RENDER_TIMEOUT_MS } = {}) {
  const binary = findChrome()
  if (!binary) {
    throw pdfError(
      'No Chrome or Chromium was found on the server. Install Google Chrome or set CHROME_PATH in .env.',
      'CHROME_MISSING',
      503
    )
  }

  const dir = await mkdtemp(join(tmpdir(), 'quotegen-pdf-'))
  const htmlPath = join(dir, 'quotation.html')
  const pdfPath = join(dir, 'quotation.pdf')
  try {
    await writeFile(htmlPath, html, 'utf8')
    await runChrome(binary, [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      // A throwaway profile: never attach to the operator's own Chrome session.
      `--user-data-dir=${join(dir, 'profile')}`,
      '--no-pdf-header-footer',
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href
    ], timeoutMs)

    const pdf = await readFile(pdfPath)
    if (pdf.length < 1000 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw pdfError('Chrome produced an unreadable PDF.', 'PDF_INVALID', 502)
    }
    return pdf
  } catch (error) {
    if (error?.code === 'ENOENT') throw pdfError('Chrome did not write a PDF file.', 'PDF_MISSING', 502)
    throw error
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
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
