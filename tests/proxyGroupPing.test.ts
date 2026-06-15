import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProxyPingResults,
  toProxyPingError,
  toProxyPingResult
} from '../src/renderer/src/utils/proxyGroupPing'

const makeProxy = (name: string, delay?: number): ControllerProxiesDetail => ({
  alive: delay !== 0,
  extra: {},
  history: delay === undefined ? [] : [{ time: '2026-06-15T12:00:00Z', delay }],
  id: name,
  name,
  tfo: false,
  type: 'Shadowsocks' as MihomoProxyType,
  udp: true,
  xudp: false,
  'dialer-proxy': '',
  interface: '',
  mptcp: false,
  'routing-mark': 0,
  smux: false,
  uot: false
})

describe('proxy group ping helpers', () => {
  it('hydrates proxy ping states from runtime proxy history', () => {
    const results = buildProxyPingResults(['fast', 'timeout', 'untested'], {
      proxies: {
        fast: makeProxy('fast', 84),
        timeout: makeProxy('timeout', 0),
        untested: makeProxy('untested')
      }
    })

    assert.deepEqual(results, {
      fast: { status: 'ok', delay: 84 },
      timeout: { status: 'timeout' },
      untested: { status: 'idle' }
    })
  })

  it('converts manual ping responses and thrown errors to display states', () => {
    assert.deepEqual(toProxyPingResult({ delay: 128 }), { status: 'ok', delay: 128 })
    assert.deepEqual(toProxyPingResult({ delay: 0 }), { status: 'timeout' })
    assert.deepEqual(toProxyPingResult({ message: 'timeout' }), { status: 'timeout' })
    assert.deepEqual(toProxyPingError(new Error('network down')), {
      status: 'error',
      message: 'network down'
    })
  })
})
