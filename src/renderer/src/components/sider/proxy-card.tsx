import { useLocation, useNavigate } from 'react-router-dom'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { Button } from '@renderer/components/ui/button'
import { Group } from 'lucide-react'

const ProxyCard: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { proxyCardStatus = 'col-span-2' } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/proxies')
  return (
    <div className={`${proxyCardStatus} flex justify-center`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant={match ? 'default' : 'ghost'}
            onClick={() => {
              navigate('/proxies')
            }}
          >
            <Group className="text-[20px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('sider.proxyGroup')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export default ProxyCard
