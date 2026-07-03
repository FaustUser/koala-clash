import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  getGpuStabilityPolicy,
  shouldApplyWindowsGpuStabilityFallback
} from '../src/main/utils/gpuPolicy'

describe('GPU stability policy', () => {
  it('applies the Windows renderer-crash fallback even when the executable is on C:', () => {
    assert.equal(
      shouldApplyWindowsGpuStabilityFallback({
        platform: 'win32',
        disableGPU: false,
        exePath: 'C:\\Users\\Faust\\AppData\\Local\\electron\\electron.exe'
      }),
      true
    )
  })

  it('does not force the Windows fallback on non-Windows platforms', () => {
    assert.equal(
      shouldApplyWindowsGpuStabilityFallback({
        platform: 'linux',
        disableGPU: false,
        exePath: '/opt/koala-clash/koala-clash'
      }),
      false
    )
  })

  it('fully disables hardware acceleration when the user setting is enabled', () => {
    assert.deepEqual(
      getGpuStabilityPolicy({
        platform: 'win32',
        disableGPU: true,
        exePath: 'C:\\Program Files\\Koala Clash\\Koala Clash.exe'
      }),
      {
        disableHardwareAcceleration: true,
        disableGpuCompositing: true,
        disableDirectComposition: true
      }
    )
  })
})
