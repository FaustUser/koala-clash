import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { alignDnsWithDirectRules } from '../src/main/core/dnsRouting'

describe('alignDnsWithDirectRules', () => {
  it('routes DNS for DIRECT matches through the system resolver', () => {
    const profile = {
      dns: {
        enable: true,
        'respect-rules': false,
        'default-nameserver': ['tls://1.1.1.1'],
        nameserver: ['https://1.1.1.1/dns-query'],
        'proxy-server-nameserver': [],
        'direct-nameserver': []
      },
      rules: ['DOMAIN-SUFFIX,example.com,DIRECT', 'MATCH,VPN']
    } as unknown as MihomoConfig

    alignDnsWithDirectRules(profile)

    assert.equal(profile.dns['respect-rules'], true)
    assert.deepEqual(profile.dns['direct-nameserver'], ['system'])
    assert.deepEqual(profile.dns['proxy-server-nameserver'], ['tls://1.1.1.1'])
    assert.equal(profile.dns['direct-nameserver-follow-policy'], false)
  })

  it('does not overwrite explicit direct DNS settings', () => {
    const profile = {
      dns: {
        enable: true,
        'respect-rules': false,
        'default-nameserver': ['tls://1.1.1.1'],
        'proxy-server-nameserver': ['https://dns.example/dns-query'],
        'direct-nameserver': ['system://'],
        'direct-nameserver-follow-policy': true
      },
      rules: ['DOMAIN-SUFFIX,example.com,DIRECT', 'MATCH,VPN']
    } as unknown as MihomoConfig

    alignDnsWithDirectRules(profile)

    assert.equal(profile.dns['respect-rules'], true)
    assert.deepEqual(profile.dns['direct-nameserver'], ['system://'])
    assert.deepEqual(profile.dns['proxy-server-nameserver'], ['https://dns.example/dns-query'])
    assert.equal(profile.dns['direct-nameserver-follow-policy'], true)
  })

  it('preserves string-form DNS settings', () => {
    const profile = {
      dns: {
        enable: true,
        'respect-rules': false,
        'default-nameserver': 'tls://9.9.9.9',
        'proxy-server-nameserver': 'https://dns.example/dns-query',
        'direct-nameserver': 'system'
      },
      rules: ['DOMAIN-SUFFIX,example.com,DIRECT', 'MATCH,VPN']
    } as unknown as MihomoConfig

    alignDnsWithDirectRules(profile)

    assert.equal(profile.dns['respect-rules'], true)
    assert.equal(profile.dns['direct-nameserver'], 'system')
    assert.equal(profile.dns['proxy-server-nameserver'], 'https://dns.example/dns-query')
  })

  it('applies direct DNS even when the fallback route uses a non-VPN group', () => {
    const profile = {
      dns: {
        enable: true,
        'respect-rules': false,
        'default-nameserver': ['tls://1.1.1.1'],
        nameserver: ['https://1.1.1.1/dns-query']
      },
      rules: ['DOMAIN-SUFFIX,example.com,DIRECT', 'MATCH,PROXY']
    } as unknown as MihomoConfig

    alignDnsWithDirectRules(profile)

    assert.equal(profile.dns['respect-rules'], true)
    assert.deepEqual(profile.dns['direct-nameserver'], ['system'])
  })

  it('detects DIRECT targets in array-form rules', () => {
    const profile = {
      dns: {
        enable: true,
        'respect-rules': false,
        'default-nameserver': ['tls://1.1.1.1']
      },
      rules: [
        ['DOMAIN-SUFFIX', 'example.com', 'DIRECT'],
        ['MATCH', 'VPN']
      ]
    } as unknown as MihomoConfig

    alignDnsWithDirectRules(profile)

    assert.equal(profile.dns['respect-rules'], true)
    assert.deepEqual(profile.dns['direct-nameserver'], ['system'])
  })

  it('matches DIRECT targets case-insensitively', () => {
    const profile = {
      dns: {
        enable: true,
        'respect-rules': false,
        'default-nameserver': ['tls://1.1.1.1']
      },
      rules: ['DOMAIN-SUFFIX,example.com,direct', 'MATCH,PROXY']
    } as unknown as MihomoConfig

    alignDnsWithDirectRules(profile)

    assert.equal(profile.dns['respect-rules'], true)
    assert.deepEqual(profile.dns['direct-nameserver'], ['system'])
  })

  it('leaves profiles without DIRECT rules unchanged', () => {
    const profile = {
      dns: {
        enable: true,
        'respect-rules': false,
        'default-nameserver': ['tls://1.1.1.1']
      },
      rules: ['MATCH,VPN']
    } as unknown as MihomoConfig

    alignDnsWithDirectRules(profile)

    assert.equal(profile.dns['respect-rules'], false)
    assert.equal(profile.dns['direct-nameserver'], undefined)
  })
})
