import http from 'http'
import type { Socket } from 'net'

const PROXY_HOST = '127.0.0.1'
const REQUEST_TIMEOUT_MS = 5000
const CONNECTION_POLL_INTERVAL_MS = 50
const CONNECTION_POLL_TIMEOUT_MS = 9000
const POST_REQUEST_GRACE_MS = 1500
const RESPONSE_HOLD_MS = 1000
const TEST_USER_AGENT = 'Koala Clash Rule Tester'

interface ProbeResult {
  statusCode?: number
  statusMessage?: string
  requestError?: string
}

interface TestRequestState {
  done: boolean
  doneAt: number | null
  proxySourcePort?: string
}

async function getMihomoConfig(): Promise<ControllerConfigs> {
  const { mihomoConfig } = await import('./mihomoApi')
  return await mihomoConfig()
}

async function getMihomoConnections(): Promise<ControllerConnections> {
  const { mihomoGetConnections } = await import('./mihomoApi')
  return await mihomoGetConnections()
}

async function getMihomoRules(): Promise<ControllerRules> {
  const { mihomoRules } = await import('./mihomoApi')
  return await mihomoRules()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function finishOnce<T>(resolve: (value: T) => void, cleanup: () => void): (value: T) => void {
  let settled = false

  return (value: T) => {
    if (settled) return
    settled = true
    cleanup()
    resolve(value)
  }
}

function normalizeTestUrl(input: string): URL {
  const trimmed = input.trim()

  if (!trimmed) {
    throw new Error('URL is required')
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
  const parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}`)
  }

  if (!parsed.hostname) {
    throw new Error('URL hostname is required')
  }

  return parsed
}

function getTestProxyPort(config: ControllerConfigs): number {
  const candidates = [config['mixed-port'], config.port].filter(
    (value): value is number => typeof value === 'number' && value > 0
  )

  const proxyPort = candidates[0]

  if (!proxyPort) {
    throw new Error('Mixed or HTTP proxy port must be enabled to test rules')
  }

  return proxyPort
}

function getTargetPort(url: URL): number {
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

function bindProxySourcePort(request: http.ClientRequest, requestState: TestRequestState): void {
  request.on('socket', (socket) => {
    const assignLocalPort = (): void => {
      if (socket.localPort) {
        requestState.proxySourcePort = socket.localPort.toString()
      }
    }

    if (socket.connecting) {
      socket.once('connect', assignLocalPort)
      return
    }

    assignLocalPort()
  })
}

async function performHttpProxyProbe(
  url: URL,
  proxyPort: number,
  requestState: TestRequestState
): Promise<ProbeResult> {
  return await new Promise((resolve) => {
    let timeout: NodeJS.Timeout | null = null

    const request = http.request(
      {
        host: PROXY_HOST,
        port: proxyPort,
        method: 'GET',
        path: url.toString(),
        headers: {
          Host: url.host,
          Accept: '*/*',
          Connection: 'close',
          'Proxy-Connection': 'close',
          'User-Agent': TEST_USER_AGENT
        }
      },
      (response) => {
        response.pause()
        setTimeout(
          () => {
            response.destroy()
            finish({
              statusCode: response.statusCode,
              statusMessage: response.statusMessage
            })
          },
          RESPONSE_HOLD_MS
        )
      }
    )

    const finish = finishOnce(resolve, () => {
      if (timeout) {
        clearTimeout(timeout)
      }
    })

    bindProxySourcePort(request, requestState)

    timeout = setTimeout(() => {
      request.destroy(new Error('Test request timed out'))
    }, REQUEST_TIMEOUT_MS)

    request.on('error', (error) => {
      finish({ requestError: error.message })
    })

    request.end()
  })
}

export async function performHttpsProxyProbe(
  url: URL,
  proxyPort: number,
  requestState: TestRequestState
): Promise<ProbeResult> {
  return await new Promise((resolve) => {
    let timeout: NodeJS.Timeout | null = null
    let tunnelSocket: Socket | null = null
    let holdTimer: NodeJS.Timeout | null = null

    const finish = finishOnce(resolve, () => {
      if (timeout) {
        clearTimeout(timeout)
      }
      if (holdTimer) {
        clearTimeout(holdTimer)
      }
      tunnelSocket?.destroy()
    })

    const request = http.request({
      host: PROXY_HOST,
      port: proxyPort,
      method: 'CONNECT',
      path: `${url.hostname}:${getTargetPort(url)}`,
      headers: {
        Host: url.host,
        'Proxy-Connection': 'close',
        'User-Agent': TEST_USER_AGENT
      }
    })

    bindProxySourcePort(request, requestState)

    timeout = setTimeout(() => {
      request.destroy(new Error('Test request timed out'))
      tunnelSocket?.destroy(new Error('Test request timed out'))
    }, REQUEST_TIMEOUT_MS)

    request.on('connect', (response, socket, head) => {
      if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
        socket.destroy()
        finish({
          statusCode: response.statusCode,
          statusMessage: response.statusMessage
        })
        return
      }

      tunnelSocket = socket

      if (head.length > 0) {
        socket.unshift(head)
      }

      socket.pause()
      holdTimer = setTimeout(() => {
        finish({
          statusCode: response.statusCode,
          statusMessage: response.statusMessage
        })
      }, RESPONSE_HOLD_MS)
    })

    request.on('response', (response) => {
      response.resume()
      finish({
        statusCode: response.statusCode,
        statusMessage: response.statusMessage
      })
    })

    request.on('error', (error) => {
      finish({ requestError: error.message })
    })

    request.end()
  })
}

async function performProxyProbe(
  url: URL,
  proxyPort: number,
  requestState: TestRequestState
): Promise<ProbeResult> {
  if (url.protocol === 'http:') {
    return await performHttpProxyProbe(url, proxyPort, requestState)
  }

  return await performHttpsProxyProbe(url, proxyPort, requestState)
}

function getConnectionMatchScore(
  connection: ControllerConnectionDetail,
  url: URL,
  requestState: TestRequestState
): number {
  const targetHost = url.hostname.toLowerCase()
  const targetPort = getTargetPort(url).toString()
  const host = connection.metadata.host?.toLowerCase() || ''
  const sniffHost = connection.metadata.sniffHost?.toLowerCase() || ''
  const remoteDestination = connection.metadata.remoteDestination?.toLowerCase() || ''
  let score = 0

  const matchedSourcePort =
    requestState.proxySourcePort &&
    connection.metadata.sourcePort === requestState.proxySourcePort

  if (matchedSourcePort) {
    score += 100
  }

  if (host === targetHost) score += 60
  if (sniffHost === targetHost) score += 50
  if (remoteDestination.includes(`${targetHost}:`)) score += 40
  if (remoteDestination.includes(targetHost)) score += 30
  if (score > 0 && connection.metadata.destinationPort === targetPort) score += 10

  return score
}

export function findMatchingConnection(
  connections: ControllerConnectionDetail[],
  beforeIds: Set<string>,
  url: URL,
  requestState: TestRequestState
): ControllerConnectionDetail | null {
  const freshConnections = connections.filter((connection) => !beforeIds.has(connection.id))

  if (freshConnections.length === 0) {
    return null
  }

  const scoredConnections = freshConnections
    .map((connection) => ({
      connection,
      score: getConnectionMatchScore(connection, url, requestState),
      startedAt: Date.parse(connection.start) || 0
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return right.startedAt - left.startedAt
    })

  if (scoredConnections.length > 0) {
    return scoredConnections[0].connection
  }

  return null
}

async function waitForMatchingConnection(
  beforeIds: Set<string>,
  url: URL,
  requestState: TestRequestState
): Promise<ControllerConnectionDetail | null> {
  const deadline = Date.now() + CONNECTION_POLL_TIMEOUT_MS

  while (Date.now() < deadline) {
    const snapshot = await getMihomoConnections()
    const matchedConnection = findMatchingConnection(
      snapshot.connections || [],
      beforeIds,
      url,
      requestState
    )

    if (matchedConnection) {
      return matchedConnection
    }

    if (
      requestState.done &&
      requestState.doneAt &&
      Date.now() - requestState.doneAt >= POST_REQUEST_GRACE_MS
    ) {
      break
    }

    await delay(CONNECTION_POLL_INTERVAL_MS)
  }

  return null
}

function findRuleTarget(
  rules: ControllerRulesDetail[] | undefined,
  connection: ControllerConnectionDetail
): string {
  const matchedRule = rules?.find(
    (rule) =>
      rule.type === connection.rule && (rule.payload || '') === (connection.rulePayload || '')
  )

  if (matchedRule?.proxy) {
    return matchedRule.proxy
  }

  return (
    connection.metadata.specialProxy ||
    connection.chains.at(-1) ||
    connection.chains[0] ||
    'UNKNOWN'
  )
}

function getTrafficPath(
  connection: ControllerConnectionDetail,
  matchedRuleTarget: string
): ControllerRuleTestTrafficPath {
  const target = matchedRuleTarget.toUpperCase()
  const upperChains = connection.chains.map((chain) => chain.toUpperCase())

  if (target === 'REJECT' || target === 'REJECT-DROP') {
    return 'reject'
  }

  if (target === 'DIRECT' || upperChains.includes('DIRECT')) {
    return 'direct'
  }

  if (target === 'VPN') {
    return 'vpn'
  }

  if (upperChains.length > 0) {
    return 'vpn'
  }

  return 'unknown'
}

export async function mihomoTestRuleUrl(input: string): Promise<ControllerRuleTestResult> {
  const url = normalizeTestUrl(input)
  const config = await getMihomoConfig()
  const proxyPort = getTestProxyPort(config)
  const existingConnections = await getMihomoConnections()
  const beforeIds = new Set(
    (existingConnections.connections || []).map((connection) => connection.id)
  )
  const requestState: TestRequestState = { done: false, doneAt: null }
  const requestPromise = performProxyProbe(url, proxyPort, requestState).finally(() => {
    requestState.done = true
    requestState.doneAt = Date.now()
  })
  const connectionPromise = waitForMatchingConnection(beforeIds, url, requestState)
  const rulesPromise = getMihomoRules().catch(() => undefined)

  const [probeResult, matchedConnection, rules] = await Promise.all([
    requestPromise,
    connectionPromise,
    rulesPromise
  ])

  if (!matchedConnection) {
    const reason = probeResult.requestError ? `: ${probeResult.requestError}` : ''
    throw new Error(`Could not capture a Mihomo test connection${reason}`)
  }

  const matchedRuleTarget = findRuleTarget(rules?.rules, matchedConnection)

  return {
    input: input.trim(),
    url: url.toString(),
    matchedRuleType: matchedConnection.rule || 'UNKNOWN',
    matchedRulePayload: matchedConnection.rulePayload || '',
    matchedRuleTarget,
    proxyChain: matchedConnection.chains,
    outbound: matchedConnection.chains[0] || matchedRuleTarget,
    trafficPath: getTrafficPath(matchedConnection, matchedRuleTarget),
    host:
      matchedConnection.metadata.host ||
      matchedConnection.metadata.sniffHost ||
      matchedConnection.metadata.remoteDestination ||
      url.host,
    statusCode: probeResult.statusCode,
    statusMessage: probeResult.statusMessage,
    requestError: probeResult.requestError
  }
}
