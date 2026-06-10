import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { Socket } from 'node:net'
import { findMatchingConnection, performHttpsProxyProbe } from '../src/main/core/ruleTester'

const makeConnection = (
  patch: Partial<ControllerConnectionDetail>
): ControllerConnectionDetail => {
  const { metadata, ...rest } = patch

  return {
    id: 'connection-id',
    metadata: {
      network: 'tcp',
      type: '',
      sourceIP: '',
      destinationIP: '',
      sourceGeoIP: [],
      destinationGeoIP: [],
      sourceIPASN: '',
      destinationIPASN: '',
      sourcePort: '',
      destinationPort: '',
      inboundIP: '',
      inboundPort: '',
      inboundName: '',
      inboundUser: '',
      host: '',
      dnsMode: '',
      uid: 0,
      process: '',
      processPath: '',
      specialProxy: '',
      specialRules: '',
      remoteDestination: '',
      dscp: 0,
      sniffHost: '',
      ...metadata
    },
    upload: 0,
    download: 0,
    start: '2026-06-09T12:00:00Z',
    chains: [],
    rule: '',
    rulePayload: '',
    isActive: true,
    ...rest
  }
}

describe('findMatchingConnection', () => {
  it('ignores unrelated fresh HTTPS connections while waiting for the tested URL', () => {
    const result = findMatchingConnection(
      [
        makeConnection({
          id: 'unrelated-vpn',
          metadata: {
            host: 'api.example.com',
            remoteDestination: 'api.example.com:443',
            destinationPort: '443'
          },
          chains: ['VPN']
        })
      ],
      new Set(),
      new URL('https://www.wildberries.ru/catalog/266589972/detail.aspx?targetUrl=MI'),
      { done: false, doneAt: null }
    )

    assert.equal(result, null)
  })
})

describe('performHttpsProxyProbe', () => {
  it('treats a successful CONNECT response as enough for HTTPS rule capture', async () => {
    const server = http.createServer()
    const sockets: Socket[] = []

    server.on('connect', (_request, socket) => {
      sockets.push(socket)
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    })

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })

    try {
      const address = server.address()
      assert.ok(address && typeof address === 'object')

      const requestState = { done: false, doneAt: null }
      const result = await performHttpsProxyProbe(
        new URL('https://air.1688.com/app/ctf-page/trade-order-list/buyer-order-list.html'),
        address.port,
        requestState
      )

      assert.equal(result.statusCode, 200)
      assert.equal(result.statusMessage, 'Connection Established')
      assert.ok(requestState.proxySourcePort)
    } finally {
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  })
})
