import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { IoHomeOutline } from 'react-icons/io5'


interface Props {
  iconOnly?: boolean
}

const HomeCard: React.FC<Props> = () => {
  const { t } = useTranslation()
  const { appConfig } = useAppConfig()
  const { homeCardStatus = 'col-span-1' } = appConfig || {}
  const location = useLocation()
  const navigate = useNavigate()
  const match = location.pathname.includes('/home')

  return (
    <div className={`${homeCardStatus} flex justify-center`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            size="icon-sm"
            variant={match ? 'default' : 'ghost'}
            onClick={() => {
              navigate('/home')
            }}
          >
            <IoHomeOutline className="text-[20px]" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('sider.home')}</TooltipContent>
      </Tooltip>
    </div>
  )
}

export default HomeCard
