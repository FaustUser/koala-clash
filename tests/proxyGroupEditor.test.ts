import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getProxyGroupEditorLoadKey,
  getProxyGroupEditorScrollClassName
} from '../src/renderer/src/utils/proxyGroupEditor'

describe('proxy group editor load key', () => {
  it('does not change when parent callbacks are recreated', () => {
    const firstOnClose = (): void => {}
    const secondOnClose = (): void => {}
    const firstOnSaved = (): void => {}
    const secondOnSaved = (): void => {}

    const firstKey = getProxyGroupEditorLoadKey({
      groupName: 'VPN',
      onClose: firstOnClose,
      onSaved: firstOnSaved
    })
    const secondKey = getProxyGroupEditorLoadKey({
      groupName: 'VPN',
      onClose: secondOnClose,
      onSaved: secondOnSaved
    })

    assert.equal(secondKey, firstKey)
  })

  it('changes when the edited group changes', () => {
    const onClose = (): void => {}
    const onSaved = (): void => {}

    assert.notEqual(
      getProxyGroupEditorLoadKey({ groupName: 'VPN', onClose, onSaved }),
      getProxyGroupEditorLoadKey({ groupName: 'Manual', onClose, onSaved })
    )
  })

  it('keeps scrollable content away from the vertical scrollbar', () => {
    const className = getProxyGroupEditorScrollClassName()

    assert.match(className, /overflow-y-auto/)
    assert.match(className, /scrollbar-gutter:stable/)
    assert.match(className, /\bpr-\d+/)
  })
})
