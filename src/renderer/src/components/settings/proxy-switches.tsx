import React, { Key } from 'react'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Button, Switch, Tab, Tabs } from '@heroui/react'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { restartCore, triggerSysProxy } from '@renderer/utils/ipc'
import { useNavigate } from 'react-router-dom'
import { IoSettings } from 'react-icons/io5'
import { useTranslation } from 'react-i18next'

const ProxySwitches: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { controledMihomoConfig, patchControledMihomoConfig } = useControledMihomoConfig()
  const { tun } = controledMihomoConfig || {}
  const { appConfig, patchAppConfig } = useAppConfig()
  const { sysProxy, onlyActiveDevice = false, mainSwitchMode = 'tun' } = appConfig || {}
  const { enable: sysProxyEnable, mode } = sysProxy || {}
  const { 'mixed-port': mixedPort } = controledMihomoConfig || {}
  const sysProxyDisabled = mixedPort == 0

  return (
    <SettingCard>
      <SettingItem title={t('settings.advanced.mainSwitch')} divider>
        <Tabs
          size="sm"
          color="primary"
          selectedKey={mainSwitchMode}
          onSelectionChange={(key: Key) => {
            patchAppConfig({ mainSwitchMode: key as 'tun' | 'sysproxy' })
          }}
        >
          <Tab key="tun" title={t('settings.advanced.mainSwitchTun')} />
          <Tab key="sysproxy" title={t('settings.advanced.mainSwitchSysproxy')} />
        </Tabs>
      </SettingItem>
      <SettingItem
        title={t('sider.virtualInterface')}
        actions={
          <Button
            isIconOnly
            size="sm"
            variant="light"
            onPress={() => navigate('/tun')}
          >
            <IoSettings className="text-lg" />
          </Button>
        }
        divider
      >
        <Switch
          size="sm"
          isSelected={tun?.enable}
          onValueChange={async (enable: boolean) => {
            if (enable) {
              await patchControledMihomoConfig({ tun: { enable }, dns: { enable: true } })
            } else {
              await patchControledMihomoConfig({ tun: { enable } })
            }
            await restartCore()
            window.electron.ipcRenderer.send('updateFloatingWindow')
            window.electron.ipcRenderer.send('updateTrayMenu')
          }}
        />
      </SettingItem>
      <SettingItem
        title={t('sider.systemProxy')}
        actions={
          <Button
            isIconOnly
            size="sm"
            variant="light"
            onPress={() => navigate('/sysproxy')}
          >
            <IoSettings className="text-lg" />
          </Button>
        }
      >
        <Switch
          size="sm"
          isSelected={sysProxyEnable}
          isDisabled={mode == 'manual' && sysProxyDisabled}
          onValueChange={async (enable: boolean) => {
            if (mode == 'manual' && sysProxyDisabled) return
            try {
              await triggerSysProxy(enable, onlyActiveDevice)
              await patchAppConfig({ sysProxy: { enable } })
              window.electron.ipcRenderer.send('updateFloatingWindow')
              window.electron.ipcRenderer.send('updateTrayMenu')
            } catch (e) {
              alert(e)
            }
          }}
        />
      </SettingItem>
    </SettingCard>
  )
}

export default ProxySwitches
