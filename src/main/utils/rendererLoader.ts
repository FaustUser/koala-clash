import { is } from '@electron-toolkit/utils'
import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'

const DEV_RENDERER_LOAD_RETRY_MS = 350
const DEV_RENDERER_LOAD_MAX_ATTEMPTS = 30
const DEV_RENDERER_PROBE_TIMEOUT_MS = 500
const DEV_SERVER_UNAVAILABLE_ERROR_CODES = new Set([-102, -105, -106, -118])

type LoadRendererEntryOptions = {
  entryHtml: string
  devPath?: string
  routeHash?: string | null
  windowLabel?: string
}

type RendererSource = 'dev-server' | 'bundle' | 'unavailable'

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function normalizeHash(hash?: string | null): string | undefined {
  if (!hash) {
    return undefined
  }

  const normalized = hash.startsWith('#') ? hash.slice(1) : hash
  return normalized.length > 0 ? normalized : undefined
}

function bundledRendererPath(entryHtml: string): string {
  return join(__dirname, '../renderer', entryHtml)
}

function buildDevRendererUrl(
  devPath = '',
  routeHash?: string | null
): string | null {
  const baseUrl = process.env['ELECTRON_RENDERER_URL']
  if (!is.dev || !baseUrl) {
    return null
  }

  const url = new URL(devPath.replace(/^\//, ''), ensureTrailingSlash(baseUrl))
  const normalizedHash = normalizeHash(routeHash)
  if (normalizedHash) {
    url.hash = normalizedHash
  }
  return url.toString()
}

async function canReachDevRenderer(url: string): Promise<boolean> {
  const probeUrl = new URL(url)
  probeUrl.hash = ''

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEV_RENDERER_PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(probeUrl, {
      signal: controller.signal,
      headers: { accept: 'text/html' }
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForDevRenderer(url: string): Promise<boolean> {
  for (let attempt = 1; attempt <= DEV_RENDERER_LOAD_MAX_ATTEMPTS; attempt++) {
    if (await canReachDevRenderer(url)) {
      return true
    }

    if (attempt < DEV_RENDERER_LOAD_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, DEV_RENDERER_LOAD_RETRY_MS))
    }
  }

  return false
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function loadBundledRenderer(
  window: BrowserWindow,
  entryHtml: string,
  routeHash?: string | null
): Promise<void> {
  const filePath = bundledRendererPath(entryHtml)
  if (!existsSync(filePath)) {
    throw new Error(`Bundled renderer entry not found: ${filePath}`)
  }

  const hash = normalizeHash(routeHash)
  if (hash) {
    await window.loadFile(filePath, { hash })
    return
  }

  await window.loadFile(filePath)
}

async function loadRendererUnavailablePage(
  window: BrowserWindow,
  options: LoadRendererEntryOptions,
  devRendererUrl: string
): Promise<void> {
  const title = escapeHtml(options.windowLabel ?? options.entryHtml)
  const entryHtml = escapeHtml(options.entryHtml)
  const escapedUrl = escapeHtml(devRendererUrl)
  const bundledPath = escapeHtml(bundledRendererPath(options.entryHtml))
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${title} unavailable</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0f172a;
        color: #e2e8f0;
      }
      main {
        width: min(640px, calc(100vw - 48px));
        padding: 24px;
        border-radius: 16px;
        background: rgba(15, 23, 42, 0.92);
        box-shadow: 0 24px 60px rgba(15, 23, 42, 0.45);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 24px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.5;
      }
      code {
        font-family: Consolas, monospace;
        font-size: 13px;
        word-break: break-word;
      }
      .meta {
        margin-top: 18px;
        padding: 14px 16px;
        border-radius: 12px;
        background: rgba(30, 41, 59, 0.92);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title} is unavailable</h1>
      <p>The configured renderer dev server is not responding, and no bundled renderer page was found.</p>
      <p>This window was trying to load <code>${escapedUrl}</code>.</p>
      <div class="meta">
        <p>Expected bundled entry: <code>${bundledPath}</code></p>
        <p>Missing page: <code>${entryHtml}</code></p>
      </div>
    </main>
  </body>
</html>`

  await window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`)
}

export function hasConfiguredDevRenderer(): boolean {
  return is.dev && Boolean(process.env['ELECTRON_RENDERER_URL'])
}

export function isRendererDevUrl(url?: string | null): boolean {
  const baseUrl = process.env['ELECTRON_RENDERER_URL']
  if (!is.dev || !baseUrl || !url) {
    return false
  }

  try {
    const currentUrl = new URL(url)
    const devUrl = new URL(baseUrl)
    return currentUrl.origin === devUrl.origin
  } catch {
    return false
  }
}

export function isRecoverableDevRendererFailure(
  url: string | undefined,
  errorCode: number
): boolean {
  return isRendererDevUrl(url) && DEV_SERVER_UNAVAILABLE_ERROR_CODES.has(errorCode)
}

export async function loadRendererEntry(
  window: BrowserWindow,
  options: LoadRendererEntryOptions
): Promise<RendererSource> {
  const devRendererUrl = buildDevRendererUrl(options.devPath, options.routeHash)
  let lastDevLoadError: unknown

  if (devRendererUrl && (await waitForDevRenderer(devRendererUrl))) {
    try {
      await window.loadURL(devRendererUrl)
      return 'dev-server'
    } catch (error) {
      lastDevLoadError = error
      console.warn(
        `[renderer-loader] Failed to load ${options.windowLabel ?? options.entryHtml} from ${devRendererUrl}. Falling back.`,
        error
      )
    }
  }

  try {
    await loadBundledRenderer(window, options.entryHtml, options.routeHash)
    if (devRendererUrl) {
      console.warn(
        `[renderer-loader] Dev renderer unavailable at ${devRendererUrl}; loaded bundled ${options.entryHtml} instead.`
      )
    }
    return 'bundle'
  } catch (error) {
    if (devRendererUrl) {
      console.warn(
        `[renderer-loader] No bundled renderer found for ${options.windowLabel ?? options.entryHtml}; loading diagnostic page.`,
        error ?? lastDevLoadError
      )
      await loadRendererUnavailablePage(window, options, devRendererUrl)
      return 'unavailable'
    }

    throw error
  }
}
