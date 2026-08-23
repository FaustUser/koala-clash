import axios, { AxiosInstance } from 'axios'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { mainWindow } from '..'
import WebSocket from 'ws'
import { tray } from '../resolve/tray'
import { calcTraffic } from '../utils/calc'
import { generateProfile, getRuntimeConfig } from './factory'
import { floatingWindow } from '../resolve/floatingWindow'
import { mihomoIpcPath } from '../utils/dirs'
import type { BrowserWindow } from 'electron'
import { getRuntimeProfileProxies, getRuntimeProfileProxyFallbacks } from './proxyList'

let axiosIns: AxiosInstance = null!
let mihomoTrafficWs: WebSocket | null = null
let trafficRetry = 10
let mihomoMemoryWs: WebSocket | null = null
let memoryRetry = 10
let mihomoLogsWs: WebSocket | null = null
let logsRetry = 10
let mihomoConnectionsWs: WebSocket | null = null
let connectionsRetry = 10
let latestConnectionsPayload: ControllerConnections | null = null
let connectionsFlushTimer: NodeJS.Timeout | null = null

const CONNECTIONS_FLUSH_INTERVAL_MS = 250

function canSendToWindow(window: BrowserWindow | null): boolean {
  if (!window) {
    return false
  }

  if (window.isDestroyed()) {
    return false
  }

  const { webContents } = window
  if (webContents.isDestroyed() || webContents.isLoadingMainFrame()) {
    return false
  }

  try {
    return !webContents.mainFrame.isDestroyed()
  } catch {
    return false
  }
}

function sendToWindow<T>(window: BrowserWindow | null, channel: string, payload: T): void {
  if (!window || !canSendToWindow(window)) {
    return
  }

  try {
    window.webContents.send(channel, payload)
  } catch {
    // ignore
  }
}

function flushConnectionsPayload(): void {
  connectionsFlushTimer = null

  if (!latestConnectionsPayload) {
    return
  }

  sendToWindow(mainWindow, 'mihomoConnections', latestConnectionsPayload)
  latestConnectionsPayload = null
}

export const getAxios = async (force: boolean = false): Promise<AxiosInstance> => {
  const currentSocketPath = mihomoIpcPath()

  if (axiosIns && axiosIns.defaults.socketPath !== currentSocketPath) {
    force = true
  }

  if (axiosIns && !force) return axiosIns

  axiosIns = axios.create({
    baseURL: `http://localhost`,
    socketPath: currentSocketPath,
    timeout: 15000
  })

  axiosIns.interceptors.response.use(
    (response) => {
      return response.data
    },
    (error) => {
      if (error.response && error.response.data) {
        return Promise.reject(error.response.data)
      }
      return Promise.reject(error)
    }
  )
  return axiosIns
}

export async function mihomoVersion(): Promise<ControllerVersion> {
  const instance = await getAxios()
  return await instance.get('/version')
}

export const mihomoConfig = async (): Promise<ControllerConfigs> => {
  const instance = await getAxios()
  return await instance.get('/configs')
}

export const patchMihomoConfig = async (patch: Partial<ControllerConfigs>): Promise<void> => {
  const instance = await getAxios()
  return await instance.patch('/configs', patch)
}

export const mihomoCloseConnection = async (id: string): Promise<void> => {
  const instance = await getAxios()
  return await instance.delete(`/connections/${encodeURIComponent(id)}`)
}

export const mihomoGetConnections = async (): Promise<ControllerConnections> => {
  const instance = await getAxios()
  return await instance.get('/connections')
}

export const mihomoCloseAllConnections = async (name?: string): Promise<void> => {
  const instance = await getAxios()
  if (name) {
    const connectionsInfo = await mihomoGetConnections()
    const targetConnections =
      connectionsInfo?.connections?.filter((conn) => conn.chains && conn.chains.includes(name)) ||
      []
    for (const conn of targetConnections) {
      try {
        await mihomoCloseConnection(conn.id)
      } catch (error) {
        // ignore
      }
    }
  } else {
    return await instance.delete('/connections')
  }
}

export const mihomoRules = async (): Promise<ControllerRules> => {
  const instance = await getAxios()
  return await instance.get('/rules')
}

export const mihomoProxies = async (): Promise<ControllerProxies> => {
  const instance = await getAxios()
  return await instance.get('/proxies')
}

async function getAvailableRuntimeConfig(): Promise<MihomoConfig | undefined> {
  let runtime = await getRuntimeConfig()
  if (!runtime) {
    try {
      await generateProfile()
    } catch {
      return undefined
    }
    runtime = await getRuntimeConfig()
  }

  return runtime
}

export const mihomoProfileProxies = async (): Promise<ControllerProxiesDetail[]> => {
  const runtime = await getAvailableRuntimeConfig()
  const runtimeProxies =
    runtime?.proxies as
      | { name?: unknown; type?: unknown; serverDescription?: unknown }[]
      | undefined

  try {
    const proxies = await mihomoProxies()
    return getRuntimeProfileProxies(proxies, runtimeProxies)
  } catch {
    return getRuntimeProfileProxyFallbacks(runtimeProxies)
  }
}

function normalizeRuntimeGroupType(type: unknown): MihomoProxyType {
  if (typeof type !== 'string') return 'Selector'

  switch (type.toLowerCase()) {
    case 'select':
    case 'selector':
      return 'Selector'
    case 'fallback':
      return 'Fallback'
    case 'url-test':
    case 'urltest':
      return 'URLTest'
    case 'load-balance':
    case 'loadbalance':
      return 'LoadBalance'
    case 'relay':
      return 'Relay'
    default:
      return 'Selector'
  }
}

function makeFallbackProxyDetail(
  name: string,
  type: MihomoProxyType = 'Compatible'
): ControllerProxiesDetail {
  return {
    alive: true,
    extra: {},
    history: [],
    id: name,
    name,
    tfo: false,
    type,
    udp: false,
    xudp: false,
    'dialer-proxy': '',
    interface: '',
    mptcp: false,
    'routing-mark': 0,
    smux: false,
    uot: false
  }
}

function getRuntimeProxyFallbackMap(
  runtime: MihomoConfig | undefined
): Map<string, ControllerProxiesDetail> {
  const proxies = getRuntimeProfileProxyFallbacks(
    runtime?.proxies as
      | { name?: unknown; type?: unknown; serverDescription?: unknown }[]
      | undefined
  )

  return new Map(proxies.map((proxy) => [proxy.name, proxy]))
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function buildRuntimeGroupFallbacks(runtime: MihomoConfig | undefined): ControllerMixedGroup[] {
  const groups = Array.isArray(runtime?.['proxy-groups'])
    ? (runtime?.['proxy-groups'] as unknown[])
    : []
  const proxyMap = getRuntimeProxyFallbackMap(runtime)

  return groups
    .filter((group): group is Record<string, unknown> => !!group && typeof group === 'object')
    .map((group) => {
      const name = typeof group.name === 'string' ? group.name.trim() : ''
      const proxyNames = getStringArray(group.proxies)
      const type = normalizeRuntimeGroupType(group.type)
      const all = proxyNames.map(
        (proxyName) => proxyMap.get(proxyName) || makeFallbackProxyDetail(proxyName)
      )

      return {
        alive: true,
        all,
        extra: {},
        hidden: false,
        history: [],
        icon: typeof group.icon === 'string' ? group.icon : '',
        interface: '',
        mptcp: false,
        name,
        now: proxyNames[0] || name,
        smux: false,
        testUrl: typeof group.url === 'string' ? group.url : undefined,
        tfo: false,
        type,
        udp: true,
        uot: false,
        xudp: false,
        expectedStatus:
          typeof group['expected-status'] === 'string' ? group['expected-status'] : undefined
      }
    })
    .filter((group) => group.name && !group.hidden)
}

export const mihomoGroups = async (): Promise<ControllerMixedGroup[]> => {
  const { mode = 'rule' } = await getControledMihomoConfig()
  if (mode === 'direct') return []
  const runtime = await getAvailableRuntimeConfig()
  let proxies: ControllerProxies

  try {
    proxies = await mihomoProxies()
  } catch {
    return buildRuntimeGroupFallbacks(runtime)
  }

  const serverDescriptionMap = new Map<string, string>()
  if (runtime?.proxies) {
    for (const p of runtime.proxies as { name?: string; serverDescription?: string }[]) {
      if (p.name && p.serverDescription) {
        serverDescriptionMap.set(p.name, p.serverDescription)
      }
    }
  }

  const enrichProxy = (
    proxy: ControllerProxiesDetail | ControllerGroupDetail
  ): ControllerProxiesDetail | ControllerGroupDetail => {
    if (!('all' in proxy)) {
      const desc = serverDescriptionMap.get(proxy.name)
      if (desc) {
        proxy.serverDescription = desc
      }
    }
    return proxy
  }

  const groups: ControllerMixedGroup[] = []
  runtime?.['proxy-groups']?.forEach((group: { name: string; url?: string }) => {
    const { name, url } = group
    if (proxies.proxies[name] && 'all' in proxies.proxies[name] && !proxies.proxies[name].hidden) {
      const newGroup = proxies.proxies[name]
      newGroup.testUrl = url
      const newAll = newGroup.all.map((name) => enrichProxy(proxies.proxies[name]))
      groups.push({ ...newGroup, all: newAll })
    }
  })
  if (!groups.find((group) => group.name === 'GLOBAL') && mode === 'global') {
    const newGlobal = proxies.proxies['GLOBAL'] as ControllerGroupDetail
    if (!newGlobal.hidden) {
      const newAll = newGlobal.all.map((name) => enrichProxy(proxies.proxies[name]))
      groups.push({ ...newGlobal, all: newAll })
    }
  }
  if (mode === 'global') {
    const global = groups.findIndex((group) => group.name === 'GLOBAL')
    groups.unshift(groups.splice(global, 1)[0])
  }
  return groups
}

export const mihomoProxyProviders = async (): Promise<ControllerProxyProviders> => {
  const instance = await getAxios()
  return await instance.get('/providers/proxies')
}

export const mihomoUpdateProxyProviders = async (name: string): Promise<void> => {
  const instance = await getAxios()
  return await instance.put(`/providers/proxies/${encodeURIComponent(name)}`)
}

export const mihomoRuleProviders = async (): Promise<ControllerRuleProviders> => {
  const instance = await getAxios()
  return await instance.get('/providers/rules')
}

export const mihomoUpdateRuleProviders = async (name: string): Promise<void> => {
  const instance = await getAxios()
  return await instance.put(`/providers/rules/${encodeURIComponent(name)}`)
}

export const mihomoChangeProxy = async (
  group: string,
  proxy: string
): Promise<ControllerProxiesDetail> => {
  const instance = await getAxios()
  return await instance.put(`/proxies/${encodeURIComponent(group)}`, { name: proxy })
}

export const mihomoUnfixedProxy = async (group: string): Promise<ControllerProxiesDetail> => {
  const instance = await getAxios()
  return await instance.delete(`/proxies/${encodeURIComponent(group)}`)
}

export const mihomoProxyDelay = async (
  proxy: string,
  url?: string
): Promise<ControllerProxiesDelay> => {
  const appConfig = await getAppConfig()
  const { delayTestUrl, delayTestTimeout } = appConfig
  const instance = await getAxios()
  return await instance.get(`/proxies/${encodeURIComponent(proxy)}/delay`, {
    params: {
      url: url || delayTestUrl || 'https://www.gstatic.com/generate_204',
      timeout: delayTestTimeout || 5000
    }
  })
}

export const mihomoGroupDelay = async (
  group: string,
  url?: string
): Promise<ControllerGroupDelay> => {
  const appConfig = await getAppConfig()
  const { delayTestUrl, delayTestTimeout } = appConfig
  const instance = await getAxios()
  return await instance.get(`/group/${encodeURIComponent(group)}/delay`, {
    params: {
      url: url || delayTestUrl || 'https://www.gstatic.com/generate_204',
      timeout: delayTestTimeout || 5000
    }
  })
}

export const mihomoUpgrade = async (): Promise<void> => {
  if (process.platform === 'win32') await patchMihomoConfig({ 'log-level': 'info' })
  const instance = await getAxios()
  return await instance.post('/upgrade')
}

export const mihomoUpgradeGeo = async (): Promise<void> => {
  const instance = await getAxios()
  return await instance.post('/upgrade/geo')
}

export const mihomoUpgradeUI = async (): Promise<void> => {
  const instance = await getAxios()
  return await instance.post('/upgrade/ui')
}

export const startMihomoTraffic = async (): Promise<void> => {
  await mihomoTraffic()
}

export const stopMihomoTraffic = (): void => {
  if (mihomoTrafficWs) {
    mihomoTrafficWs.removeAllListeners()
    if (mihomoTrafficWs.readyState === WebSocket.OPEN) {
      mihomoTrafficWs.close()
    }
    mihomoTrafficWs = null
  }
}

const mihomoTraffic = async (): Promise<void> => {
  mihomoTrafficWs = new WebSocket(`ws+unix:${mihomoIpcPath()}:/traffic`)

  mihomoTrafficWs.onmessage = async (e): Promise<void> => {
    const data = e.data as string
    const json = JSON.parse(data) as ControllerTraffic
    trafficRetry = 10
    sendToWindow(mainWindow, 'mihomoTraffic', json)
    if (process.platform !== 'linux') {
      tray?.setToolTip(
        '\u2191' +
          `${calcTraffic(json.up)}/s`.padStart(9) +
          '\n\u2193' +
          `${calcTraffic(json.down)}/s`.padStart(9)
      )
    }
    sendToWindow(floatingWindow, 'mihomoTraffic', json)
  }

  mihomoTrafficWs.onclose = (): void => {
    if (trafficRetry) {
      trafficRetry--
      mihomoTraffic()
    }
  }

  mihomoTrafficWs.onerror = (): void => {
    if (mihomoTrafficWs) {
      mihomoTrafficWs.close()
      mihomoTrafficWs = null
    }
  }
}

export const startMihomoMemory = async (): Promise<void> => {
  await mihomoMemory()
}

export const stopMihomoMemory = (): void => {
  if (mihomoMemoryWs) {
    mihomoMemoryWs.removeAllListeners()
    if (mihomoMemoryWs.readyState === WebSocket.OPEN) {
      mihomoMemoryWs.close()
    }
    mihomoMemoryWs = null
  }
}

const mihomoMemory = async (): Promise<void> => {
  mihomoMemoryWs = new WebSocket(`ws+unix:${mihomoIpcPath()}:/memory`)

  mihomoMemoryWs.onmessage = (e): void => {
    const data = e.data as string
    memoryRetry = 10
    sendToWindow(mainWindow, 'mihomoMemory', JSON.parse(data) as ControllerMemory)
  }

  mihomoMemoryWs.onclose = (): void => {
    if (memoryRetry) {
      memoryRetry--
      mihomoMemory()
    }
  }

  mihomoMemoryWs.onerror = (): void => {
    if (mihomoMemoryWs) {
      mihomoMemoryWs.close()
      mihomoMemoryWs = null
    }
  }
}

export const startMihomoLogs = async (): Promise<void> => {
  await mihomoLogs()
}

export const stopMihomoLogs = (): void => {
  if (mihomoLogsWs) {
    mihomoLogsWs.removeAllListeners()
    if (mihomoLogsWs.readyState === WebSocket.OPEN) {
      mihomoLogsWs.close()
    }
    mihomoLogsWs = null
  }
}

const mihomoLogs = async (): Promise<void> => {
  const { 'log-level': logLevel = 'info' } = await getControledMihomoConfig()

  mihomoLogsWs = new WebSocket(`ws+unix:${mihomoIpcPath()}:/logs?level=${logLevel}`)

  mihomoLogsWs.onmessage = (e): void => {
    const data = e.data as string
    logsRetry = 10
    sendToWindow(mainWindow, 'mihomoLogs', JSON.parse(data) as ControllerLog)
  }

  mihomoLogsWs.onclose = (): void => {
    if (logsRetry) {
      logsRetry--
      mihomoLogs()
    }
  }

  mihomoLogsWs.onerror = (): void => {
    if (mihomoLogsWs) {
      mihomoLogsWs.close()
      mihomoLogsWs = null
    }
  }
}

export const startMihomoConnections = async (): Promise<void> => {
  await mihomoConnections()
}

export const stopMihomoConnections = (): void => {
  latestConnectionsPayload = null
  if (connectionsFlushTimer) {
    clearTimeout(connectionsFlushTimer)
    connectionsFlushTimer = null
  }
  if (mihomoConnectionsWs) {
    mihomoConnectionsWs.removeAllListeners()
    if (mihomoConnectionsWs.readyState === WebSocket.OPEN) {
      mihomoConnectionsWs.close()
    }
    mihomoConnectionsWs = null
  }
}

export const restartMihomoConnections = async (): Promise<void> => {
  stopMihomoConnections()
  await startMihomoConnections()
}

const mihomoConnections = async (): Promise<void> => {
  const { connectionInterval = 500 } = await getAppConfig()
  mihomoConnectionsWs = new WebSocket(
    `ws+unix:${mihomoIpcPath()}:/connections?interval=${connectionInterval}`
  )

  mihomoConnectionsWs.onmessage = (e): void => {
    const data = e.data as string
    connectionsRetry = 10
    latestConnectionsPayload = JSON.parse(data) as ControllerConnections
    if (!connectionsFlushTimer) {
      connectionsFlushTimer = setTimeout(flushConnectionsPayload, CONNECTIONS_FLUSH_INTERVAL_MS)
    }
  }

  mihomoConnectionsWs.onclose = (): void => {
    if (connectionsRetry) {
      connectionsRetry--
      mihomoConnections()
    }
  }

  mihomoConnectionsWs.onerror = (): void => {
    if (mihomoConnectionsWs) {
      mihomoConnectionsWs.close()
      mihomoConnectionsWs = null
    }
  }
}
