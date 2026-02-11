import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { IoHomeOutline, IoLink, IoJournalOutline, IoSettings } from 'react-icons/io5'
import { LuGroup } from 'react-icons/lu'
import { MdOutlineAltRoute } from 'react-icons/md'
import { TiFolder } from 'react-icons/ti'
import { PanelLeft } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '@renderer/components/ui/sidebar'
import OutboundModeSwitcher from '@renderer/components/sider/outbound-mode-switcher'
import UpdaterButton from '@renderer/components/updater/updater-button'
import ConfigViewer from '@renderer/components/sider/config-viewer'

interface AppSidebarProps {
  latest?: {
    version: string
    changelog: string
  }
}

const navItems = [
  { key: 'main', path: '/home', icon: IoHomeOutline, i18nKey: 'sider.home' },
  { key: 'profile', path: '/profiles', icon: TiFolder, i18nKey: 'sider.profileManagement' },
  { key: 'proxy', path: '/proxies', icon: LuGroup, i18nKey: 'sider.proxyGroup' },
  { key: 'connection', path: '/connections', icon: IoLink, i18nKey: 'sider.connection' },
  { key: 'rule', path: '/rules', icon: MdOutlineAltRoute, i18nKey: 'sider.rules' },
  { key: 'log', path: '/logs', icon: IoJournalOutline, i18nKey: 'sider.logs' },
  { key: 'settings', path: '/settings', icon: IoSettings, i18nKey: 'common.settings' }
]

const AppSidebar: React.FC<AppSidebarProps> = ({ latest }) => {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { toggleSidebar, state } = useSidebar()
  const collapsed = state === 'collapsed'
  const [showRuntimeConfig, setShowRuntimeConfig] = useState(false)

  return (
    <Sidebar
      collapsible="icon"
      side="left"
      variant="floating"
      className="pt-[57px]"
    >
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = location.pathname.includes(item.path)
                return (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      tooltip={t(item.i18nKey)}
                      isActive={isActive}
                      onClick={() => navigate(item.path)}
                      onDoubleClick={
                        item.key === 'profile' ? () => setShowRuntimeConfig(true) : undefined
                      }
                    >
                      <Icon className="text-[20px]" />
                      <span>{t(item.i18nKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex flex-col items-center gap-2">
          <OutboundModeSwitcher iconOnly={collapsed} />
          {latest && latest.version && <UpdaterButton iconOnly={collapsed} latest={latest} />}
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton tooltip={t('common.toggleSidebar')} onClick={toggleSidebar}>
                <PanelLeft className="text-[20px]" />
                <span>{t('common.toggleSidebar')}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarFooter>
      {showRuntimeConfig && <ConfigViewer onClose={() => setShowRuntimeConfig(false)} />}
    </Sidebar>
  )
}

export default AppSidebar
