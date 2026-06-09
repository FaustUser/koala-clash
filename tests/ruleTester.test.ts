import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { findMatchingConnection } from '../src/main/core/ruleTester'

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
