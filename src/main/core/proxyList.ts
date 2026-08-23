interface RuntimeProxyRecord {
  name?: unknown
  type?: unknown
  serverDescription?: unknown
}

function isLeafProxy(
  proxy: ControllerProxiesDetail | ControllerGroupDetail | undefined
): proxy is ControllerProxiesDetail {
  return !!proxy && !('all' in proxy)
}

export function getRuntimeProfileProxies(
  controllerProxies: ControllerProxies,
  runtimeProxies: RuntimeProxyRecord[] | undefined
): ControllerProxiesDetail[] {
  if (!Array.isArray(runtimeProxies)) return []

  const result: ControllerProxiesDetail[] = []
  const seen = new Set<string>()

  for (const runtimeProxy of runtimeProxies) {
    if (typeof runtimeProxy.name !== 'string') continue
    const proxyName = runtimeProxy.name.trim()
    if (!proxyName || seen.has(proxyName)) continue

    const controllerProxy = controllerProxies.proxies[proxyName]
    if (!isLeafProxy(controllerProxy)) continue

    seen.add(proxyName)
    const serverDescription =
      typeof runtimeProxy.serverDescription === 'string'
        ? runtimeProxy.serverDescription.trim()
        : ''
    result.push({
      ...controllerProxy,
      ...(serverDescription ? { serverDescription } : {})
    })
  }

  return result
}

export function getRuntimeProfileProxyFallbacks(
  runtimeProxies: RuntimeProxyRecord[] | undefined
): ControllerProxiesDetail[] {
  if (!Array.isArray(runtimeProxies)) return []

  const result: ControllerProxiesDetail[] = []
  const seen = new Set<string>()

  for (const runtimeProxy of runtimeProxies) {
    if (typeof runtimeProxy.name !== 'string') continue
    const proxyName = runtimeProxy.name.trim()
    if (!proxyName || seen.has(proxyName)) continue

    seen.add(proxyName)
    const serverDescription =
      typeof runtimeProxy.serverDescription === 'string'
        ? runtimeProxy.serverDescription.trim()
        : ''
    const proxyType =
      typeof runtimeProxy.type === 'string' && runtimeProxy.type.trim()
        ? runtimeProxy.type.trim()
        : 'Compatible'

    result.push({
      alive: true,
      extra: {},
      history: [],
      id: proxyName,
      name: proxyName,
      tfo: false,
      type: proxyType as MihomoProxyType,
      udp: false,
      xudp: false,
      'dialer-proxy': '',
      interface: '',
      mptcp: false,
      'routing-mark': 0,
      smux: false,
      uot: false,
      ...(serverDescription ? { serverDescription } : {})
    })
  }

  return result
}
