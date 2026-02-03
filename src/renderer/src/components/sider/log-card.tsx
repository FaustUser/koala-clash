import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { IoJournalOutline } from 'react-icons/io5'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React from 'react'
import { useTranslation } from 'react-i18next'

const LogCard: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { logCardStatus = 'col-span-1' } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/logs')

  return (
    <div className={`${logCardStatus} flex justify-center`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant={match ? 'default' : 'ghost'}
            onClick={() => {
              navigate('/logs')
            }}
          >
            <IoJournalOutline className="text-[20px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('sider.logs')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export default LogCard
