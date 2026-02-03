import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Switch
} from '@heroui/react'
import React, { useEffect, useState } from 'react'
import { BaseEditor } from '../base/base-editor-lazy'
import { getProfileStr, setProfileStr } from '@renderer/utils/ipc'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import ConfirmModal from '../base/base-confirm'
import { useTranslation } from 'react-i18next'

interface Props {
  id: string
  onClose: () => void
}

const EditFileModal: React.FC<Props> = (props) => {
  const { t } = useTranslation()
  const { id, onClose } = props
  const { appConfig: { disableAnimation = false } = {} } = useAppConfig()
  const [currData, setCurrData] = useState('')
  const [originalData, setOriginalData] = useState('')
  const [isDiff, setIsDiff] = useState(false)
  const [sideBySide, setSideBySide] = useState(false)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  const isModified = currData !== originalData

  const handleClose = (): void => {
    if (isModified) {
      setIsConfirmOpen(true)
    } else {
      onClose()
    }
  }

  const getContent = async (): Promise<void> => {
    const data = await getProfileStr(id)
    setCurrData(data)
    setOriginalData(data)
  }

  useEffect(() => {
    getContent()
  }, [])

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
      onOpenChange={handleClose}
      scrollBehavior="inside"
    >
      {isConfirmOpen && (
        <ConfirmModal
          title={t('profile.confirmDiscardTitle')}
          description={t('profile.unsavedChanges')}
          confirmText={t('profile.discardChanges')}
          cancelText={t('profile.keepEditing')}
          onChange={setIsConfirmOpen}
          onConfirm={onClose}
        />
      )}
      <ModalContent className="h-full w-[calc(100%-100px)]">
        <ModalHeader className="flex pb-0 app-drag">
          <div className="flex justify-start">
            <div className="flex items-center">{t('profile.editSubscription')}</div>
          </div>
        </ModalHeader>
        <ModalBody className="h-full">
          <BaseEditor
            language="yaml"
            value={currData}
            originalValue={isDiff ? originalData : undefined}
            onChange={(value) => setCurrData(value)}
            diffRenderSideBySide={sideBySide}
          />
        </ModalBody>
        <ModalFooter className="pt-0 flex justify-between">
          <div className="flex items-center space-x-2">
            <Switch size="sm" isSelected={isDiff} onValueChange={setIsDiff}>
              {t('profile.showChanges')}
            </Switch>
            <Switch size="sm" isSelected={sideBySide} onValueChange={setSideBySide}>
              {t('sider.sideBySide')}
            </Switch>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="light" onPress={handleClose}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              color="primary"
              onPress={async () => {
                await setProfileStr(id, currData)
                onClose()
              }}
            >
              {t('common.save')}
            </Button>
          </div>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default EditFileModal
