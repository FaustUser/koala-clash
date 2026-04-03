import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { registerIpcMainHandlers } from './utils/ipc'
import windowStateKeeper from 'electron-window-state'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  powerMonitor,
  shell
} from 'electron'
import {
  addProfileItem,
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from './config'
import { getCoreHealth, quitWithoutCore, startCore, stopCore } from './core/manager'
import { triggerSysProxy } from './sys/sysproxy'
import icon from '../../resources/icon.png?asset'
import { createTray, updateTrayIcon } from './resolve/tray'
import { createApplicationMenu } from './resolve/menu'
import { init } from './utils/init'
import path, { join } from 'path'
import { initShortcut } from './resolve/shortcut'
import { execSync, spawn } from 'child_process'
import { createElevateTaskSync } from './sys/misc'
import { initProfileUpdater } from './core/profileUpdater'
import { existsSync, writeFileSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { exePath, logDir, logPath, rendererDiagnosticsPath, taskDir } from './utils/dirs'
import { showFloatingWindow } from './resolve/floatingWindow'
import { getAppConfigSync } from './config/app'
import { t } from './utils/i18n'
import {
  hasConfiguredDevRenderer,
  isRecoverableDevRendererFailure,
  loadRendererEntry
} from './utils/rendererLoader'

let quitTimeout: NodeJS.Timeout | null = null
export let mainWindow: BrowserWindow | null = null
export let needsFirstRunAdmin = false

function configureDevInstanceIsolation(): void {
  if (!is.dev) return

  const devUserDataPath = path.join(app.getPath('appData'), 'io.github.koala-clash-dev')
  app.setPath('userData', devUserDataPath)
}

/**
 * Show error to the user via renderer toast notification.
 * Falls back to system dialog if the window is not available.
 */
export function showError(title: string, message: string): void {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed()
  ) {
    try {
      mainWindow.webContents.send('showError', title, message)
      return
    } catch {
      // fall back to system dialog
    }
  }

  dialog.showErrorBox(title, message)
}
let pendingDeepLink: string | null = null
let isCreatingWindow = false
let windowShown = false
let createWindowPromiseResolve: (() => void) | null = null
let createWindowPromise: Promise<void> | null = null
const MAX_RENDERER_EVENT_HISTORY = 20
const RENDERER_CRASH_WINDOW_MS = 2 * 60 * 1000
const RENDERER_CRASH_THRESHOLD = 3
const RENDERER_RECOVERY_TIMEOUT_MS = 15000

type RendererDiagnosticEvent = {
  timestamp: string
  type: string
  details?: Record<string, unknown>
}

type RendererCrashRecord = {
  timestamp: number
  reason: string
  exitCode?: number
}

type RendererRecoveryState = {
  attemptId: number
  startedAt: number
  reason: string
  crashCount: number
  exitCode?: number
  snapshot: RendererDiagnosticSnapshot
}

type RendererFailSafeTrigger = 'crash-threshold' | 'recovery-timeout'

type RendererFailSafeOptions = {
  snapshot?: RendererDiagnosticSnapshot
  trigger: RendererFailSafeTrigger
  crashCount: number
  exitCode?: number
  timedOutAfterMs?: number
}

type RendererDiagnosticSnapshot = {
  app: {
    version: string
    platform: NodeJS.Platform
    pid: number
    electron?: string
    chrome?: string
    node?: string
  }
  config: {
    sysProxyEnabled: boolean
    onlyActiveDevice: boolean
    tunEnabled: boolean
    readErrors: string[]
  }
  coreHealth: ReturnType<typeof getCoreHealth>
  window: {
    exists: boolean
    destroyed: boolean
    webContentsDestroyed: boolean
    visible: boolean
    focused: boolean
    minimized: boolean
    loading: boolean
    waitingForResponse: boolean
    title: string | null
    url: string | null
    bounds: Electron.Rectangle | null
  }
  rendererProcess: {
    pid: number | null
    memoryInfo: unknown
    appMetrics: unknown[]
  }
  recovery: {
    recoveryScheduled: boolean
    rendererFailSafeRunning: boolean
    windowShown: boolean
    recentCrashCount: number
    recoveryTimeoutScheduled: boolean
    pendingRecovery: {
      attemptId: number
      startedAt: string
      reason: string
      crashCount: number
      exitCode?: number
    } | null
  }
  recentEvents: RendererDiagnosticEvent[]
}

const rendererEventHistory: RendererDiagnosticEvent[] = []
let recentRendererCrashHistory: RendererCrashRecord[] = []
let rendererRecoveryTimeout: NodeJS.Timeout | null = null
let rendererRecoveryAttemptId = 0
let pendingRendererRecovery: RendererRecoveryState | null = null

function serializeDiagnosticValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    }
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeDiagnosticValue(item))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, serializeDiagnosticValue(item)])
        .filter(([, item]) => item !== undefined)
    )
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'function') {
    return undefined
  }

  return value
}

function recordRendererEvent(type: string, details: Record<string, unknown> = {}): void {
  rendererEventHistory.push({
    timestamp: new Date().toISOString(),
    type,
    details: serializeDiagnosticValue(details) as Record<string, unknown>
  })

  if (rendererEventHistory.length > MAX_RENDERER_EVENT_HISTORY) {
    rendererEventHistory.shift()
  }
}

function pruneRecentRendererCrashes(now = Date.now()): void {
  recentRendererCrashHistory = recentRendererCrashHistory.filter(
    (crash) => now - crash.timestamp <= RENDERER_CRASH_WINDOW_MS
  )
}

function clearRendererRecoveryTimeout(): void {
  if (rendererRecoveryTimeout) {
    clearTimeout(rendererRecoveryTimeout)
    rendererRecoveryTimeout = null
  }
}

function formatRendererCrashMessage(reason: string): string {
  return t('error.rendererCrashFailSafe').replace('{reason}', reason)
}

async function collectRendererDiagnosticsSnapshot(
  window: BrowserWindow | null
): Promise<RendererDiagnosticSnapshot> {
  pruneRecentRendererCrashes()
  const [appConfigResult, controlledConfigResult] = await Promise.allSettled([
    getAppConfig(),
    getControledMihomoConfig()
  ])
  const readErrors: string[] = []
  let appConfig: AppConfig | undefined
  let controlledConfig: Partial<MihomoConfig> | undefined

  if (appConfigResult.status === 'fulfilled') {
    appConfig = appConfigResult.value
  } else {
    readErrors.push(`getAppConfig failed: ${String(appConfigResult.reason)}`)
  }

  if (controlledConfigResult.status === 'fulfilled') {
    controlledConfig = controlledConfigResult.value
  } else {
    readErrors.push(`getControledMihomoConfig failed: ${String(controlledConfigResult.reason)}`)
  }

  const windowExists = Boolean(window)
  const windowDestroyed = window ? window.isDestroyed() : true
  const webContentsDestroyed = windowDestroyed || !window ? true : window.webContents.isDestroyed()
  const canReadWindowState = Boolean(window && !windowDestroyed && !webContentsDestroyed)

  let rendererPid: number | null = null
  let rendererMemoryInfo: unknown = null
  let rendererUrl: string | null = null

  if (canReadWindowState && window) {
    try {
      rendererPid = window.webContents.getOSProcessId()
    } catch (error) {
      rendererMemoryInfo = { getOSProcessIdError: serializeDiagnosticValue(error) }
    }

    try {
      rendererUrl = window.webContents.getURL()
    } catch {
      rendererUrl = null
    }
  }

  const rendererAppMetrics = app
    .getAppMetrics()
    .filter((metric) => metric.pid === process.pid || metric.pid === rendererPid)

  return {
    app: {
      version: app.getVersion(),
      platform: process.platform,
      pid: process.pid,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    config: {
      sysProxyEnabled: appConfig?.sysProxy?.enable ?? false,
      onlyActiveDevice: appConfig?.onlyActiveDevice ?? false,
      tunEnabled: controlledConfig?.tun?.enable ?? false,
      readErrors
    },
    coreHealth: getCoreHealth(),
    window: {
      exists: windowExists,
      destroyed: windowDestroyed,
      webContentsDestroyed,
      visible: canReadWindowState && window ? window.isVisible() : false,
      focused: canReadWindowState && window ? window.isFocused() : false,
      minimized: canReadWindowState && window ? window.isMinimized() : false,
      loading: canReadWindowState && window ? window.webContents.isLoading() : false,
      waitingForResponse:
        canReadWindowState && window ? window.webContents.isWaitingForResponse() : false,
      title: canReadWindowState && window ? window.getTitle() : null,
      url: rendererUrl,
      bounds: canReadWindowState && window ? window.getBounds() : null
    },
    rendererProcess: {
      pid: rendererPid,
      memoryInfo:
        rendererPid === null
          ? serializeDiagnosticValue(rendererMemoryInfo)
          : serializeDiagnosticValue(
              rendererAppMetrics.find((metric) => metric.pid === rendererPid)?.memory ??
                rendererMemoryInfo
            ),
      appMetrics: rendererAppMetrics.map((metric) => serializeDiagnosticValue(metric))
    },
    recovery: {
      recoveryScheduled: mainWindowRecoveryTimeout !== null,
      rendererFailSafeRunning,
      windowShown,
      recentCrashCount: recentRendererCrashHistory.length,
      recoveryTimeoutScheduled: rendererRecoveryTimeout !== null,
      pendingRecovery: pendingRendererRecovery
        ? {
            attemptId: pendingRendererRecovery.attemptId,
            startedAt: new Date(pendingRendererRecovery.startedAt).toISOString(),
            reason: pendingRendererRecovery.reason,
            crashCount: pendingRendererRecovery.crashCount,
            exitCode: pendingRendererRecovery.exitCode
          }
        : null
    },
    recentEvents: rendererEventHistory.slice()
  }
}

async function appendRendererDiagnostics(
  event: string,
  details: Record<string, unknown>,
  snapshot?: RendererDiagnosticSnapshot
): Promise<void> {
  const diagnosticsPath = rendererDiagnosticsPath()
  const entry = {
    timestamp: new Date().toISOString(),
    event,
    details: serializeDiagnosticValue(details),
    snapshot: snapshot ?? (await collectRendererDiagnosticsSnapshot(mainWindow))
  }
  const reason =
    typeof details.reason === 'string' && details.reason.length > 0 ? ` (${details.reason})` : ''
  const payload = `===== Renderer diagnostics =====
${JSON.stringify(entry, null, 2)}

`

  try {
    await mkdir(logDir(), { recursive: true })
    await Promise.all([
      writeFile(diagnosticsPath, payload, { flag: 'a' }),
      writeFile(
        logPath(),
        `[Renderer]: ${event}${reason}, diagnostics saved to ${diagnosticsPath}\n`,
        {
          flag: 'a'
        }
      )
    ])
  } catch (error) {
    console.error('[renderer-diagnostics] Failed to write diagnostics', error)
  }
}

function markRendererRecovered(source: string): void {
  if (!pendingRendererRecovery) {
    return
  }

  const recovery = pendingRendererRecovery
  pendingRendererRecovery = null
  clearRendererRecoveryTimeout()

  const recoveryMs = Date.now() - recovery.startedAt
  recordRendererEvent('renderer-recovered', {
    source,
    reason: recovery.reason,
    crashCount: recovery.crashCount,
    recoveryMs
  })
  void appendRendererDiagnostics(
    'renderer-recovered',
    {
      source,
      reason: recovery.reason,
      crashCount: recovery.crashCount,
      recoveryMs
    },
    recovery.snapshot
  )
}

function beginRendererRecoveryWatch(
  reason: string,
  crashCount: number,
  snapshot: RendererDiagnosticSnapshot,
  exitCode?: number
): void {
  clearRendererRecoveryTimeout()

  const attemptId = ++rendererRecoveryAttemptId
  pendingRendererRecovery = {
    attemptId,
    startedAt: Date.now(),
    reason,
    crashCount,
    exitCode,
    snapshot
  }

  recordRendererEvent('renderer-recovery-watch-started', {
    reason,
    crashCount,
    exitCode,
    timeoutMs: RENDERER_RECOVERY_TIMEOUT_MS
  })
  void appendRendererDiagnostics(
    'renderer-recovery-watch-started',
    {
      reason,
      crashCount,
      exitCode,
      timeoutMs: RENDERER_RECOVERY_TIMEOUT_MS
    },
    snapshot
  )

  rendererRecoveryTimeout = setTimeout(() => {
    const recovery = pendingRendererRecovery
    if (!recovery || recovery.attemptId !== attemptId) {
      return
    }

    pendingRendererRecovery = null
    clearRendererRecoveryTimeout()
    recordRendererEvent('renderer-recovery-timeout', {
      reason: recovery.reason,
      crashCount: recovery.crashCount,
      exitCode: recovery.exitCode,
      timeoutMs: RENDERER_RECOVERY_TIMEOUT_MS
    })
    void runRendererCrashFailSafe(recovery.reason, {
      snapshot: recovery.snapshot,
      trigger: 'recovery-timeout',
      crashCount: recovery.crashCount,
      exitCode: recovery.exitCode,
      timedOutAfterMs: RENDERER_RECOVERY_TIMEOUT_MS
    })
  }, RENDERER_RECOVERY_TIMEOUT_MS)
}

async function handleRendererCrash(
  reason: string,
  exitCode?: number
): Promise<void> {
  const snapshot = await collectRendererDiagnosticsSnapshot(mainWindow)
  await appendRendererDiagnostics(
    'render-process-gone',
    {
      reason,
      exitCode
    },
    snapshot
  )
  const now = Date.now()
  pruneRecentRendererCrashes(now)
  recentRendererCrashHistory.push({ timestamp: now, reason, exitCode })

  const crashCount = recentRendererCrashHistory.length
  const policyDetails = {
    reason,
    exitCode,
    crashCount,
    crashThreshold: RENDERER_CRASH_THRESHOLD,
    crashWindowMs: RENDERER_CRASH_WINDOW_MS,
    recoveryTimeoutMs: RENDERER_RECOVERY_TIMEOUT_MS
  }

  recordRendererEvent('renderer-crash-policy-evaluated', policyDetails)
  await appendRendererDiagnostics('renderer-crash-policy-evaluated', policyDetails, snapshot)

  if (crashCount >= RENDERER_CRASH_THRESHOLD) {
    pendingRendererRecovery = null
    clearRendererRecoveryTimeout()
    recordRendererEvent('renderer-crash-threshold-reached', policyDetails)
    await runRendererCrashFailSafe(reason, {
      snapshot,
      trigger: 'crash-threshold',
      crashCount,
      exitCode
    })
    return
  }

  beginRendererRecoveryWatch(reason, crashCount, snapshot, exitCode)
  await appendRendererDiagnostics(
    'renderer-crash-preserved-vpn',
    {
      ...policyDetails,
      action: 'recover-ui-only'
    },
    snapshot
  )
}

configureDevInstanceIsolation()
let mainWindowRecoveryTimeout: NodeJS.Timeout | null = null
let rendererFailSafeRunning = false

function scheduleMainWindowRecovery(reason: string): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindowRecoveryTimeout) {
    return
  }

  recordRendererEvent('main-window-recovery-scheduled', { reason })
  mainWindowRecoveryTimeout = setTimeout(() => {
    const currentWindow = mainWindow

    if (!currentWindow || currentWindow.isDestroyed()) {
      mainWindowRecoveryTimeout = null
      return
    }

    void (async () => {
      try {
        console.error(`[main-window] Recovering renderer after ${reason}`)
        recordRendererEvent('main-window-recovery-started', {
          reason,
          webContentsDestroyed: currentWindow.webContents.isDestroyed()
        })

        if (currentWindow.webContents.isDestroyed()) {
          currentWindow.destroy()
          mainWindow = null
          await createWindow()
          if (windowShown) {
            await showMainWindow()
          }
          return
        }

        if (hasConfiguredDevRenderer()) {
          let routeHash: string | undefined
          try {
            routeHash = new URL(currentWindow.webContents.getURL()).hash || undefined
          } catch {
            routeHash = undefined
          }
          await loadRendererWindow(currentWindow, routeHash)
        } else {
          currentWindow.webContents.reloadIgnoringCache()
        }

        if (windowShown && !currentWindow.isVisible()) {
          currentWindow.show()
        }
      } catch (error) {
        console.error('[main-window] Renderer recovery failed', error)
        showError(t('dialog.appInitFailed'), `${error}`)
      } finally {
        mainWindowRecoveryTimeout = null
      }
    })()
  }, 300)
}

async function runRendererCrashFailSafe(
  reason: string,
  options: RendererFailSafeOptions
): Promise<void> {
  if (rendererFailSafeRunning) {
    return
  }

  rendererFailSafeRunning = true
  pendingRendererRecovery = null
  clearRendererRecoveryTimeout()
  const activeSnapshot =
    options.snapshot ?? (await collectRendererDiagnosticsSnapshot(mainWindow))
  recordRendererEvent('renderer-fail-safe-start', {
    reason,
    trigger: options.trigger,
    crashCount: options.crashCount,
    exitCode: options.exitCode,
    timedOutAfterMs: options.timedOutAfterMs
  })
  let sysProxyEnabled = activeSnapshot.config.sysProxyEnabled
  let tunEnabled = activeSnapshot.config.tunEnabled
  let onlyActiveDevice = activeSnapshot.config.onlyActiveDevice

  try {
    if (activeSnapshot.config.readErrors.length > 0) {
      const [appConfig, controlledConfig] = await Promise.all([
        getAppConfig().catch(() => undefined),
        getControledMihomoConfig().catch(() => undefined)
      ])

      sysProxyEnabled = appConfig?.sysProxy?.enable ?? sysProxyEnabled
      tunEnabled = controlledConfig?.tun?.enable ?? tunEnabled
      onlyActiveDevice = appConfig?.onlyActiveDevice ?? onlyActiveDevice
    }

    if (!sysProxyEnabled && !tunEnabled) {
      recordRendererEvent('renderer-fail-safe-skipped', {
        reason,
        trigger: options.trigger,
        crashCount: options.crashCount,
        sysProxyEnabled,
        tunEnabled
      })
      return
    }

    if (sysProxyEnabled) {
      await triggerSysProxy(false, onlyActiveDevice).catch(() => {})
      await patchAppConfig({ sysProxy: { enable: false } })
      recordRendererEvent('renderer-fail-safe-disabled-sysproxy', {
        reason,
        trigger: options.trigger,
        onlyActiveDevice
      })
    }

    if (tunEnabled) {
      await patchControledMihomoConfig({ tun: { enable: false } })
      await stopCore(true)
      try {
        const promises = await startCore()
        void Promise.all(promises)
      } catch {
        // ignore
      }
      recordRendererEvent('renderer-fail-safe-disabled-tun', {
        reason,
        trigger: options.trigger
      })
    }

    await updateTrayIcon()
    ipcMain.emit('updateTrayMenu')
    showError(
      t('dialog.rendererCrashDetected'),
      formatRendererCrashMessage(reason)
    )
    recordRendererEvent('renderer-fail-safe-completed', {
      reason,
      trigger: options.trigger,
      crashCount: options.crashCount,
      sysProxyDisabled: sysProxyEnabled,
      tunDisabled: tunEnabled
    })
    await appendRendererDiagnostics(
      'renderer-fail-safe',
      {
        reason,
        trigger: options.trigger,
        crashCount: options.crashCount,
        exitCode: options.exitCode,
        timedOutAfterMs: options.timedOutAfterMs,
        sysProxyDisabled: sysProxyEnabled,
        tunDisabled: tunEnabled
      },
      activeSnapshot
    )
  } catch (error) {
    recordRendererEvent('renderer-fail-safe-error', {
      reason,
      trigger: options.trigger,
      crashCount: options.crashCount,
      error: serializeDiagnosticValue(error)
    })
    await appendRendererDiagnostics(
      'renderer-fail-safe-error',
      {
        reason,
        trigger: options.trigger,
        crashCount: options.crashCount,
        exitCode: options.exitCode,
        timedOutAfterMs: options.timedOutAfterMs,
        error: serializeDiagnosticValue(error)
      },
      activeSnapshot
    )
  } finally {
    rendererFailSafeRunning = false
  }
}

async function scheduleLightweightMode(): Promise<void> {
  const {
    autoLightweight = false,
    autoLightweightDelay = 60,
    autoLightweightMode = 'core'
  } = await getAppConfig()

  if (!autoLightweight) return

  if (quitTimeout) {
    clearTimeout(quitTimeout)
  }

  const enterLightweightMode = async (): Promise<void> => {
    if (autoLightweightMode === 'core') {
      await quitWithoutCore()
    } else if (autoLightweightMode === 'tray') {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.destroy()
        if (process.platform === 'darwin' && app.dock) {
          app.dock.hide()
        }
      }
    }
  }

  quitTimeout = setTimeout(enterLightweightMode, autoLightweightDelay * 1000)
}

const syncConfig = getAppConfigSync()

if (
  process.platform === 'win32' &&
  !is.dev &&
  !process.argv.includes('noadmin') &&
  syncConfig.corePermissionMode !== 'service'
) {
  try {
    createElevateTaskSync()
  } catch (createError) {
    try {
      if (process.argv.slice(1).length > 0) {
        writeFileSync(path.join(taskDir(), 'param.txt'), process.argv.slice(1).join(' '))
      } else {
        writeFileSync(path.join(taskDir(), 'param.txt'), 'empty')
      }
      if (!existsSync(path.join(taskDir(), 'koala-clash-run.exe'))) {
        throw new Error('koala-clash-run.exe not found')
      } else {
        execSync('%SystemRoot%\\System32\\schtasks.exe /run /tn koala-clash-run')
      }
      app.exit()
    } catch {
      // First launch without admin — continue startup and show UI notification
      needsFirstRunAdmin = true
    }
  }
}

const gotTheLock = is.dev ? true : app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
}

export function customRelaunch(): void {
  const script = `while kill -0 ${process.pid} 2>/dev/null; do
  sleep 0.1
done
${process.argv.join(' ')} & disown
exit
`
  spawn('sh', ['-c', `"${script}"`], {
    shell: true,
    detached: true,
    stdio: 'ignore'
  })
}

if (process.platform === 'linux') {
  app.relaunch = customRelaunch
}

if (process.platform === 'win32' && !exePath().startsWith('C')) {
  // https://github.com/electron/electron/issues/43278
  // https://github.com/electron/electron/issues/36698
  app.commandLine.appendSwitch('in-process-gpu')
}

const initPromise = init()

if (syncConfig.disableGPU) {
  app.disableHardwareAcceleration()
}

function getDeepLinkFromArgs(argv: string[]): string | undefined {
  return argv.find(
    (arg) =>
      arg.startsWith('clash://') || arg.startsWith('mihomo://') || arg.startsWith('koala-clash://')
  )
}

app.on('second-instance', async (_event, commandline) => {
  showMainWindow()
  const url = commandline.pop()
  if (url) {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
      await handleDeepLink(url)
    } else {
      pendingDeepLink = url
    }
  }
})

app.on('open-url', async (_event, url) => {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    await showMainWindow()
    await handleDeepLink(url)
  } else {
    pendingDeepLink = url
  }
})

let isQuitting = false,
  notQuitDialog = false

let lastQuitAttempt = 0

export function setNotQuitDialog(): void {
  notQuitDialog = true
}

function showWindow(): number {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    } else if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    mainWindow.focusOnWebView()
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu')
    mainWindow.focus()
    mainWindow.setAlwaysOnTop(false)

    if (!mainWindow.isMinimized()) {
      return 100
    }
  }
  return 500
}

function showQuitConfirmDialog(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve(true)
      return
    }

    const delay = showWindow()
    setTimeout(() => {
      mainWindow?.webContents.send('show-quit-confirm')
      const handleQuitConfirm = (_event: Electron.IpcMainEvent, confirmed: boolean): void => {
        ipcMain.off('quit-confirm-result', handleQuitConfirm)
        resolve(confirmed)
      }
      ipcMain.once('quit-confirm-result', handleQuitConfirm)
    }, delay)
  })
}

app.on('window-all-closed', () => {
  // Don't quit app when all windows are closed
})

app.on('before-quit', async (e) => {
  if (!isQuitting && !notQuitDialog) {
    e.preventDefault()

    const now = Date.now()
    if (now - lastQuitAttempt < 500) {
      isQuitting = true
      if (quitTimeout) {
        clearTimeout(quitTimeout)
        quitTimeout = null
      }
      pendingRendererRecovery = null
      clearRendererRecoveryTimeout()
      triggerSysProxy(false, false)
      await stopCore()
      app.exit()
      return
    }
    lastQuitAttempt = now

    const confirmed = await showQuitConfirmDialog()

    if (confirmed) {
      isQuitting = true
      if (quitTimeout) {
        clearTimeout(quitTimeout)
        quitTimeout = null
      }
      pendingRendererRecovery = null
      clearRendererRecoveryTimeout()
      triggerSysProxy(false, false)
      await stopCore()
      app.exit()
    }
  } else if (notQuitDialog) {
    isQuitting = true
    if (quitTimeout) {
      clearTimeout(quitTimeout)
      quitTimeout = null
    }
    pendingRendererRecovery = null
    clearRendererRecoveryTimeout()
    triggerSysProxy(false, false)
    await stopCore()
    app.exit()
  }
})

powerMonitor.on('shutdown', async () => {
  if (quitTimeout) {
    clearTimeout(quitTimeout)
    quitTimeout = null
  }
  pendingRendererRecovery = null
  clearRendererRecoveryTimeout()
  triggerSysProxy(false, false)
  await stopCore()
  app.exit()
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId(is.dev ? 'koala-clash.app.dev' : 'koala-clash.app')
  try {
    await initPromise
  } catch (e) {
    dialog.showErrorBox(t('dialog.appInitFailed'), `${e}`)
    app.quit()
  }

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  const appConfig = await getAppConfig()
  const { showFloatingWindow: showFloating = false, disableTray = false } = appConfig
  registerIpcMainHandlers()

  // Check process.argv for deep link URL (cold start on Windows/Linux)
  if (!pendingDeepLink) {
    const deepLinkArg = getDeepLinkFromArgs(process.argv)
    if (deepLinkArg) {
      pendingDeepLink = deepLinkArg
    }
  }

  const createWindowPromise = createWindow(appConfig)

  let coreStarted = false

  const coreStartPromise = (async (): Promise<void> => {
    try {
      const [startPromise] = await startCore()
      startPromise.then(async () => {
        await initProfileUpdater()
      })
      coreStarted = true
    } catch (e) {
      showError(t('dialog.coreStartError'), `${e}`)
    }
  })()

  await createWindowPromise

  const uiTasks: Promise<void>[] = [initShortcut()]

  if (showFloating) {
    uiTasks.push(Promise.resolve(showFloatingWindow()))
  }
  if (!disableTray) {
    uiTasks.push(createTray())
  }

  await Promise.all(uiTasks)

  await Promise.all([coreStartPromise])

  if (coreStarted) {
    mainWindow?.webContents.send('core-started')
  }

  if (needsFirstRunAdmin) {
    mainWindow?.webContents.send('needs-admin-setup')
  }

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    showMainWindow()
  })
})

async function handleDeepLink(url: string): Promise<void> {
  if (
    !url.startsWith('clash://') &&
    !url.startsWith('mihomo://') &&
    !url.startsWith('koala-clash://')
  )
    return

  const urlObj = new URL(url)
  switch (urlObj.host) {
    case 'install-config': {
      try {
        const profileUrl = urlObj.searchParams.get('url')
        const profileName = urlObj.searchParams.get('name')
        if (!profileUrl) {
          throw new Error(t('error.missingUrlParam'))
        }

        const confirmed = await showProfileInstallConfirm(profileUrl, profileName)

        if (confirmed) {
          await addProfileItem({
            type: 'remote',
            name: profileName ?? undefined,
            url: profileUrl
          })
          mainWindow?.webContents.send('profileConfigUpdated')
          new Notification({ title: t('notification.profileImportSuccess') }).show()
        }
      } catch (e) {
        const hwidLimitMatch = `${e}`.match(/HWID_LIMIT:(.*)/)
        if (hwidLimitMatch && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('show-hwid-limit-error', hwidLimitMatch[1].trim())
          return
        }
        showError(t('dialog.profileImportFailed'), `${url}\n${e}`)
      }
      break
    }
  }
}

async function showProfileInstallConfirm(url: string, name?: string | null): Promise<boolean> {
  if (!mainWindow) {
    await createWindow()
  }
  let extractedName = name

  if (!extractedName) {
    try {
      const axios = (await import('axios')).default
      const response = await axios.head(url, {
        timeout: 5000
      })

      if (response.headers['profile-title']) {
        const titleValue = response.headers['profile-title']
        if (titleValue.startsWith('base64:')) {
          extractedName = Buffer.from(titleValue.slice(7), 'base64').toString('utf-8')
        } else {
          extractedName = titleValue
        }
      } else {
        if (response.headers['content-disposition']) {
          extractedName = parseFilename(response.headers['content-disposition'])
        }
      }
    } catch (error) {
      // ignore
    }
  }

  return new Promise((resolve) => {
    const delay = showWindow()
    setTimeout(() => {
      mainWindow?.webContents.send('show-profile-install-confirm', {
        url,
        name: extractedName || name
      })
      const handleConfirm = (_event: Electron.IpcMainEvent, confirmed: boolean): void => {
        ipcMain.off('profile-install-confirm-result', handleConfirm)
        resolve(confirmed)
      }
      ipcMain.once('profile-install-confirm-result', handleConfirm)
    }, delay)
  })
}

function parseFilename(str: string): string {
  if (str.match(/filename\*=.*''/)) {
    return decodeURIComponent(str.split(/filename\*=.*''/)[1])
  } else {
    const filename = str.split('filename=')[1]
    return filename?.replace(/"/g, '') || ''
  }
}

async function loadRendererWindow(
  window: BrowserWindow,
  routeHash?: string | null
): Promise<void> {
  await loadRendererEntry(window, {
    entryHtml: 'index.html',
    routeHash,
    windowLabel: 'Main window'
  })
}

export async function createWindow(appConfig?: AppConfig): Promise<void> {
  if (isCreatingWindow) {
    if (createWindowPromise) {
      await createWindowPromise
    }
    return
  }
  isCreatingWindow = true
  createWindowPromise = new Promise<void>((resolve) => {
    createWindowPromiseResolve = resolve
  })
  try {
    const config = appConfig ?? (await getAppConfig())
    const { useWindowFrame = false } = config

    const [mainWindowState] = await Promise.all([
      Promise.resolve(
        windowStateKeeper({
          defaultWidth: 800,
          defaultHeight: 700,
          file: 'window-state.json'
        })
      ),
      process.platform === 'darwin'
        ? createApplicationMenu()
        : Promise.resolve(Menu.setApplicationMenu(null))
    ])
    mainWindow = new BrowserWindow({
      minWidth: 800,
      minHeight: 600,
      width: mainWindowState.width,
      height: mainWindowState.height,
      x: mainWindowState.x,
      y: mainWindowState.y,
      show: false,
      frame: useWindowFrame,
      fullscreenable: false,
      titleBarStyle: useWindowFrame ? 'default' : 'hidden',
      titleBarOverlay: false,
      autoHideMenuBar: true,
      ...(process.platform === 'linux' ? { icon: icon } : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        spellcheck: false,
        sandbox: false
      }
    })
    recordRendererEvent('main-window-created', { useWindowFrame })
    mainWindowState.manage(mainWindow)
    if (process.platform === 'darwin' && !useWindowFrame) {
      mainWindow.setWindowButtonVisibility(false)
    }
    mainWindow.on('maximize', () => {
      mainWindow?.webContents.send('window-maximized')
    })
    mainWindow.on('ready-to-show', async () => {
      recordRendererEvent('main-window-ready-to-show')
      const { silentStart = false } = await getAppConfig()
      if (!silentStart) {
        if (quitTimeout) {
          clearTimeout(quitTimeout)
        }
        windowShown = true
        mainWindow?.show()
        mainWindow?.focusOnWebView()
      } else {
        await scheduleLightweightMode()
      }
    })
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, failedUrl, isMainFrame) => {
      if (!isMainFrame) {
        return
      }
      if (errorCode === -3) {
        return
      }

      const recoverableDevRendererFailure = isRecoverableDevRendererFailure(
        failedUrl,
        errorCode
      )
      recordRendererEvent('main-window-did-fail-load', {
        errorCode,
        errorDescription,
        url: failedUrl,
        recoverableDevRendererFailure
      })
      void appendRendererDiagnostics('did-fail-load', {
        errorCode,
        errorDescription,
        url: failedUrl,
        recoverableDevRendererFailure,
        isMainFrame
      })
      scheduleMainWindowRecovery(`did-fail-load (${errorCode}: ${errorDescription})`)
      if (!recoverableDevRendererFailure) {
        showError(t('dialog.appInitFailed'), `${errorDescription} (${errorCode})`)
      }
    })
    mainWindow.on('unresponsive', () => {
      recordRendererEvent('main-window-unresponsive')
      void appendRendererDiagnostics('window-unresponsive', {})
      scheduleMainWindowRecovery('window-unresponsive')
    })
    mainWindow.on('responsive', () => {
      recordRendererEvent('main-window-responsive')
    })
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') {
        return
      }

      recordRendererEvent('render-process-gone', {
        reason: details.reason,
        exitCode: details.exitCode
      })
      void (async () => {
        if (details.reason === 'oom' || details.reason === 'crashed') {
          await handleRendererCrash(details.reason, details.exitCode)
        } else {
          await appendRendererDiagnostics('render-process-gone', {
            reason: details.reason,
            exitCode: details.exitCode
          })
        }
      })()

      scheduleMainWindowRecovery(`render-process-gone (${details.reason})`)
    })

    mainWindow.webContents.on('did-finish-load', () => {
      markRendererRecovered('did-finish-load')
    })

    mainWindow.webContents.once('did-finish-load', () => {
      recordRendererEvent('main-window-did-finish-load', {
        url: mainWindow?.webContents.isDestroyed() ? null : mainWindow?.webContents.getURL()
      })
      if (pendingDeepLink) {
        const url = pendingDeepLink
        pendingDeepLink = null
        setTimeout(() => {
          handleDeepLink(url)
        }, 500)
      }
    })
    mainWindow.on('close', async (event) => {
      event.preventDefault()
      mainWindow?.hide()
      if (windowShown) {
        await scheduleLightweightMode()
      }
    })

    mainWindow.on('closed', () => {
      recordRendererEvent('main-window-closed')
      if (mainWindowRecoveryTimeout) {
        clearTimeout(mainWindowRecoveryTimeout)
        mainWindowRecoveryTimeout = null
      }
      mainWindow = null
    })

    mainWindow.on('resized', () => {
      if (mainWindow) mainWindowState.saveState(mainWindow)
    })

    mainWindow.on('unmaximize', () => {
      if (mainWindow) mainWindowState.saveState(mainWindow)
      mainWindow?.webContents.send('window-unmaximized')
    })

    mainWindow.on('move', () => {
      if (mainWindow) mainWindowState.saveState(mainWindow)
    })

    mainWindow.on('session-end', async () => {
      triggerSysProxy(false, false)
      await stopCore()
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })
    await loadRendererWindow(mainWindow)
  } finally {
    isCreatingWindow = false
    if (createWindowPromiseResolve) {
      createWindowPromiseResolve()
      createWindowPromiseResolve = null
    }
    createWindowPromise = null
  }
}

export async function triggerMainWindow(): Promise<void> {
  if (mainWindow && mainWindow.isVisible()) {
    closeMainWindow()
  } else {
    await showMainWindow()
  }
}

export async function showMainWindow(): Promise<void> {
  if (quitTimeout) {
    clearTimeout(quitTimeout)
  }
  if (process.platform === 'darwin' && app.dock) {
    const { useDockIcon = true } = await getAppConfig()
    if (!useDockIcon) {
      app.dock.hide()
    }
  }
  if (mainWindow) {
    windowShown = true
    mainWindow.show()
    mainWindow.focusOnWebView()
  } else {
    await createWindow()
    if (mainWindow !== null) {
      windowShown = true
      ;(mainWindow as BrowserWindow).show()
      ;(mainWindow as BrowserWindow).focusOnWebView()
    }
  }
}

export function closeMainWindow(): void {
  if (mainWindow) {
    mainWindow.close()
  }
}
