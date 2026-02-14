import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useLocation, useNavigate } from 'react-router-dom'
import React from 'react'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useTranslation } from 'react-i18next'
import { Link2 } from 'lucide-react'

const ConnCard: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { connectionCardStatus = 'col-span-2' } = appConfig || {}

  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/connections')

  return (
    <div className={`${connectionCardStatus} flex justify-center`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant={match ? 'default' : 'ghost'}
            onClick={() => {
              navigate('/connections')
            }}
          >
            <Link2 className="text-[20px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('sider.connection')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export default ConnCard
