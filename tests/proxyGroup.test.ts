import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildCandidateProfileLabels } from '../src/main/config/proxyGroupLabels'

describe('buildCandidateProfileLabels', () => {
  it('labels active and external profile proxies for the VPN group editor', () => {
    const labels = buildCandidateProfileLabels(
      [{ name: 'active-node' }, { name: 'external-node', serverDescription: 'Second profile' }],
      'Main profile'
    )

    assert.deepEqual(labels, {
      'active-node': 'Main profile',
      'external-node': 'Second profile'
    })
  })
})
