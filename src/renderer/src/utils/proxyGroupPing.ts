export type ProxyPingStatus = 'idle' | 'testing' | 'ok' | 'timeout' | 'error'

export interface ProxyPingResult {
  status: ProxyPingStatus
  delay?: number
  message?: string
}

function getLatestDelay(
  proxy: ControllerProxiesDetail | ControllerGroupDetail | undefined
): number | undefined {
  if (!proxy?.history.length) return undefined
  return proxy.history[proxy.history.length - 1].delay
}

function toStoredPingResult(delay: number | undefined): ProxyPingResult {
  if (delay === undefined) return { status: 'idle' }
  if (delay <= 0) return { status: 'timeout' }
  return { status: 'ok', delay }
}

export function buildProxyPingResults(
  proxyNames: string[],
  controllerProxies: ControllerProxies | undefined
): Record<string, ProxyPingResult> {
  const results: Record<string, ProxyPingResult> = {}

  for (const proxyName of proxyNames) {
    results[proxyName] = toStoredPingResult(getLatestDelay(controllerProxies?.proxies[proxyName]))
  }

  return results
}

export function toProxyPingResult(result: ControllerProxiesDelay): ProxyPingResult {
  if (result.delay === undefined || result.delay <= 0) return { status: 'timeout' }
  return { status: 'ok', delay: result.delay }
}

export function toProxyPingError(error: unknown): ProxyPingResult {
  return {
    status: 'error',
    message: error instanceof Error ? error.message : `${error}`
  }
}

export function proxyPingToneClassName(result: ProxyPingResult | undefined): string {
  if (!result || result.status === 'idle' || result.status === 'testing') return 'text-primary'
  if (result.status === 'timeout' || result.status === 'error') return 'text-destructive'
  if ((result.delay ?? 0) < 500) return 'text-success'
  return 'text-warning'
}
