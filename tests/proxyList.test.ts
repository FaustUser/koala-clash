import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getRuntimeProfileProxies } from '../src/main/core/proxyList'

const makeProxy = (name: string): ControllerProxiesDetail => ({
  alive: true,
  extra: {},
  history: [],
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

const makeGroup = (name: string, all: string[]): ControllerGroupDetail => ({
  alive: true,
  all,
  extra: {},
  hidden: false,
  history: [],
  icon: '',
  interface: '',
  mptcp: false,
  name,
  now: all[0] || '',
  smux: false,
  tfo: false,
  type: 'Selector' as MihomoProxyType,
  udp: true,
  uot: false,
  xudp: false
})

describe('getRuntimeProfileProxies', () => {
  it('returns all runtime leaf proxies even when the VPN group contains only a subset', () => {
    const controllerProxies: ControllerProxies = {
      proxies: {
        VPN: makeGroup('VPN', ['p2-1', 'p2-2']),
        'p2-1': makeProxy('p2-1'),
        'p2-2': makeProxy('p2-2'),
        'p2-3': makeProxy('p2-3'),
        'p2-4': makeProxy('p2-4')
      }
    }

    const result = getRuntimeProfileProxies(controllerProxies, [
      { name: 'p2-1', serverDescription: 'Second profile' },
      { name: 'p2-2', serverDescription: 'Second profile' },
      { name: 'p2-3', serverDescription: 'Second profile' },
      { name: 'p2-4', serverDescription: 'Second profile' }
    ])

    assert.deepEqual(
      result.map((proxy) => proxy.name),
      ['p2-1', 'p2-2', 'p2-3', 'p2-4']
    )
    assert.equal(result[3].serverDescription, 'Second profile')
  })
})
