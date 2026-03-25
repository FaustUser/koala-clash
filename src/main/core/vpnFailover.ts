import { ipcMain } from 'electron'
import { mainWindow } from '..'
import {
  changeCurrentProfile,
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import {
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoGroups,
  mihomoProxyDelay
} from './mihomoApi'
import { restartCore } from './manager'
import { triggerSysProxy } from '../sys/sysproxy'

const CHECK_INTERVAL_MS = 20000
const FAILURE_THRESHOLD = 2
const ACTION_COOLDOWN_MS = 30000
const BUILTIN_PROXY_TYPES = new Set<MihomoProxyType>([
  'Direct',
  'Reject',
  'RejectDrop',
  'Compatible',
  'Pass',
  'Dns'
])

let vpnServerFailoverTimer: NodeJS.Timeout | null = null
let checkInProgress = false
let actionInProgress = false
let suspendedUntil = 0
const failureCountByTarget = new Map<string, number>()

interface MonitoredTarget {
  groupName: string
  proxyName: string
  testUrl?: string
}

function isLeafProxy(
  proxy: ControllerProxiesDetail | ControllerGroupDetail
): proxy is ControllerProxiesDetail {
  return !('all' in proxy)
}

function isVpnCandidate(
  proxy: ControllerProxiesDetail | ControllerGroupDetail | undefined
): proxy is ControllerProxiesDetail {
  return !!proxy && isLeafProxy(proxy) && !BUILTIN_PROXY_TYPES.has(proxy.type)
}

function getTargetKey(target: MonitoredTarget): string {
  return `${target.groupName}::${target.proxyName}`
}

function notifyConfigChanged(...channels: string[]): void {
  for (const channel of channels) {
    mainWindow?.webContents.send(channel)
  }
}

async function updateTrayState(): Promise<void> {
  ipcMain.emit('updateTrayMenu')
  try {
    const trayModule = await import('../resolve/tray')
    await trayModule.updateTrayIcon()
  } catch {
    // ignore
  }
}

async function isVpnEnabled(): Promise<boolean> {
  const [appConfig, controledConfig] = await Promise.all([getAppConfig(), getControledMihomoConfig()])
  return Boolean(appConfig.sysProxy.enable || controledConfig.tun?.enable)
}

async function collectMonitoredTargets(): Promise<MonitoredTarget[]> {
  const groups = await mihomoGroups()
  const targets: MonitoredTarget[] = []

  for (const group of groups) {
    const current = group.all.find((candidate) => candidate.name === group.now)
    if (!isVpnCandidate(current)) {
      continue
    }

    targets.push({
      groupName: group.name,
      proxyName: current.name,
      testUrl: group.testUrl
    })
  }

  return targets
}

async function isTargetHealthy(target: MonitoredTarget): Promise<boolean> {
  try {
    const result = await mihomoProxyDelay(target.proxyName, target.testUrl)
    return typeof result.delay === 'number' && result.delay > 0
  } catch {
    return false
  }
}

async function evaluateCurrentTargets(): Promise<{ failedGroupNames: string[]; healthy: boolean }> {
  const targets = await collectMonitoredTargets()
  const seenKeys = new Set<string>()
  const failedGroupNames: string[] = []

  for (const target of targets) {
    const key = getTargetKey(target)
    seenKeys.add(key)

    const healthy = await isTargetHealthy(target)
    if (healthy) {
      failureCountByTarget.set(key, 0)
      continue
    }

    const nextCount = (failureCountByTarget.get(key) ?? 0) + 1
    failureCountByTarget.set(key, nextCount)
    if (nextCount >= FAILURE_THRESHOLD) {
      failedGroupNames.push(target.groupName)
    }
  }

  for (const key of [...failureCountByTarget.keys()]) {
    if (!seenKeys.has(key)) {
      failureCountByTarget.delete(key)
    }
  }

  return {
    failedGroupNames,
    healthy: failedGroupNames.length === 0
  }
}

async function waitForGroupsReady(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await mihomoGroups()
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
}

async function disconnectVpnDirect(): Promise<void> {
  const [appConfig, controledConfig] = await Promise.all([getAppConfig(), getControledMihomoConfig()])
  const { onlyActiveDevice = false, sysProxy } = appConfig
  const tunEnabled = controledConfig.tun?.enable ?? false

  if (sysProxy.enable) {
    await triggerSysProxy(false, onlyActiveDevice)
    await patchAppConfig({ sysProxy: { enable: false } })
    notifyConfigChanged('appConfigUpdated')
  }

  if (tunEnabled) {
    await patchControledMihomoConfig({ tun: { enable: false } })
    notifyConfigChanged('controledMihomoConfigUpdated')
    await restartCore()
  }

  await updateTrayState()
}

async function tryProfileTarget(target: VpnServerFailoverTarget): Promise<boolean> {
  if (!target.profileId) return false

  const profileConfig = await import('../config/profile').then((module) => module.getProfileConfig())
  if (profileConfig.current === target.profileId) {
    return false
  }

  await changeCurrentProfile(target.profileId)
  notifyConfigChanged('profileConfigUpdated')
  await waitForGroupsReady()

  const evaluation = await evaluateCurrentTargets()
  if (evaluation.healthy) {
    await updateTrayState()
    return true
  }

  return false
}

async function tryGroupProxyTarget(
  target: VpnServerFailoverTarget,
  failedGroupNames: string[]
): Promise<boolean> {
  if (!target.groupName || !target.proxyName) return false
  if (!failedGroupNames.includes(target.groupName)) return false

  const groups = await mihomoGroups()
  const targetGroup = groups.find((group) => group.name === target.groupName)
  if (!targetGroup) return false
  if (targetGroup.now === target.proxyName) return false

  const proxy = targetGroup.all.find(
    (candidate) => candidate.name === target.proxyName && isLeafProxy(candidate)
  )
  if (!isVpnCandidate(proxy)) return false

  await mihomoChangeProxy(target.groupName, target.proxyName)

  const { autoCloseConnection = false } = await getAppConfig()
  if (autoCloseConnection) {
    await mihomoCloseAllConnections()
  }

  notifyConfigChanged('groupsUpdated')

  const healthy = await isTargetHealthy({
    groupName: target.groupName,
    proxyName: target.proxyName,
    testUrl: targetGroup.testUrl
  })

  if (!healthy) {
    return false
  }

  const evaluation = await evaluateCurrentTargets()
  if (evaluation.healthy) {
    await updateTrayState()
    return true
  }

  return false
}

async function tryFailoverTargets(
  targets: VpnServerFailoverTarget[],
  failedGroupNames: string[]
): Promise<boolean> {
  for (const target of targets) {
    try {
      if (target.type === 'profile' && (await tryProfileTarget(target))) {
        return true
      }

      if (target.type === 'groupProxy' && (await tryGroupProxyTarget(target, failedGroupNames))) {
        return true
      }
    } catch {
      // ignore and continue to the next target
    }
  }

  return false
}

async function runVpnServerFailoverCheck(): Promise<void> {
  if (checkInProgress || actionInProgress || Date.now() < suspendedUntil) {
    return
  }

  checkInProgress = true
  try {
    const appConfig = await getAppConfig()
    const targets = appConfig.vpnServerFailoverTargets ?? []
    const shouldDisconnect = appConfig.disconnectOnVpnServerUnavailable ?? false

    if (!shouldDisconnect && targets.length === 0) {
      failureCountByTarget.clear()
      return
    }

    if (!(await isVpnEnabled())) {
      failureCountByTarget.clear()
      return
    }

    const evaluation = await evaluateCurrentTargets()
    if (evaluation.healthy) {
      return
    }

    actionInProgress = true
    try {
      let handled = false

      if (targets.length > 0) {
        handled = await tryFailoverTargets(targets, evaluation.failedGroupNames)
      } else if (shouldDisconnect) {
        await disconnectVpnDirect()
        handled = true
      }

      if (handled) {
        failureCountByTarget.clear()
        suspendedUntil = Date.now() + ACTION_COOLDOWN_MS
      }
    } finally {
      actionInProgress = false
    }
  } catch {
    // ignore transient controller errors
  } finally {
    checkInProgress = false
  }
}

export async function startVpnServerFailoverMonitor(): Promise<void> {
  if (vpnServerFailoverTimer) {
    clearInterval(vpnServerFailoverTimer)
  }

  vpnServerFailoverTimer = setInterval(() => {
    void runVpnServerFailoverCheck()
  }, CHECK_INTERVAL_MS)
}

export async function stopVpnServerFailoverMonitor(): Promise<void> {
  if (vpnServerFailoverTimer) {
    clearInterval(vpnServerFailoverTimer)
    vpnServerFailoverTimer = null
  }
  failureCountByTarget.clear()
}
