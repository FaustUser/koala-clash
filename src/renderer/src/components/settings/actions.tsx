import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import {
  checkUpdate,
  createHeapSnapshot,
  mihomoVersion,
  quitApp,
  quitWithoutCore,
  resetAppConfig,
  cancelUpdate
} from '@renderer/utils/ipc'
import { useState, useEffect } from 'react'
import useSWR from 'swr'
import UpdaterModal from '../updater/updater-modal'
import { version } from '@renderer/utils/init'
import { IoIosHelpCircle } from 'react-icons/io'
import { IoSettings } from 'react-icons/io5'
import { startTour } from '@renderer/utils/driver'
import { useNavigate } from 'react-router-dom'
import ConfirmModal from '../base/base-confirm'
import { useTranslation } from 'react-i18next'

const Actions: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: coreVersion } = useSWR('mihomoVersion', mihomoVersion)
  const [newVersion, setNewVersion] = useState('')
  const [changelog, setChangelog] = useState('')
  const [openUpdate, setOpenUpdate] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<{
    downloading: boolean
    progress: number
    error?: string
  }>({
    downloading: false,
    progress: 0
  })

  useEffect(() => {
    const handleUpdateStatus = (
      _: Electron.IpcRendererEvent,
      status: typeof updateStatus
    ): void => {
      setUpdateStatus(status)
    }

    window.electron.ipcRenderer.on('update-status', handleUpdateStatus)

    return (): void => {
      window.electron.ipcRenderer.removeAllListeners('update-status')
    }
  }, [])

  const handleCancelUpdate = async (): Promise<void> => {
    try {
      await cancelUpdate()
      setUpdateStatus({ downloading: false, progress: 0 })
    } catch (e) {
      // ignore
    }
  }

  return (
    <>
      {openUpdate && (
        <UpdaterModal
          onClose={() => setOpenUpdate(false)}
          version={newVersion}
          changelog={changelog}
          updateStatus={updateStatus}
          onCancel={handleCancelUpdate}
        />
      )}
      {confirmOpen && (
        <ConfirmModal
          onChange={setConfirmOpen}
          title={t('settings.actions.confirmReset')}
          description={
            <>
              {t('settings.actions.resetWarning')}
              <span className="text-red-500">{t('settings.actions.cannotUndo')}</span>
            </>
          }
          confirmText={t('settings.actions.confirmDelete')}
          cancelText={t('common.cancel')}
          onConfirm={resetAppConfig}
        />
      )}
      <SettingCard>
        <SettingItem title={t('settings.actions.openGuidePage')} divider>
          <Button size="sm" onClick={() => startTour(navigate)}>
            {t('settings.actions.openGuide')}
          </Button>
        </SettingItem>
        <SettingItem title={t('settings.actions.checkUpdate')} divider>
          <Button
            size="sm"
            disabled={checkingUpdate}
            onClick={async () => {
              try {
                setCheckingUpdate(true)
                const version = await checkUpdate()
                if (version) {
                  setNewVersion(version.version)
                  setChangelog(version.changelog)
                  setOpenUpdate(true)
                } else {
                  new window.Notification(t('settings.actions.alreadyLatest'), {
                    body: t('settings.actions.noNeedUpdate')
                  })
                }
              } catch (e) {
                toast.error(`${e}`)
              } finally {
                setCheckingUpdate(false)
              }
            }}
          >
            {t('settings.actions.checkUpdate')}
          </Button>
        </SettingItem>
        <SettingItem
          title={t('settings.actions.resetApp')}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost">
                  <IoIosHelpCircle className="text-lg" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.actions.resetAppHelp')}</TooltipContent>
            </Tooltip>
          }
          divider
        >
          <Button size="sm" onClick={() => setConfirmOpen(true)}>
            {t('settings.actions.resetApp')}
          </Button>
        </SettingItem>
        <SettingItem
          title={t('settings.actions.clearCache')}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost">
                  <IoIosHelpCircle className="text-lg" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.actions.clearCacheHelp')}</TooltipContent>
            </Tooltip>
          }
          divider
        >
          <Button size="sm" onClick={() => localStorage.clear()}>
            {t('settings.actions.clearCache')}
          </Button>
        </SettingItem>
        <SettingItem
          title={t('settings.actions.createHeapSnapshot')}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost">
                  <IoIosHelpCircle className="text-lg" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.actions.createHeapSnapshotHelp')}</TooltipContent>
            </Tooltip>
          }
          divider
        >
          <Button size="sm" onClick={createHeapSnapshot}>
            {t('settings.actions.createHeapSnapshot')}
          </Button>
        </SettingItem>
        <SettingItem
          title={t('settings.actions.quitKeepCore')}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost">
                  <IoIosHelpCircle className="text-lg" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.actions.quitKeepCoreHelp')}</TooltipContent>
            </Tooltip>
          }
          divider
        >
          <Button size="sm" onClick={quitWithoutCore}>
            {t('common.quit')}
          </Button>
        </SettingItem>
        <SettingItem title={t('settings.actions.quitApp')} divider>
          <Button size="sm" onClick={quitApp}>
            {t('settings.actions.quitApp')}
          </Button>
        </SettingItem>
        <SettingItem
          title={t('settings.actions.mihomoVersion')}
          actions={
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon-sm" variant="ghost" onClick={() => navigate('/mihomo')}>
                  <IoSettings className="text-lg" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.actions.mihomoSettings')}</TooltipContent>
            </Tooltip>
          }
          divider
        >
          <div>{coreVersion?.version ? coreVersion.version : '...'}</div>
        </SettingItem>
        <SettingItem title={t('settings.actions.appVersion')}>
          <div>v{version}</div>
        </SettingItem>
      </SettingCard>
    </>
  )
}

export default Actions
