import React, { useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Switch } from '@renderer/components/ui/switch'
import { Separator } from '@renderer/components/ui/separator'
import EditFileModal from '../profiles/edit-file-modal'
import { toast } from 'sonner'
import {
  getEditableCurrentProfileProxyGroups,
  getProfileConfig,
  updateCurrentProfileProxyGroup
} from '@renderer/utils/ipc'
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
import { cn } from '@renderer/lib/utils'
import { GripVertical, Info, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  groupName: string
  onClose: () => void
  onSaved: () => void
}

interface SortableProxyItemProps {
  id: string
  disabled: boolean
  onRemove: () => void
}

const parseNonNegativeNumber = (value: string): number | undefined => {
  if (!value) return undefined
  const nextValue = parseInt(value)
  if (Number.isNaN(nextValue)) return undefined
  return Math.max(0, nextValue)
}

const SortableProxyItem: React.FC<SortableProxyItemProps> = ({ id, disabled, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
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
        <span className="truncate text-sm">{id}</span>
      </div>
      <Button size="icon-sm" variant="ghost" disabled={disabled} onClick={onRemove}>
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}

const EditProxyGroupModal: React.FC<Props> = ({ groupName, onClose, onSaved }) => {
  const { t } = useTranslation()
  const [groupConfig, setGroupConfig] = useState<EditableProxyGroupConfig>()
  const [currentProfileId, setCurrentProfileId] = useState<string>()
  const [openProfileYamlEditor, setOpenProfileYamlEditor] = useState(false)
  const [selectedCandidate, setSelectedCandidate] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 2
      }
    })
  )

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoading(true)
      try {
        const profileConfig = await getProfileConfig()
        setCurrentProfileId(profileConfig.current || 'default')
        const groups = await getEditableCurrentProfileProxyGroups()
        const currentGroup = groups.find((item) => item.name === groupName)
        if (!currentGroup) {
          throw new Error(t('proxies.groupEditorNotFound'))
        }
        setGroupConfig(currentGroup)
      } catch (error) {
        toast.error(`${error}`)
        onClose()
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [groupName, onClose, t])

  const availableCandidates = useMemo(() => {
    if (!groupConfig) return []
    return groupConfig.candidates.filter((candidate) => !groupConfig.proxies.includes(candidate))
  }, [groupConfig])

  const isHealthCheckType = groupConfig?.type === 'Fallback' || groupConfig?.type === 'URLTest'
  const isUrlTestType = groupConfig?.type === 'URLTest'
  const isSelectorType = groupConfig?.type === 'Selector'
  const isProviderOnly = groupConfig?.providerOnly ?? false
  const groupTypeDescriptionKey = useMemo(() => {
    if (!groupConfig) return 'proxies.groupTypeSelectorDescription'

    switch (groupConfig.type) {
      case 'Fallback':
        return 'proxies.groupTypeFallbackDescription'
      case 'URLTest':
        return 'proxies.groupTypeUrlTestDescription'
      default:
        return 'proxies.groupTypeSelectorDescription'
    }
  }, [groupConfig])
  const proxyListTitleKey = useMemo(() => {
    if (!groupConfig) return 'proxies.groupEditorProxyListTitleSelector'

    switch (groupConfig.type) {
      case 'Fallback':
        return 'proxies.groupEditorProxyListTitleFallback'
      case 'URLTest':
        return 'proxies.groupEditorProxyListTitleUrlTest'
      default:
        return 'proxies.groupEditorProxyListTitleSelector'
    }
  }, [groupConfig])
  const proxyListHintKey = useMemo(() => {
    if (!groupConfig) return 'proxies.groupEditorProxyListHintSelector'

    switch (groupConfig.type) {
      case 'Fallback':
        return 'proxies.groupEditorProxyListHintFallback'
      case 'URLTest':
        return 'proxies.groupEditorProxyListHintUrlTest'
      default:
        return 'proxies.groupEditorProxyListHintSelector'
    }
  }, [groupConfig])
  const emptyProxyListKey = useMemo(() => {
    if (!groupConfig) return 'proxies.groupEditorEmptySelector'

    switch (groupConfig.type) {
      case 'Fallback':
        return 'proxies.groupEditorEmptyFallback'
      case 'URLTest':
        return 'proxies.groupEditorEmptyUrlTest'
      default:
        return 'proxies.groupEditorEmptySelector'
    }
  }, [groupConfig])

  const moveProxy = (fromIndex: number, toIndex: number): void => {
    if (!groupConfig || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return
    const nextProxies = [...groupConfig.proxies]
    const [movedProxy] = nextProxies.splice(fromIndex, 1)
    if (!movedProxy) return
    nextProxies.splice(toIndex, 0, movedProxy)
    setGroupConfig({ ...groupConfig, proxies: nextProxies })
  }

  const onDragEnd = (event: DragEndEvent): void => {
    if (!groupConfig) return
    const { active, over } = event
    if (!over || active.id === over.id) return
    moveProxy(
      groupConfig.proxies.findIndex((proxy) => proxy === active.id),
      groupConfig.proxies.findIndex((proxy) => proxy === over.id)
    )
  }

  const addCandidate = (): void => {
    if (!groupConfig || !selectedCandidate) return
    if (groupConfig.proxies.includes(selectedCandidate)) return
    setGroupConfig({
      ...groupConfig,
      proxies: [...groupConfig.proxies, selectedCandidate]
    })
    setSelectedCandidate(undefined)
  }

  const removeProxy = (proxyName: string): void => {
    if (!groupConfig) return
    setGroupConfig({
      ...groupConfig,
      proxies: groupConfig.proxies.filter((proxy) => proxy !== proxyName)
    })
  }

  const save = async (): Promise<void> => {
    if (!groupConfig) return
    if (groupConfig.proxies.length === 0) {
      toast.error(t('proxies.groupEditorRequireProxy'))
      return
    }

    setSaving(true)
    try {
      await updateCurrentProfileProxyGroup({
        name: groupConfig.name,
        type: groupConfig.type,
        proxies: groupConfig.proxies,
        url: groupConfig.url,
        interval: groupConfig.interval,
        timeout: groupConfig.timeout,
        lazy: groupConfig.lazy,
        maxFailedTimes: groupConfig.maxFailedTimes,
        tolerance: groupConfig.tolerance,
        expectedStatus: groupConfig.expectedStatus
      })
      onSaved()
      onClose()
    } catch (error) {
      toast.error(`${error}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flag-emoji sm:max-w-2xl max-h-[calc(100vh-120px)] flex flex-col min-h-0"
        showCloseButton={false}
      >
        <DialogHeader className="pb-0">
          <DialogTitle>{t('proxies.groupEditorTitle', { name: groupName })}</DialogTitle>
        </DialogHeader>
        {loading || !groupConfig ? (
          <div className="py-6 text-sm text-muted-foreground">{t('common.loading')}</div>
        ) : (
          <div className="py-2 flex flex-col gap-1 overflow-y-auto min-h-0">
            <div className="rounded-2xl border border-stroke bg-card/40 p-4 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium">{t('proxies.groupEditorType')}</div>
                  <p className="text-sm text-muted-foreground">
                    {t('proxies.groupEditorTypeHint')}
                  </p>
                </div>
                <Select
                  value={groupConfig.type}
                  disabled={isProviderOnly}
                  onValueChange={(value) => {
                    setGroupConfig({
                      ...groupConfig,
                      type: value as EditableProxyGroupType
                    })
                  }}
                >
                  <SelectTrigger size="sm" className="w-44 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="Selector">{t('proxies.groupTypeSelector')}</SelectItem>
                    <SelectItem value="Fallback">{t('proxies.groupTypeFallback')}</SelectItem>
                    <SelectItem value="URLTest">{t('proxies.groupTypeUrlTest')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-xl border border-stroke bg-background/70 p-3">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="space-y-1 text-sm">
                    <div className="font-medium">
                      {groupConfig.type === 'Selector' && t('proxies.groupTypeSelector')}
                      {groupConfig.type === 'Fallback' && t('proxies.groupTypeFallback')}
                      {groupConfig.type === 'URLTest' && t('proxies.groupTypeUrlTest')}
                    </div>
                    <p className="text-muted-foreground">{t(groupTypeDescriptionKey)}</p>
                    <p className="text-muted-foreground">{t('proxies.groupEditorSaveHint')}</p>
                  </div>
                </div>
              </div>

              {isProviderOnly && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      {t('proxies.groupEditorProviderOnlyWarning', {
                        providers: groupConfig.providers.join(', ')
                      })}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="shrink-0"
                      disabled={!currentProfileId}
                      onClick={() => setOpenProfileYamlEditor(true)}
                    >
                      {t('proxies.groupEditorOpenYaml')}
                    </Button>
                  </div>
                </div>
              )}

              {isHealthCheckType && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <div className="space-y-1">
                    <div className="text-sm font-medium">
                      {t('proxies.groupEditorHealthSection')}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t('proxies.groupEditorHealthSectionHint')}
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <div className="text-sm font-medium">{t('proxies.groupEditorTestUrl')}</div>
                      <Input
                        className="h-8"
                        disabled={isProviderOnly || saving}
                        value={groupConfig.url ?? ''}
                        placeholder={t('proxies.groupEditorTestUrlPlaceholder')}
                        onChange={(event) => {
                          setGroupConfig({ ...groupConfig, url: event.target.value })
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('proxies.groupEditorTestUrlHint')}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-sm font-medium">
                        {t('proxies.groupEditorInterval')}
                        <span className="ml-1 text-muted-foreground">
                          {t('proxies.groupEditorSecondsUnit')}
                        </span>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        className="h-8"
                        disabled={isProviderOnly || saving}
                        value={groupConfig.interval?.toString() ?? ''}
                        placeholder={t('proxies.groupEditorIntervalPlaceholder')}
                        onChange={(event) => {
                          setGroupConfig({
                            ...groupConfig,
                            interval: parseNonNegativeNumber(event.target.value)
                          })
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('proxies.groupEditorIntervalHint')}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-sm font-medium">
                        {t('proxies.groupEditorTimeout')}
                        <span className="ml-1 text-muted-foreground">
                          {t('proxies.groupEditorMillisecondsUnit')}
                        </span>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        className="h-8"
                        disabled={isProviderOnly || saving}
                        value={groupConfig.timeout?.toString() ?? ''}
                        placeholder={t('proxies.groupEditorTimeoutPlaceholder')}
                        onChange={(event) => {
                          setGroupConfig({
                            ...groupConfig,
                            timeout: parseNonNegativeNumber(event.target.value)
                          })
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('proxies.groupEditorTimeoutHint')}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-sm font-medium">
                        {t('proxies.groupEditorMaxFailedTimes')}
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        className="h-8"
                        disabled={isProviderOnly || saving}
                        value={groupConfig.maxFailedTimes?.toString() ?? ''}
                        placeholder={t('proxies.groupEditorMaxFailedTimesPlaceholder')}
                        onChange={(event) => {
                          setGroupConfig({
                            ...groupConfig,
                            maxFailedTimes: parseNonNegativeNumber(event.target.value)
                          })
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('proxies.groupEditorMaxFailedTimesHint')}
                      </p>
                    </div>

                    {isUrlTestType && (
                      <>
                        <div className="space-y-1.5">
                          <div className="text-sm font-medium">
                            {t('proxies.groupEditorTolerance')}
                            <span className="ml-1 text-muted-foreground">
                              {t('proxies.groupEditorMillisecondsUnit')}
                            </span>
                          </div>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            className="h-8"
                            disabled={isProviderOnly || saving}
                            value={groupConfig.tolerance?.toString() ?? ''}
                            placeholder={t('proxies.groupEditorTolerancePlaceholder')}
                            onChange={(event) => {
                              setGroupConfig({
                                ...groupConfig,
                                tolerance: parseNonNegativeNumber(event.target.value)
                              })
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('proxies.groupEditorToleranceHint')}
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <div className="text-sm font-medium">
                            {t('proxies.groupEditorExpectedStatus')}
                          </div>
                          <Input
                            className="h-8"
                            disabled={isProviderOnly || saving}
                            value={groupConfig.expectedStatus ?? ''}
                            placeholder={t('proxies.groupEditorExpectedStatusPlaceholder')}
                            onChange={(event) => {
                              setGroupConfig({
                                ...groupConfig,
                                expectedStatus: event.target.value
                              })
                            }}
                          />
                          <p className="text-xs text-muted-foreground">
                            {t('proxies.groupEditorExpectedStatusHint')}
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-xl border border-stroke bg-background/70 px-3 py-2">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">{t('proxies.groupEditorLazy')}</div>
                      <p className="text-sm text-muted-foreground">
                        {t('proxies.groupEditorLazyHint')}
                      </p>
                    </div>
                    <Switch
                      disabled={isProviderOnly || saving}
                      checked={groupConfig.lazy ?? false}
                      onCheckedChange={(value) => {
                        setGroupConfig({ ...groupConfig, lazy: value })
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {groupConfig.usesProviders && (
              <div className="rounded-xl border border-stroke bg-card/40 px-3 py-2 text-sm text-muted-foreground">
                {t('proxies.groupEditorProviderWarning', {
                  providers: groupConfig.providers.join(', ')
                })}
              </div>
            )}

            {!isSelectorType && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="text-md leading-8">{t(proxyListTitleKey)}</div>
                  <p className="text-sm text-muted-foreground">{t(proxyListHintKey)}</p>
                  <div className="flex w-full items-center gap-2">
                    <Select
                      value={selectedCandidate}
                      disabled={isProviderOnly || saving}
                      onValueChange={setSelectedCandidate}
                    >
                      <SelectTrigger size="sm" className="min-w-0 flex-1">
                        <SelectValue placeholder={t('proxies.groupEditorAddNode')} />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {availableCandidates.map((candidate) => (
                          <SelectItem key={candidate} value={candidate}>
                            {candidate}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      disabled={!selectedCandidate || isProviderOnly || saving}
                      className="shrink-0"
                      onClick={addCandidate}
                    >
                      <Plus className="size-4" />
                      {t('common.add')}
                    </Button>
                  </div>
                </div>
                <Separator />
              </div>
            )}

            {!isSelectorType && (
              <div className="space-y-2 pb-2">
                {groupConfig.proxies.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-stroke px-3 py-4 text-sm text-muted-foreground">
                    {t(emptyProxyListKey)}
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={onDragEnd}
                  >
                    <SortableContext items={groupConfig.proxies}>
                      <div className="space-y-2">
                        {groupConfig.proxies.map((proxy) => (
                          <SortableProxyItem
                            key={proxy}
                            id={proxy}
                            disabled={saving || isProviderOnly}
                            onRemove={() => removeProxy(proxy)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            )}
          </div>
        )}
      <DialogFooter>
          <DialogClose asChild>
            <Button size="sm" variant="ghost" disabled={saving}>
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            size="sm"
            disabled={loading || saving || !groupConfig || isProviderOnly}
            onClick={() => void save()}
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
      {openProfileYamlEditor && currentProfileId && (
        <EditFileModal
          id={currentProfileId}
          onClose={() => {
            setOpenProfileYamlEditor(false)
            void (async () => {
              try {
                const groups = await getEditableCurrentProfileProxyGroups()
                const currentGroup = groups.find((item) => item.name === groupName)
                if (currentGroup) {
                  setGroupConfig(currentGroup)
                }
              } catch {
                // ignore refresh failure, modal already has existing state
              }
            })()
          }}
        />
      )}
    </Dialog>
  )
}

export default EditProxyGroupModal
