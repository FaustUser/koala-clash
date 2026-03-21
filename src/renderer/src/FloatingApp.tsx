import { useEffect, useMemo, useState } from 'react'
import MihomoIcon from './components/base/mihomo-icon'
import { calcTraffic } from './utils/calc'
import { showContextMenu, triggerMainWindow } from './utils/ipc'
import { useAppConfig } from './hooks/use-app-config'
import { useControledMihomoConfig } from './hooks/use-controled-mihomo-config'

const floatingWindowSizeClasses: Record<
  NonNullable<AppConfig['floatingWindowSize']>,
  {
    iconBox: string
    icon: string
    text: string
    gap: string
    margin: string
  }
> = {
  small: {
    iconBox: 'h-[calc(100%-4px)] text-[18px]',
    icon: 'text-[18px]',
    text: 'text-[10px]',
    gap: 'gap-[1px]',
    margin: 'mr-1.5'
  },
  default: {
    iconBox: 'h-[calc(100%-4px)] text-[22px]',
    icon: 'text-[22px]',
    text: 'text-[12px]',
    gap: 'gap-0',
    margin: 'mr-2'
  },
  large: {
    iconBox: 'h-[calc(100%-4px)] text-[26px]',
    icon: 'text-[26px]',
    text: 'text-[13px]',
    gap: 'gap-0.5',
    margin: 'mr-2.5'
  }
}

const FloatingApp: React.FC = () => {
  const { appConfig } = useAppConfig()
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { sysProxy, spinFloatingIcon = true, floatingWindowSize = 'default' } = appConfig || {}
  const { tun } = controledMihomoConfig || {}
  const sysProxyEnabled = sysProxy?.enable
  const tunEnabled = tun?.enable
  const sizeClasses = floatingWindowSizeClasses[floatingWindowSize]

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
                : {}
            }
            className={`app-nodrag cursor-pointer floating-thumb ${tunEnabled ? 'bg-gradient-end-power-on' : sysProxyEnabled ? 'bg-primary' : 'bg-muted'} hover:opacity-80 rounded-full aspect-square ${sizeClasses.iconBox}`}
          >
            <MihomoIcon
              className={`floating-icon text-primary-foreground h-full leading-full mx-auto ${sizeClasses.icon}`}
            />
          </div>
        </div>
        <div className="w-full overflow-hidden">
          <div className={`flex flex-col justify-center h-full w-full ${sizeClasses.gap}`}>
            <h2
              className={`text-end floating-text whitespace-nowrap font-bold ${sizeClasses.text} ${sizeClasses.margin}`}
            >
              {calcTraffic(upload)}/s
            </h2>
            <h2
              className={`text-end floating-text whitespace-nowrap font-bold ${sizeClasses.text} ${sizeClasses.margin}`}
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
