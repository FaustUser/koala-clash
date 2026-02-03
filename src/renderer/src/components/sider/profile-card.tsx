import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import React, { useState } from 'react'
import ConfigViewer from './config-viewer'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { TiFolder } from 'react-icons/ti'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { Button } from '@renderer/components/ui/button'

const ProfileCard: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { profileCardStatus = 'col-span-2' } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/profiles')
  const [showRuntimeConfig, setShowRuntimeConfig] = useState(false)

  return (
    <div className={`${profileCardStatus} flex justify-center`}>
      {showRuntimeConfig && <ConfigViewer onClose={() => setShowRuntimeConfig(false)} />}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant={match ? 'default' : 'ghost'}
            onClick={() => {
                navigate('/profiles')
              }}
            onDoubleClick={() => {
              setShowRuntimeConfig(true)
            }}
          >
            <TiFolder className="text-[20px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('sider.profileManagement')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export default ProfileCard
