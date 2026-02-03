import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Switch
} from '@heroui/react'
import React, { useEffect, useState, useCallback } from 'react'
import { BaseEditor } from '../base/base-editor-lazy'
import {
  getProfileConfig,
  getRawProfileStr,
  getRuntimeConfigStr,
  getCurrentProfileStr
} from '@renderer/utils/ipc'
import useSWR from 'swr'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { t } from 'i18next'

interface Props {
  onClose: () => void
}
const ConfigViewer: React.FC<Props> = ({ onClose }) => {
  const { appConfig: { disableAnimation = false } = {} } = useAppConfig()
  const [runtimeConfig, setRuntimeConfig] = useState('')
  const [rawProfile, setRawProfile] = useState('')
  const [profileConfig, setProfileConfig] = useState('')
  const [isDiff, setIsDiff] = useState(false)
  const [isRaw, setIsRaw] = useState(false)
  const [sideBySide, setSideBySide] = useState(false)

  const { data: config } = useSWR('getProfileConfig', getProfileConfig)

  const fetchConfigs = useCallback(async () => {
    setRuntimeConfig(await getRuntimeConfigStr())
    setRawProfile(await getRawProfileStr())
    setProfileConfig(await getCurrentProfileStr())
  }, [config])

  useEffect(() => {
    fetchConfigs()
  }, [fetchConfigs])

  return (
    <Modal
      backdrop={disableAnimation ? 'transparent' : 'blur'}
      disableAnimation={disableAnimation}
      classNames={{
        base: 'max-w-none w-full',
        backdrop: 'top-[48px]'
      }}
      size="5xl"
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
    >
      <ModalContent className="h-full w-[calc(100%-100px)]">
        <ModalHeader className="flex pb-0 app-drag">{t('sider.runtimeConfigTitle')}</ModalHeader>
        <ModalBody className="h-full">
          <BaseEditor
            language="yaml"
            value={runtimeConfig}
            originalValue={
              isDiff ? isRaw ? rawProfile : profileConfig : undefined
            }
            readOnly
            diffRenderSideBySide={sideBySide}
          />
        </ModalBody>
        <ModalFooter className="pt-0 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Switch size="sm" isSelected={isDiff} onValueChange={setIsDiff}>
              {t('sider.compareCurrentConfig')}
            </Switch>
            <Switch size="sm" isSelected={sideBySide} onValueChange={setSideBySide}>
              {t('sider.sideBySide')}
            </Switch>
            <Switch
              size="sm"
              isSelected={isRaw}
              onValueChange={(value) => {
                setIsRaw(value)
              }}
            >
              {t('sider.showRawText')}
            </Switch>
          </div>
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default ConfigViewer
