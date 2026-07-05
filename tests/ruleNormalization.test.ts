import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeProfileRuleTargets,
  normalizeRuleTargetForVpnRouting
} from '../src/shared/utils/ruleNormalization'

describe('rule target normalization', () => {
  it('preserves DIRECT domain exceptions when the profile fallback is DIRECT', () => {
    const rules = normalizeProfileRuleTargets(
      ['DOMAIN-SUFFIX,wildberries.ru,DIRECT', 'DOMAIN-SUFFIX,wbbasket.ru,DIRECT', 'MATCH,DIRECT'],
      'DIRECT'
    )

    assert.deepEqual(rules, [
      'DOMAIN-SUFFIX,wildberries.ru,DIRECT',
      'DOMAIN-SUFFIX,wbbasket.ru,DIRECT',
      'MATCH,VPN'
    ])
  })

  it('preserves explicit DIRECT shared rules when the profile fallback is DIRECT', () => {
    assert.equal(
      normalizeRuleTargetForVpnRouting('DOMAIN-SUFFIX,wildberries.ru,DIRECT', 'DIRECT'),
      'DOMAIN-SUFFIX,wildberries.ru,DIRECT'
    )
  })

  it('still maps subscription default proxy targets to VPN', () => {
    const rules = normalizeProfileRuleTargets(
      ['DOMAIN-SUFFIX,example.com,PROXY', 'DOMAIN-SUFFIX,wildberries.ru,DIRECT', 'MATCH,PROXY'],
      'PROXY'
    )

    assert.deepEqual(rules, [
      'DOMAIN-SUFFIX,example.com,VPN',
      'DOMAIN-SUFFIX,wildberries.ru,DIRECT',
      'MATCH,VPN'
    ])
  })
})
