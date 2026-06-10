import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProfileProxyItems,
  buildProfileOptions,
  flattenProfileProxies,
  getFastestProxy,
  sortProfileProxies
} from '../src/renderer/src/utils/proxyProfile'

const makeProxy = (
  name: string,
  serverDescription: string | undefined,
  delay?: number
): ControllerProxiesDetail => ({
  alive: delay !== 0,
  extra: {},
  history: delay === undefined ? [] : [{ time: '2026-06-09T12:00:00Z', delay }],
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
  uot: false,
  serverDescription
})

const makeGroup = (name: string, proxies: ControllerProxiesDetail[]): ControllerMixedGroup => ({
  alive: true,
  all: proxies,
  extra: {},
  hidden: false,
  history: [],
  icon: '',
  interface: '',
  mptcp: false,
  name,
  now: proxies[0]?.name || '',
  smux: false,
  tfo: false,
  type: 'Selector' as MihomoProxyType,
  udp: true,
  uot: false,
  xudp: false
})

describe('proxy profile helpers', () => {
  it('builds profile items from every runtime proxy, not only group members', () => {
    const runtimeProxies = [
      makeProxy('profile-2-a', 'Second profile'),
      makeProxy('profile-2-b', 'Second profile'),
      makeProxy('profile-2-c', 'Second profile')
    ]

    const profileProxies = buildProfileProxyItems(runtimeProxies)

    assert.deepEqual(
      profileProxies.map((item) => item.proxy.name),
      ['profile-2-a', 'profile-2-b', 'profile-2-c']
    )
  })

  it('deduplicates runtime proxies and keeps their source profile labels', () => {
    const profileProxies = flattenProfileProxies([
      makeGroup('VPN', [
        makeProxy('fast-a', undefined, 120),
        makeProxy('fast-b', 'Second profile', 80)
      ]),
      makeGroup('Manual', [
        makeProxy('fast-a', undefined, 120),
        makeProxy('fast-b', 'Second profile', 80)
      ])
    ])

    assert.deepEqual(
      profileProxies.map((item) => ({
        name: item.proxy.name,
        profileName: item.profileName,
        isCurrentProfile: item.isCurrentProfile
      })),
      [
        { name: 'fast-a', profileName: 'Active profile', isCurrentProfile: true },
        { name: 'fast-b', profileName: 'Second profile', isCurrentProfile: false }
      ]
    )
  })

  it('treats proxies with source labels as external profiles even when names match', () => {
    const profileProxies = flattenProfileProxies(
      [makeGroup('VPN', [makeProxy('same-name', 'Main profile', 80)])],
      'Main profile'
    )

    assert.equal(profileProxies[0].profileName, 'Main profile')
    assert.equal(profileProxies[0].profileKey, 'Main profile')
    assert.equal(profileProxies[0].isCurrentProfile, false)
  })

  it('builds stable profile filter options from available proxies', () => {
    const options = buildProfileOptions([
      {
        proxy: makeProxy('a', undefined),
        profileName: 'Active profile',
        profileKey: '__active__',
        isCurrentProfile: true
      },
      {
        proxy: makeProxy('b', 'Second profile'),
        profileName: 'Second profile',
        profileKey: 'Second profile',
        isCurrentProfile: false
      }
    ])

    assert.deepEqual(options, [
      { key: 'all', label: 'All profiles', count: 2 },
      { key: '__active__', label: 'Active profile', count: 1 },
      { key: 'Second profile', label: 'Second profile', count: 1 }
    ])
  })

  it('sorts fastest available proxies first and keeps timeouts last', () => {
    const sorted = sortProfileProxies(
      [
        {
          proxy: makeProxy('untested', 'A'),
          profileName: 'A',
          profileKey: 'A',
          isCurrentProfile: false
        },
        {
          proxy: makeProxy('timeout', 'A', 0),
          profileName: 'A',
          profileKey: 'A',
          isCurrentProfile: false
        },
        {
          proxy: makeProxy('fast', 'A', 90),
          profileName: 'A',
          profileKey: 'A',
          isCurrentProfile: false
        }
      ],
      'delay'
    )

    assert.deepEqual(
      sorted.map((item) => item.proxy.name),
      ['fast', 'untested', 'timeout']
    )
  })

  it('returns the fastest tested alive proxy', () => {
    const fastest = getFastestProxy([
      {
        proxy: makeProxy('timeout', 'A', 0),
        profileName: 'A',
        profileKey: 'A',
        isCurrentProfile: false
      },
      {
        proxy: makeProxy('fast', 'B', 70),
        profileName: 'B',
        profileKey: 'B',
        isCurrentProfile: false
      },
      {
        proxy: makeProxy('slow', 'A', 300),
        profileName: 'A',
        profileKey: 'A',
        isCurrentProfile: false
      }
    ])

    assert.equal(fastest?.proxy.name, 'fast')
  })
})
