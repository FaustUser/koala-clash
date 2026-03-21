import { useEffect, useMemo, useState } from 'react'
import MihomoIcon from './components/base/mihomo-icon'
import { calcTraffic } from './utils/calc'
import { showContextMenu, triggerMainWindow } from './utils/ipc'
import { useAppConfig } from './hooks/use-app-config'
import { useControledMihomoConfig } from './hooks/use-controled-mihomo-config'

const floatingWindowSizes: Record<
  NonNullable<AppConfig['floatingWindowSize']>,
  { width: number; height: number }
> = {
  small: { width: 104, height: 36 },
  default: { width: 120, height: 42 },
  large: { width: 144, height: 50 }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

const FloatingApp: React.FC = () => {
  const { appConfig } = useAppConfig()
  const { controledMihomoConfig } = useControledMihomoConfig()
  const {
    sysProxy,
    spinFloatingIcon = true,
    floatingWindowSize = 'default',
    floatingWindowUseCustomSize = false,
    floatingWindowWidth,
    floatingWindowHeight
  } = appConfig || {}
  const { tun } = controledMihomoConfig || {}
  const sysProxyEnabled = sysProxy?.enable
  const tunEnabled = tun?.enable
  const effectiveSize = useMemo(() => {
    if (
      floatingWindowUseCustomSize &&
      Number.isFinite(floatingWindowWidth) &&
      Number.isFinite(floatingWindowHeight)
    ) {
      return {
        width: clamp(floatingWindowWidth as number, 88, 400),
        height: clamp(floatingWindowHeight as number, 32, 160)
      }
    }
    return floatingWindowSizes[floatingWindowSize]
  }, [floatingWindowHeight, floatingWindowSize, floatingWindowUseCustomSize, floatingWindowWidth])
  const scale = clamp(effectiveSize.height / 42, 0.75, 2)
  const iconFontSize = Math.round(22 * scale)
  const textFontSize = Math.round(12 * scale)
  const textMarginRight = Math.max(6, Math.round(8 * scale))
  const textGap = Math.max(0, Math.round((effectiveSize.height - 42) / 10))

  const [upload, setUpload] = useState(0)
  const [download, setDownload] = useState(0)

  // Calculate rotation speed based on total throughput.
  const spinSpeed = useMemo(() => {
    const total = upload + download
    if (total === 0) return 0
    if (total < 1024) return 2
    if (total < 1024 * 1024) return 3
    if (total < 1024 * 1024 * 1024) return 4
    return 5
  }, [upload, download])

  const [rotation, setRotation] = useState(0)

  useEffect(() => {
    if (!spinFloatingIcon) return

    let animationFrameId: number
    const animate = (): void => {
      setRotation((prev) => {
        if (prev === 360) {
          return 0
        }
        return prev + spinSpeed
      })
      animationFrameId = requestAnimationFrame(animate)
    }

    animationFrameId = requestAnimationFrame(animate)
    return (): void => {
      cancelAnimationFrame(animationFrameId)
    }
  }, [spinSpeed, spinFloatingIcon])

  useEffect(() => {
    window.electron.ipcRenderer.on('mihomoTraffic', async (_e, info: ControllerTraffic) => {
      setUpload(info.up)
      setDownload(info.down)
    })
    return (): void => {
      window.electron.ipcRenderer.removeAllListeners('mihomoTraffic')
    }
  }, [])

  return (
    <div className="app-drag h-screen w-screen overflow-hidden">
      <div className="floating-bg border border-stroke flex rounded-full bg-background h-full w-full">
        <div className="flex justify-center items-center h-full aspect-square">
          <div
            onContextMenu={(e) => {
              e.preventDefault()
              showContextMenu()
            }}
            onClick={() => {
              triggerMainWindow()
            }}
            style={
              spinFloatingIcon
                ? {
                    transform: `rotate(${rotation}deg)`,
                    transition: 'transform 0.1s linear'
                  }
                : undefined
            }
            className={`app-nodrag cursor-pointer floating-thumb ${tunEnabled ? 'bg-gradient-end-power-on' : sysProxyEnabled ? 'bg-primary' : 'bg-muted'} hover:opacity-80 rounded-full aspect-square h-[calc(100%-4px)]`}
          >
            <MihomoIcon
              className="floating-icon text-primary-foreground h-full leading-full mx-auto"
              style={{ fontSize: `${iconFontSize}px` }}
            />
          </div>
        </div>
        <div className="w-full overflow-hidden">
          <div
            className="flex flex-col justify-center h-full w-full"
            style={{ gap: `${textGap}px` }}
          >
            <h2
              className="text-end floating-text whitespace-nowrap font-bold"
              style={{ fontSize: `${textFontSize}px`, marginRight: `${textMarginRight}px` }}
            >
              {calcTraffic(upload)}/s
            </h2>
            <h2
              className="text-end floating-text whitespace-nowrap font-bold"
              style={{ fontSize: `${textFontSize}px`, marginRight: `${textMarginRight}px` }}
            >
              {calcTraffic(download)}/s
            </h2>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FloatingApp
