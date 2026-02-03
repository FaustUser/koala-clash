import { MdOutlineAltRoute } from 'react-icons/md'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { Button } from '@renderer/components/ui/button'

const RuleCard: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { ruleCardStatus = 'col-span-1' } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/rules')

  return (
    <div className={`${ruleCardStatus} flex justify-center`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant={match ? 'default' : 'ghost'}
            onClick={() => {
              navigate('/rules')
            }}
          >
            <MdOutlineAltRoute className="text-[20px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('sider.rules')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export default RuleCard
