type GpuStabilityPolicyInput = {
  platform: NodeJS.Platform
  disableGPU: boolean
  exePath: string
}

type GpuStabilityPolicy = {
  disableHardwareAcceleration: boolean
  disableGpuCompositing: boolean
  disableDirectComposition: boolean
}

function isWindowsSystemDrivePath(exePath: string): boolean {
  return /^[cC]:[\\/]/.test(exePath)
}

export function shouldApplyWindowsGpuStabilityFallback({
  platform
}: GpuStabilityPolicyInput): boolean {
  return platform === 'win32'
}

export function getGpuStabilityPolicy(input: GpuStabilityPolicyInput): GpuStabilityPolicy {
  const windowsFallback = shouldApplyWindowsGpuStabilityFallback(input)
  const legacyOutOfSystemDriveFallback =
    input.platform === 'win32' && !isWindowsSystemDrivePath(input.exePath)
  const disableHardwareAcceleration = input.disableGPU || legacyOutOfSystemDriveFallback

  return {
    disableHardwareAcceleration,
    disableGpuCompositing: input.disableGPU || windowsFallback,
    disableDirectComposition: input.disableGPU || windowsFallback
  }
}
