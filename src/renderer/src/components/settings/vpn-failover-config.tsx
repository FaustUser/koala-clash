import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import { Switch } from '@renderer/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { getVpnServerFailoverCatalog } from '@renderer/utils/ipc'
import {
  DndContext,
  closestCenter,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import { SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, MessageCircleQuestionMark, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

interface ResolvedTarget {
  key: string
  sortableId: string
  target: VpnServerFailoverTarget
  label: string
  typeLabel: string
}

interface SortableTargetItemProps {
  item: ResolvedTarget
  disabled: boolean
  onRemove: () => void
  removeTitle: string
}

const SortableTargetItem: React.FC<SortableTargetItemProps> = ({
  item,
  disabled,
  onRemove,
  removeTitle
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.sortableId,
    disabled
  })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 'calc(infinity)' : undefined
      }}
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border border-stroke bg-card/40 px-3 py-2',
        disabled && 'opacity-60'
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Button
          size="icon-sm"
          variant="ghost"
          className={cn('cursor-grab active:cursor-grabbing', disabled && 'cursor-not-allowed')}
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </Button>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{item.label}</div>
          <div className="text-xs text-muted-foreground">{item.typeLabel}</div>
        </div>
      </div>
      <Button size="icon-sm" variant="ghost" title={removeTitle} disabled={disabled} onClick={onRemove}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}

const VpnFailoverConfig: React.FC = () => {
  const { t } = useTranslation()
  const { appConfig, patchAppConfig } = useAppConfig()
  const { profileConfig } = useProfileConfig()
  const { data: targetOptions = [], mutate: mutateTargetOptions } = useSWR(
    'getVpnServerFailoverCatalog',
    getVpnServerFailoverCatalog
  )
  const [selectedOptionKey, setSelectedOptionKey] = useState<string>()
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 2
      }
    })
  )

  const {
    disconnectOnVpnServerUnavailable = false,
    vpnServerFailoverTargets = []
  } = appConfig || {}

  useEffect(() => {
    void mutateTargetOptions()
  }, [mutateTargetOptions, profileConfig])

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
            : `groupProxy:${target.profileId ?? ''}:${target.groupName ?? ''}:${target.proxyName ?? ''}`
        )
      ),
    [vpnServerFailoverTargets]
  )

  const resolvedTargets = useMemo<ResolvedTarget[]>(
    () =>
      vpnServerFailoverTargets.map((target, index) => {
        const key =
          target.type === 'profile'
            ? `profile:${target.profileId ?? ''}`
            : `groupProxy:${target.profileId ?? ''}:${target.groupName ?? ''}:${target.proxyName ?? ''}`

        const option = targetOptionMap.get(key)
        return {
          key,
          sortableId: `${key}-${index}`,
          target,
          label:
            option?.label ??
            (target.type === 'groupProxy' && target.groupName && target.proxyName
              ? `${target.groupName} -> ${target.proxyName}`
              : t('settings.vpnFailover.unavailableTarget')),
          typeLabel:
            target.type === 'profile'
              ? t('settings.vpnFailover.profileTarget')
              : t('settings.vpnFailover.groupProxyTarget')
        }
      }),
    [targetOptionMap, t, vpnServerFailoverTargets]
  )

  const selectableTargetOptions = useMemo(
    () => targetOptions.filter((option) => !targetKeys.has(option.key)),
    [targetKeys, targetOptions]
  )

  const updateTargets = async (targets: VpnServerFailoverTarget[]): Promise<void> => {
    await patchAppConfig({ vpnServerFailoverTargets: targets })
  }

  const moveTarget = async (fromIndex: number, toIndex: number): Promise<void> => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
    const nextTargets = [...vpnServerFailoverTargets]
    const [movedTarget] = nextTargets.splice(fromIndex, 1)
    if (!movedTarget) return
    nextTargets.splice(toIndex, 0, movedTarget)
    await updateTargets(nextTargets)
  }

  const removeTarget = async (index: number): Promise<void> => {
    const nextTargets = vpnServerFailoverTargets.filter((_, itemIndex) => itemIndex !== index)
    await updateTargets(nextTargets)
  }

  const addTarget = async (optionKey: string): Promise<void> => {
    const option = targetOptionMap.get(optionKey)
    if (!option || targetKeys.has(optionKey)) return

    await patchAppConfig({
      disconnectOnVpnServerUnavailable: false,
      vpnServerFailoverTargets: [...vpnServerFailoverTargets, option.target]
    })
    setSelectedOptionKey(undefined)
  }

  const onDragEnd = async (event: DragEndEvent): Promise<void> => {
    if (disconnectOnVpnServerUnavailable) {
      return
    }

    const { active, over } = event
    if (!over || active.id === over.id) {
      return
    }

    const fromIndex = resolvedTargets.findIndex((item) => item.sortableId === active.id)
    const toIndex = resolvedTargets.findIndex((item) => item.sortableId === over.id)
    await moveTarget(fromIndex, toIndex)
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
            <TooltipContent className="max-w-80 whitespace-normal break-words">
              {t('settings.vpnFailover.disconnectOnUnavailableHelp')}
            </TooltipContent>
          </Tooltip>
        }
        divider
      >
        <Switch
          checked={disconnectOnVpnServerUnavailable}
          onCheckedChange={(value) => {
            patchAppConfig({ disconnectOnVpnServerUnavailable: value })
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
            <TooltipContent className="max-w-80 whitespace-normal break-words">
              {t('settings.vpnFailover.failoverOrderHelp')}
            </TooltipContent>
          </Tooltip>
        }
      >
        <div
          className={cn(
            'flex items-center gap-2',
            disconnectOnVpnServerUnavailable && 'pointer-events-none opacity-60'
          )}
        >
          <Select
            disabled={disconnectOnVpnServerUnavailable || selectableTargetOptions.length === 0}
            value={selectedOptionKey}
            onValueChange={(value) => {
              setSelectedOptionKey(undefined)
              void addTarget(value)
            }}
          >
            <SelectTrigger size="sm" className="w-56">
              <SelectValue placeholder={t('settings.vpnFailover.selectTarget')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>{t('settings.vpnFailover.profiles')}</SelectLabel>
                {selectableTargetOptions
                  .filter((option) => option.group === 'profiles')
                  .map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>{t('settings.vpnFailover.groupProxies')}</SelectLabel>
                {selectableTargetOptions
                  .filter((option) => option.group === 'groupProxies')
                  .map((option) => (
                    <SelectItem key={option.key} value={option.key}>
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </SettingItem>
      <div className="mt-3 space-y-2">
        {resolvedTargets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stroke px-3 py-4 text-sm text-muted-foreground">
            {t('settings.vpnFailover.empty')}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => {
              void onDragEnd(event)
            }}
          >
            <SortableContext items={resolvedTargets.map((item) => item.sortableId)}>
              <div className="space-y-2">
                {resolvedTargets.map((item, index) => (
                  <SortableTargetItem
                    key={item.sortableId}
                    item={item}
                    disabled={disconnectOnVpnServerUnavailable}
                    removeTitle={t('common.remove')}
                    onRemove={() => {
                      void removeTarget(index)
                    }}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </SettingCard>
  )
}

export default VpnFailoverConfig
