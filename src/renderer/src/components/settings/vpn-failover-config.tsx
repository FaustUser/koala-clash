import React, { useMemo, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Switch } from '@renderer/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useGroups } from '@renderer/hooks/use-groups'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import {
  ArrowDown,
  ArrowUp,
  MessageCircleQuestionMark,
  Plus,
  Trash2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

const BUILTIN_PROXY_TYPES = new Set<MihomoProxyType>([
  'Direct',
  'Reject',
  'RejectDrop',
  'Compatible',
  'Pass',
  'Dns'
])

interface TargetOption {
  key: string
  target: VpnServerFailoverTarget
  label: string
  group: 'profiles' | 'groupProxies'
}

function isLeafProxy(
  proxy: ControllerProxiesDetail | ControllerGroupDetail
): proxy is ControllerProxiesDetail {
  return !('all' in proxy)
}

const VpnFailoverConfig: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { profileConfig } = useProfileConfig()
  const { groups } = useGroups()
  const [selectedOptionKey, setSelectedOptionKey] = useState<string>()

  const {
    disconnectOnVpnServerUnavailable = false,
    vpnServerFailoverTargets = []
  } = appConfig || {}

  const targetOptions = useMemo<TargetOption[]>(() => {
    const profileOptions: TargetOption[] = (profileConfig?.items ?? []).map((profile) => ({
      key: `profile:${profile.id}`,
      target: { type: 'profile', profileId: profile.id },
      label: profile.name,
      group: 'profiles'
    }))

    const groupProxyOptions: TargetOption[] = []
    for (const group of groups ?? []) {
      for (const proxy of group.all) {
        if (!isLeafProxy(proxy) || BUILTIN_PROXY_TYPES.has(proxy.type)) {
          continue
        }

        groupProxyOptions.push({
          key: `groupProxy:${group.name}:${proxy.name}`,
          target: {
            type: 'groupProxy',
            groupName: group.name,
            proxyName: proxy.name
          },
          label: `${group.name} -> ${proxy.name}`,
          group: 'groupProxies'
        })
      }
    }

    return [...profileOptions, ...groupProxyOptions]
  }, [groups, profileConfig?.items])

  const targetOptionMap = useMemo(
    () => new Map(targetOptions.map((option) => [option.key, option])),
    [targetOptions]
  )

  const targetKeys = useMemo(
    () =>
      new Set(
        vpnServerFailoverTargets.map((target) =>
          target.type === 'profile'
            ? `profile:${target.profileId ?? ''}`
            : `groupProxy:${target.groupName ?? ''}:${target.proxyName ?? ''}`
        )
      ),
    [vpnServerFailoverTargets]
  )

  const resolvedTargets = useMemo(
    () =>
      vpnServerFailoverTargets.map((target) => {
        const key =
          target.type === 'profile'
            ? `profile:${target.profileId ?? ''}`
            : `groupProxy:${target.groupName ?? ''}:${target.proxyName ?? ''}`

        const option = targetOptionMap.get(key)
        return {
          key,
          target,
          label: option?.label ?? t('settings.vpnFailover.unavailableTarget'),
          typeLabel:
            target.type === 'profile'
              ? t('settings.vpnFailover.profileTarget')
              : t('settings.vpnFailover.groupProxyTarget')
        }
      }),
    [targetOptionMap, t, vpnServerFailoverTargets]
  )

  const availableToAdd = selectedOptionKey && !targetKeys.has(selectedOptionKey)

  const updateTargets = async (targets: VpnServerFailoverTarget[]): Promise<void> => {
    await patchAppConfig({
      disconnectOnVpnServerUnavailable: targets.length > 0 ? false : disconnectOnVpnServerUnavailable,
      vpnServerFailoverTargets: targets
    })
  }

  const moveTarget = async (index: number, direction: -1 | 1): Promise<void> => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= vpnServerFailoverTargets.length) return

    const nextTargets = [...vpnServerFailoverTargets]
    ;[nextTargets[index], nextTargets[nextIndex]] = [nextTargets[nextIndex], nextTargets[index]]
    await updateTargets(nextTargets)
  }

  const removeTarget = async (index: number): Promise<void> => {
    const nextTargets = vpnServerFailoverTargets.filter((_, itemIndex) => itemIndex !== index)
    await updateTargets(nextTargets)
  }

  const addTarget = async (): Promise<void> => {
    if (!selectedOptionKey) return
    const option = targetOptionMap.get(selectedOptionKey)
    if (!option || targetKeys.has(selectedOptionKey)) return

    await patchAppConfig({
      disconnectOnVpnServerUnavailable: false,
      vpnServerFailoverTargets: [...vpnServerFailoverTargets, option.target]
    })
    setSelectedOptionKey(undefined)
  }

  return (
    <SettingCard title={t('settings.vpnFailover.title')}>
      <SettingItem
        title={t('settings.vpnFailover.disconnectOnUnavailable')}
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost">
                <MessageCircleQuestionMark className="text-lg" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('settings.vpnFailover.disconnectOnUnavailableHelp')}</TooltipContent>
          </Tooltip>
        }
        divider
      >
        <Switch
          checked={disconnectOnVpnServerUnavailable}
          onCheckedChange={(value) => {
            patchAppConfig({
              disconnectOnVpnServerUnavailable: value,
              vpnServerFailoverTargets: value ? [] : vpnServerFailoverTargets
            })
          }}
        />
      </SettingItem>
      <SettingItem
        title={t('settings.vpnFailover.failoverOrder')}
        actions={
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost">
                <MessageCircleQuestionMark className="text-lg" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-80">
              {t('settings.vpnFailover.failoverOrderHelp')}
            </TooltipContent>
          </Tooltip>
        }
      >
        <div className="flex items-center gap-2">
          <Select value={selectedOptionKey} onValueChange={setSelectedOptionKey}>
            <SelectTrigger size="sm" className="w-56">
              <SelectValue placeholder={t('settings.vpnFailover.selectTarget')} />
            </SelectTrigger>
            <SelectContent>
              <SelectLabel>{t('settings.vpnFailover.profiles')}</SelectLabel>
              {targetOptions
                .filter((option) => option.group === 'profiles')
                .map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              <SelectSeparator />
              <SelectLabel>{t('settings.vpnFailover.groupProxies')}</SelectLabel>
              {targetOptions
                .filter((option) => option.group === 'groupProxies')
                .map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={addTarget} disabled={!availableToAdd}>
            <Plus className="size-4" />
            {t('common.add')}
          </Button>
        </div>
      </SettingItem>
      <div className="mt-3 space-y-2">
        {resolvedTargets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stroke px-3 py-4 text-sm text-muted-foreground">
            {t('settings.vpnFailover.empty')}
          </div>
        ) : (
          resolvedTargets.map((item, index) => (
            <div
              key={`${item.key}-${index}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-stroke bg-card/40 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.typeLabel}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={t('settings.vpnFailover.moveUp')}
                  disabled={index === 0}
                  onClick={() => {
                    void moveTarget(index, -1)
                  }}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={t('settings.vpnFailover.moveDown')}
                  disabled={index === resolvedTargets.length - 1}
                  onClick={() => {
                    void moveTarget(index, 1)
                  }}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  title={t('common.remove')}
                  onClick={() => {
                    void removeTarget(index)
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </SettingCard>
  )
}

export default VpnFailoverConfig
