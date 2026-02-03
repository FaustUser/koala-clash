import BasePage from '@renderer/components/base/base-page'
import { Switch } from '@renderer/components/ui/switch'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { restartCore, triggerSysProxy } from '@renderer/utils/ipc'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'

const Home: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { mainSwitchMode = 'tun', sysProxy, onlyActiveDevice = false } = appConfig || {}
  const { enable: sysProxyEnable, mode } = sysProxy || {}
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { tun } = controledMihomoConfig || {}
  const { 'mixed-port': mixedPort } = controledMihomoConfig || {}
  const sysProxyDisabled = mixedPort == 0
  const [loading, setLoading] = useState(false)
  const [loadingDirection, setLoadingDirection] = useState<'connecting' | 'disconnecting'>(
    'connecting'
  )

  const isSelected =
    mainSwitchMode === 'tun' ? tun?.enable ?? false : sysProxyEnable ?? false

  const isDisabled =
    loading || (mainSwitchMode === 'sysproxy' && mode == 'manual' && sysProxyDisabled)

  const status = loading
    ? loadingDirection === 'connecting'
      ? t('pages.home.connecting')
      : t('pages.home.disconnecting')
    : isSelected
      ? t('pages.home.connected')
      : t('pages.home.disconnected')

  const statusColor = loading
    ? 'text-warning'
    : isSelected
      ? 'text-success'
      : 'text-muted-foreground'

  const onValueChange = async (enable: boolean): Promise<void> => {
    setLoading(true)
    setLoadingDirection(enable ? 'connecting' : 'disconnecting')
    try {
      if (mainSwitchMode === 'tun') {
        if (enable) {
          await patchControledMihomoConfig({ tun: { enable }, dns: { enable: true } })
        } else {
          await patchControledMihomoConfig({ tun: { enable } })
        }
        await restartCore()
        window.electron.ipcRenderer.send('updateFloatingWindow')
        window.electron.ipcRenderer.send('updateTrayMenu')
      } else {
        if (mode == 'manual' && sysProxyDisabled) return
        await triggerSysProxy(enable, onlyActiveDevice)
        await patchAppConfig({ sysProxy: { enable } })
        window.electron.ipcRenderer.send('updateFloatingWindow')
        window.electron.ipcRenderer.send('updateTrayMenu')
      }
    } catch (e) {
      alert(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <BasePage>
      <div className="flex flex-col h-full items-center justify-center">
        <span className={`text-sm font-medium mb-[80px] ${statusColor}`}>{status}</span>
        <Switch
          className="scale-500"
          checked={isSelected}
          disabled={isDisabled}
          onCheckedChange={onValueChange}
        />
      </div>
    </BasePage>
  )
}

export default Home
