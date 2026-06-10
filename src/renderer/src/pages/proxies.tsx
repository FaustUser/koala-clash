import { Avatar, AvatarImage } from '@renderer/components/ui/avatar'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Spinner } from '@renderer/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import BasePage from '@renderer/components/base/base-page'
import { useAppConfig } from '@renderer/hooks/use-app-config'
import {
  getImageDataURL,
  mihomoChangeProxy,
  mihomoCloseAllConnections,
  mihomoProfileProxies,
  mihomoProxyDelay
} from '@renderer/utils/ipc'
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { GroupedVirtuoso, GroupedVirtuosoHandle } from 'react-virtuoso'
import useSWR from 'swr'
import ProxyItem from '@renderer/components/proxies/proxy-item'
import ProxySettingModal from '@renderer/components/proxies/proxy-setting-modal'
import EditProxyGroupModal from '@renderer/components/proxies/edit-proxy-group-modal'
import { useGroups } from '@renderer/hooks/use-groups'
import CollapseInput from '@renderer/components/base/collapse-input'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { useControledMihomoConfig } from '@renderer/hooks/use-controled-mihomo-config'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import {
  ACTIVE_PROFILE_KEY,
  ALL_PROFILES_KEY,
  buildProfileProxyItems,
  buildProfileOptions,
  getFastestProxy,
  getProxyDelay,
  sortProfileProxies
} from '@renderer/utils/proxyProfile'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsRight,
  ChevronsUpDown,
  Gauge,
  LocateFixed,
  Pencil,
  SlidersHorizontal,
  Trophy
} from 'lucide-react'

const groupTypeColor: Record<string, string> = {
  Selector: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  URLTest: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  Fallback: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  LoadBalance: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  Relay: 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
}
const VPN_GROUP_NAME = 'VPN'

function getDelayText(delay: number | undefined, testText: string, timeoutText: string): string {
  if (delay === undefined) return testText
  if (delay === 0) return timeoutText
  return delay.toString()
}

function getDelayClassName(delay: number | undefined): string {
  if (delay === undefined) return 'text-primary'
  if (delay === 0) return 'text-destructive'
  if (delay < 500) return 'text-success'
  return 'text-warning'
}

function getLastProxyDelay(
  proxy: ControllerProxiesDetail | ControllerGroupDetail
): number | undefined {
  return proxy.history.length > 0 ? proxy.history[proxy.history.length - 1].delay : undefined
}

function isAvailableProxy(proxy: ControllerProxiesDetail | ControllerGroupDetail): boolean {
  const delay = getLastProxyDelay(proxy)
  return proxy.alive !== false && delay !== 0
}

function getCurrentGroupProxyName(group: ControllerMixedGroup): string {
  const availableProxies = group.all.filter(isAvailableProxy)

  if (group.type === 'Fallback') {
    return availableProxies[0]?.name || group.now || group.name
  }

  if (group.type === 'URLTest') {
    return (
      availableProxies
        .filter((proxy) => getLastProxyDelay(proxy) !== undefined)
        .sort((a, b) => (getLastProxyDelay(a) ?? Infinity) - (getLastProxyDelay(b) ?? Infinity))[0]
        ?.name ||
      group.now ||
      group.name
    )
  }

  return group.now || group.name
}

const Proxies: React.FC = () => {
  const { t } = useTranslation()
  const location = useLocation()
  const fromHome = (location.state as { fromHome?: boolean })?.fromHome ?? false
  const { controledMihomoConfig } = useControledMihomoConfig()
  const { mode = 'rule' } = controledMihomoConfig || {}
  const { groups = [], mutate, pauseRefresh, resumeRefresh } = useGroups()
  const { profileConfig } = useProfileConfig()
  const { appConfig } = useAppConfig()
  const {
    proxyDisplayLayout = 'double',
    groupDisplayLayout = 'double',
    proxyDisplayOrder = 'default',
    autoCloseConnection = true,
    proxyCols = 'auto',
    delayTestConcurrency = 50,
    expandProxyGroups = false
  } = appConfig || {}
  const vpnGroup = useMemo(() => groups.find((group) => group.name === VPN_GROUP_NAME), [groups])
  const runtimeGroups = useMemo(
    () => groups.filter((group) => group.name !== VPN_GROUP_NAME),
    [groups]
  )
  const [cols, setCols] = useState(1)
  const [isOpen, setIsOpen] = useState(Array(runtimeGroups.length).fill(expandProxyGroups))
  const [delaying, setDelaying] = useState(Array(runtimeGroups.length).fill(false))
  const [searchValue, setSearchValue] = useState(Array(runtimeGroups.length).fill(''))
  const [vpnSearchValue, setVpnSearchValue] = useState('')
  const [vpnDelaying, setVpnDelaying] = useState(false)
  const [profileFilter, setProfileFilter] = useState(ALL_PROFILES_KEY)
  const [profileDelaying, setProfileDelaying] = useState(false)
  const [profileProxyDelaying, setProfileProxyDelaying] = useState<Record<string, boolean>>({})
  const [isSettingModalOpen, setIsSettingModalOpen] = useState(false)
  const [editingGroupName, setEditingGroupName] = useState<string>()
  const virtuosoRef = useRef<GroupedVirtuosoHandle>(null)
  const { data: profileProxyDetails = [], mutate: mutateProfileProxyDetails } = useSWR<
    ControllerProxiesDetail[]
  >('mihomoProfileProxies', mihomoProfileProxies, {
    errorRetryInterval: 200,
    errorRetryCount: 10,
    refreshInterval: 3000
  })
  const currentProfileName = useMemo(() => {
    const currentItem = profileConfig?.items?.find((item) => item.id === profileConfig.current)
    return currentItem?.name?.trim() || t('proxies.activeProfile')
  }, [profileConfig, t])
  const profileProxies = useMemo(
    () => buildProfileProxyItems(profileProxyDetails, currentProfileName),
    [profileProxyDetails, currentProfileName]
  )
  const profileOptions = useMemo(
    () => buildProfileOptions(profileProxies, t('proxies.allProfiles')),
    [profileProxies, t]
  )
  const filteredProfileProxies = useMemo(() => {
    const filtered =
      profileFilter === ALL_PROFILES_KEY
        ? profileProxies
        : profileProxies.filter((item) => item.profileKey === profileFilter)
    return sortProfileProxies(filtered, proxyDisplayOrder)
  }, [profileFilter, profileProxies, proxyDisplayOrder])
  const fastestProfileProxy = useMemo(
    () => getFastestProxy(filteredProfileProxies),
    [filteredProfileProxies]
  )
  const bestByProfile = useMemo(
    () =>
      profileOptions
        .filter((option) => option.key !== ALL_PROFILES_KEY)
        .map((option) => ({
          option,
          best: getFastestProxy(profileProxies.filter((item) => item.profileKey === option.key))
        })),
    [profileOptions, profileProxies]
  )
  const { groupCounts, allProxies } = useMemo(() => {
    const groupCounts: number[] = []
    const allProxies: (ControllerProxiesDetail | ControllerGroupDetail)[][] = []
    if (runtimeGroups.length !== searchValue.length) {
      setSearchValue(Array(runtimeGroups.length).fill(''))
    }
    runtimeGroups.forEach((group, index) => {
      if (isOpen[index]) {
        let groupProxies = group.all.filter(
          (proxy) => proxy && includesIgnoreCase(proxy.name, searchValue[index])
        )
        const count = Math.floor(groupProxies.length / cols)
        groupCounts.push(groupProxies.length % cols === 0 ? count : count + 1)
        if (proxyDisplayOrder === 'delay') {
          groupProxies = groupProxies.sort((a, b) => {
            if (a.history.length === 0) return -1
            if (b.history.length === 0) return 1
            if (a.history[a.history.length - 1].delay === 0) return 1
            if (b.history[b.history.length - 1].delay === 0) return -1
            return a.history[a.history.length - 1].delay - b.history[b.history.length - 1].delay
          })
        }
        if (proxyDisplayOrder === 'name') {
          groupProxies = groupProxies.sort((a, b) => a.name.localeCompare(b.name))
        }
        allProxies.push(groupProxies)
      } else {
        groupCounts.push(0)
        allProxies.push([])
      }
    })
    return { groupCounts, allProxies }
  }, [runtimeGroups, isOpen, proxyDisplayOrder, cols, searchValue])

  const vpnProxies = useMemo(() => {
    if (!vpnGroup || vpnGroup.type !== 'Selector') return []

    let proxies = vpnGroup.all.filter(
      (proxy) => proxy && includesIgnoreCase(proxy.name, vpnSearchValue)
    )
    if (proxyDisplayOrder === 'delay') {
      proxies = proxies.sort((a, b) => {
        if (a.history.length === 0) return -1
        if (b.history.length === 0) return 1
        if (a.history[a.history.length - 1].delay === 0) return 1
        if (b.history[b.history.length - 1].delay === 0) return -1
        return a.history[a.history.length - 1].delay - b.history[b.history.length - 1].delay
      })
    }
    if (proxyDisplayOrder === 'name') {
      proxies = proxies.sort((a, b) => a.name.localeCompare(b.name))
    }
    return proxies
  }, [vpnGroup, vpnSearchValue, proxyDisplayOrder])

  const allExpanded = useMemo(() => {
    return runtimeGroups.length > 0 && isOpen.every(Boolean)
  }, [runtimeGroups, isOpen])

  const mutateAllProxies = useCallback(() => {
    mutate()
    void mutateProfileProxyDetails()
  }, [mutate, mutateProfileProxyDetails])

  const onChangeProxy = useCallback(
    async (group: string, proxy: string): Promise<void> => {
      await mihomoChangeProxy(group, proxy)
      if (autoCloseConnection) {
        await mihomoCloseAllConnections(group)
      }
      mutateAllProxies()
    },
    [autoCloseConnection, mutateAllProxies]
  )

  const onProxyDelay = useCallback(
    async (proxy: string, url?: string): Promise<ControllerProxiesDelay> => {
      return await mihomoProxyDelay(proxy, url)
    },
    []
  )

  const onGroupDelay = useCallback(
    async (index: number): Promise<void> => {
      if (allProxies[index].length === 0) {
        setIsOpen((prev) => {
          const newOpen = [...prev]
          newOpen[index] = true
          return newOpen
        })
      }
      setDelaying((prev) => {
        const newDelaying = [...prev]
        newDelaying[index] = true
        return newDelaying
      })
      const result: Promise<void>[] = []
      const runningList: Promise<void>[] = []
      for (const proxy of allProxies[index]) {
        const promise = Promise.resolve().then(async () => {
          try {
            await mihomoProxyDelay(proxy.name, runtimeGroups[index].testUrl)
          } catch {
            // ignore
          } finally {
            mutateAllProxies()
          }
        })
        result.push(promise)
        const running = promise.then(() => {
          runningList.splice(runningList.indexOf(running), 1)
        })
        runningList.push(running)
        if (runningList.length >= (delayTestConcurrency || 50)) {
          await Promise.race(runningList)
        }
      }
      await Promise.all(result)
      setDelaying((prev) => {
        const newDelaying = [...prev]
        newDelaying[index] = false
        return newDelaying
      })
    },
    [allProxies, runtimeGroups, delayTestConcurrency, mutateAllProxies]
  )

  const getProfileProxyGroup = useCallback(
    (proxyName: string): ControllerMixedGroup | undefined => {
      if (vpnGroup?.all.some((proxy) => proxy.name === proxyName)) {
        return vpnGroup
      }

      return runtimeGroups.find((group) => group.all.some((proxy) => proxy.name === proxyName))
    },
    [runtimeGroups, vpnGroup]
  )

  const onProfileDelay = useCallback(async (): Promise<void> => {
    setProfileDelaying(true)
    try {
      const result: Promise<void>[] = []
      const runningList: Promise<void>[] = []

      for (const item of filteredProfileProxies) {
        const group = getProfileProxyGroup(item.proxy.name)
        const promise = Promise.resolve().then(async () => {
          try {
            await mihomoProxyDelay(item.proxy.name, group?.testUrl)
          } catch {
            // ignore
          } finally {
            mutateAllProxies()
          }
        })
        result.push(promise)
        const running = promise.then(() => {
          runningList.splice(runningList.indexOf(running), 1)
        })
        runningList.push(running)
        if (runningList.length >= (delayTestConcurrency || 50)) {
          await Promise.race(runningList)
        }
      }

      await Promise.all(result)
    } finally {
      setProfileDelaying(false)
    }
  }, [delayTestConcurrency, filteredProfileProxies, getProfileProxyGroup, mutateAllProxies])

  const onDashboardProxyDelay = useCallback(
    async (proxyName: string, url?: string): Promise<void> => {
      setProfileProxyDelaying((prev) => ({ ...prev, [proxyName]: true }))
      try {
        await mihomoProxyDelay(proxyName, url)
      } catch {
        // ignore
      } finally {
        mutateAllProxies()
        setProfileProxyDelaying((prev) => ({ ...prev, [proxyName]: false }))
      }
    },
    [mutateAllProxies]
  )

  const onSelectFastestProfileProxy = useCallback(async (): Promise<void> => {
    if (!fastestProfileProxy) return
    const group = getProfileProxyGroup(fastestProfileProxy.proxy.name)
    if (!group) return
    await onChangeProxy(group.name, fastestProfileProxy.proxy.name)
  }, [fastestProfileProxy, getProfileProxyGroup, onChangeProxy])

  const calcCols = useCallback((): number => {
    if (window.matchMedia('(min-width: 1536px)').matches) {
      return 5
    } else if (window.matchMedia('(min-width: 1280px)').matches) {
      return 4
    } else if (window.matchMedia('(min-width: 1024px)').matches) {
      return 3
    } else {
      return 2
    }
  }, [])

  const toggleOpen = useCallback((index: number) => {
    setIsOpen((prev) => {
      const newOpen = [...prev]
      newOpen[index] = !prev[index]
      return newOpen
    })
  }, [])

  const toggleAll = useCallback(() => {
    setIsOpen((prev) => {
      const shouldExpand = !prev.every(Boolean)
      return Array(prev.length).fill(shouldExpand)
    })
  }, [])

  const onVpnDelay = useCallback(async (): Promise<void> => {
    if (!vpnGroup) return
    setVpnDelaying(true)
    try {
      const result: Promise<void>[] = []
      const runningList: Promise<void>[] = []
      for (const proxy of vpnGroup.all) {
        const promise = Promise.resolve().then(async () => {
          try {
            await mihomoProxyDelay(proxy.name, vpnGroup.testUrl)
          } catch {
            // ignore
          } finally {
            mutateAllProxies()
          }
        })
        result.push(promise)
        const running = promise.then(() => {
          runningList.splice(runningList.indexOf(running), 1)
        })
        runningList.push(running)
        if (runningList.length >= (delayTestConcurrency || 50)) {
          await Promise.race(runningList)
        }
      }
      await Promise.all(result)
    } finally {
      setVpnDelaying(false)
    }
  }, [vpnGroup, delayTestConcurrency, mutateAllProxies])

  const updateSearchValue = useCallback((index: number, value: string) => {
    setSearchValue((prev) => {
      const newSearchValue = [...prev]
      newSearchValue[index] = value
      return newSearchValue
    })
  }, [])

  const scrollToCurrentProxy = useCallback(
    (index: number) => {
      if (!isOpen[index]) {
        setIsOpen((prev) => {
          const newOpen = [...prev]
          newOpen[index] = true
          return newOpen
        })
      }
      let i = 0
      for (let j = 0; j < index; j++) {
        i += groupCounts[j]
      }
      i += Math.floor(
        allProxies[index].findIndex((proxy) => proxy.name === runtimeGroups[index].now) / cols
      )
      virtuosoRef.current?.scrollToIndex({
        index: Math.floor(i),
        align: 'start'
      })
    },
    [isOpen, groupCounts, allProxies, runtimeGroups, cols]
  )

  useEffect(() => {
    if (!isSettingModalOpen && !editingGroupName) return

    pauseRefresh()
    return (): void => {
      resumeRefresh()
    }
  }, [editingGroupName, isSettingModalOpen, pauseRefresh, resumeRefresh])

  useEffect(() => {
    if (profileOptions.some((option) => option.key === profileFilter)) return
    setProfileFilter(ALL_PROFILES_KEY)
  }, [profileFilter, profileOptions])

  useEffect(() => {
    if (proxyCols !== 'auto') {
      setCols(parseInt(proxyCols))
      return
    }
    setCols(calcCols())
    const handleResize = (): void => {
      setCols(calcCols())
    }
    window.addEventListener('resize', handleResize)
    return (): void => {
      window.removeEventListener('resize', handleResize)
    }
  }, [proxyCols, calcCols])

  const groupContent = useCallback(
    (index: number) => {
      if (
        runtimeGroups[index] &&
        runtimeGroups[index].icon &&
        runtimeGroups[index].icon.startsWith('http') &&
        !localStorage.getItem(runtimeGroups[index].icon)
      ) {
        getImageDataURL(runtimeGroups[index].icon).then((dataURL) => {
          localStorage.setItem(runtimeGroups[index].icon, dataURL)
          mutate()
        })
      }
      const group = runtimeGroups[index]
      if (!group) return <div>Never See This</div>

      const typeColorClass = groupTypeColor[group.type] || 'bg-muted text-muted-foreground'
      const currentProxyName = getCurrentGroupProxyName(group)

      return (
        <div className={`w-full ${!isOpen[index] ? 'pb-2' : ''} px-2`}>
          <Card
            data-guide={index === 0 ? 'proxies-first-group' : undefined}
            data-guide-open={index === 0 ? `${isOpen[index]}` : undefined}
            className="w-full backdrop-blur-3xl cursor-pointer py-0 transition-all duration-200 hover:bg-accent/50 hover:shadow-sm"
            role="button"
            tabIndex={0}
            onClick={() => toggleOpen(index)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                toggleOpen(index)
              }
            }}
          >
            <CardContent className="w-full px-4 py-3">
              <div className="flex justify-between items-center">
                {/* Left side: icon + name + meta */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  {group.icon ? (
                    <Avatar className="bg-transparent rounded-md shrink-0 size-9">
                      <AvatarImage
                        src={
                          group.icon.startsWith('<svg')
                            ? `data:image/svg+xml;utf8,${group.icon}`
                            : localStorage.getItem(group.icon) || group.icon
                        }
                      />
                    </Avatar>
                  ) : null}
                  <div
                    className={`flex ${groupDisplayLayout === 'double' ? 'flex-col gap-0.5' : 'items-center gap-2'} min-w-0`}
                  >
                    <span className="flag-emoji text-sm font-medium truncate leading-tight">
                      {group.name}
                    </span>
                    {groupDisplayLayout !== 'hidden' && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground leading-tight min-w-0">
                        <Badge
                          variant="ghost"
                          className={`text-[10px] px-1.5 py-0 h-4 rounded-md font-medium shrink-0 ${typeColorClass}`}
                        >
                          {group.type}
                        </Badge>
                        <span className="flag-emoji truncate">{currentProxyName}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side: actions */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <div className="flex items-center" onClick={(e) => e.stopPropagation()}>
                    <CollapseInput
                      value={searchValue[index]}
                      onValueChange={(v) => updateSearchValue(index, v)}
                    />
                    <Button
                      title={t('sider.locateCurrentNode')}
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => scrollToCurrentProxy(index)}
                    >
                      <LocateFixed className="text-base" />
                    </Button>
                    <Button
                      title={t('sider.delayTest')}
                      variant="ghost"
                      size="icon-sm"
                      disabled={delaying[index]}
                      aria-busy={delaying[index]}
                      onClick={() => onGroupDelay(index)}
                    >
                      {delaying[index] ? (
                        <Spinner className="size-4" />
                      ) : (
                        <Gauge className="text-base" />
                      )}
                    </Button>
                  </div>
                  <ChevronDown
                    className={`transition-transform duration-200 ml-1 size-5 ${isOpen[index] ? 'rotate-180' : ''}`}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    },
    [
      runtimeGroups,
      isOpen,
      groupDisplayLayout,
      searchValue,
      delaying,
      toggleOpen,
      updateSearchValue,
      scrollToCurrentProxy,
      onGroupDelay,
      mutate,
      t
    ]
  )

  const itemContent = useCallback(
    (index: number, groupIndex: number) => {
      let innerIndex = index
      groupCounts.slice(0, groupIndex).forEach((count) => {
        innerIndex -= count
      })
      return allProxies[groupIndex] ? (
        <div
          data-guide={groupIndex === 0 ? 'proxies-first-group-row' : undefined}
          style={
            proxyCols !== 'auto'
              ? { gridTemplateColumns: `repeat(${proxyCols}, minmax(0, 1fr))` }
              : {}
          }
          className={`grid ${proxyCols === 'auto' ? 'sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : ''} ${innerIndex === groupCounts[groupIndex] - 1 ? 'pb-2' : ''} gap-2 pt-2 mx-2`}
        >
          {Array.from({ length: cols }).map((_, i) => {
            if (!allProxies[groupIndex][innerIndex * cols + i]) return null
            return (
              <ProxyItem
                key={allProxies[groupIndex][innerIndex * cols + i].name}
                mutateProxies={mutate}
                onProxyDelay={onProxyDelay}
                onSelect={onChangeProxy}
                proxy={allProxies[groupIndex][innerIndex * cols + i]}
                group={runtimeGroups[groupIndex]}
                proxyDisplayLayout={proxyDisplayLayout}
                selected={
                  allProxies[groupIndex][innerIndex * cols + i]?.name ===
                  getCurrentGroupProxyName(runtimeGroups[groupIndex])
                }
              />
            )
          })}
        </div>
      ) : (
        <div>Never See This</div>
      )
    },
    [
      groupCounts,
      allProxies,
      proxyCols,
      cols,
      mutate,
      onProxyDelay,
      onChangeProxy,
      runtimeGroups,
      proxyDisplayLayout
    ]
  )

  return (
    <BasePage
      title={t('pages.proxies.title')}
      showBackButton={fromHome}
      header={
        <>
          <Button
            size="icon-sm"
            variant="ghost"
            className="app-nodrag"
            title={allExpanded ? t('pages.proxies.collapseAll') : t('pages.proxies.expandAll')}
            onClick={toggleAll}
          >
            {allExpanded ? (
              <ChevronsDownUp className="text-lg" />
            ) : (
              <ChevronsUpDown className="text-lg" />
            )}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="app-nodrag"
            title={t('pages.proxies.proxyGroupSettings')}
            onClick={() => setIsSettingModalOpen(true)}
          >
            <SlidersHorizontal className="text-lg" />
          </Button>
        </>
      }
    >
      {isSettingModalOpen && <ProxySettingModal onClose={() => setIsSettingModalOpen(false)} />}
      {editingGroupName && (
        <EditProxyGroupModal
          groupName={editingGroupName}
          onClose={() => setEditingGroupName(undefined)}
          onSaved={() => {
            mutate()
          }}
        />
      )}
      {mode === 'direct' ? (
        <div className="h-full w-full flex justify-center items-center">
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-full bg-muted p-6">
              <ChevronsRight className="text-muted-foreground text-5xl" />
            </div>
            <h2 className="text-muted-foreground text-lg font-medium">{t('sider.directMode')}</h2>
          </div>
        </div>
      ) : (
        <div className="h-[calc(100vh-58px)]">
          <div className="px-2 pb-2">
            <div className="px-2 py-1">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t('proxies.profileDashboardTitle')}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('proxies.profileDashboardDescription')}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {profileProxies.length} {t('pages.proxies.nodes')}
                </Badge>
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-stroke bg-card/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Select value={profileFilter} onValueChange={setProfileFilter}>
                  <SelectTrigger size="sm" className="max-w-full min-w-44">
                    <SelectValue placeholder={t('proxies.profileFilter')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {profileOptions.map((option) => (
                        <SelectItem key={option.key} value={option.key}>
                          {option.label} - {option.count}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={profileDelaying || filteredProfileProxies.length === 0}
                  aria-busy={profileDelaying}
                  onClick={() => void onProfileDelay()}
                >
                  {profileDelaying ? <Spinner /> : <Gauge />}
                  {t('proxies.testVisible')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    !fastestProfileProxy || !getProfileProxyGroup(fastestProfileProxy.proxy.name)
                  }
                  onClick={() => void onSelectFastestProfileProxy()}
                >
                  <Trophy />
                  {t('proxies.selectFastest')}
                </Button>
              </div>
              {bestByProfile.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {bestByProfile.map(({ option, best }) => {
                    const delay = best ? getProxyDelay(best.proxy) : undefined
                    return (
                      <Badge key={option.key} variant="ghost" className="max-w-full">
                        <span className="truncate">{option.label}</span>
                        <span className="text-muted-foreground">
                          {best && delay
                            ? `${best.proxy.name} - ${delay}`
                            : t('proxies.noTestedProxy')}
                        </span>
                      </Badge>
                    )
                  })}
                </div>
              )}
            </div>
            {filteredProfileProxies.length > 0 && (
              <div
                style={
                  proxyCols !== 'auto'
                    ? { gridTemplateColumns: `repeat(${proxyCols}, minmax(0, 1fr))` }
                    : {}
                }
                className={`grid ${proxyCols === 'auto' ? 'sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : ''} gap-2 pt-2`}
              >
                {filteredProfileProxies.map((item) => {
                  const group = getProfileProxyGroup(item.proxy.name)
                  const selected = group
                    ? item.proxy.name === getCurrentGroupProxyName(group)
                    : false
                  const delay = getProxyDelay(item.proxy)
                  const delaying = profileProxyDelaying[item.proxy.name] || profileDelaying

                  return (
                    <div key={item.proxy.name} className="flex min-w-0 flex-col gap-1">
                      <div className="flex items-center justify-between gap-2 px-1">
                        <Badge
                          variant={item.profileKey === ACTIVE_PROFILE_KEY ? 'outline' : 'secondary'}
                          className="max-w-full"
                        >
                          <span className="truncate">{item.profileName}</span>
                        </Badge>
                        {fastestProfileProxy?.proxy.name === item.proxy.name && (
                          <Badge variant="ghost">
                            <Trophy />
                            {t('proxies.fastest')}
                          </Badge>
                        )}
                      </div>
                      {group ? (
                        <ProxyItem
                          mutateProxies={mutateAllProxies}
                          onProxyDelay={onProxyDelay}
                          onSelect={onChangeProxy}
                          proxy={item.proxy}
                          group={group}
                          proxyDisplayLayout={proxyDisplayLayout}
                          selected={selected}
                        />
                      ) : (
                        <Card className="w-full gap-0 py-0 transition-all duration-150">
                          <CardContent className="pl-4 pr-3 py-2">
                            <div
                              className={`flex ${proxyDisplayLayout === 'double' ? 'gap-1' : 'justify-between items-center'}`}
                            >
                              <div className="flex min-w-0 flex-1 flex-col gap-0">
                                <span
                                  className="flag-emoji truncate text-sm"
                                  title={item.proxy.name}
                                >
                                  {item.proxy.name}
                                </span>
                                {proxyDisplayLayout !== 'hidden' && (
                                  <span className="mt-0.5 truncate text-[11px] leading-none text-muted-foreground">
                                    {item.proxy.type}
                                  </span>
                                )}
                              </div>
                              <Button
                                variant="ghost"
                                title={item.proxy.type}
                                disabled={delaying}
                                onClick={() => void onDashboardProxyDelay(item.proxy.name)}
                                className={`h-7 px-1.5 text-xs font-medium whitespace-nowrap ${getDelayClassName(delay)}`}
                              >
                                <span className="relative inline-flex items-center justify-center">
                                  {delaying && <Spinner className="absolute size-3" />}
                                  <span className={delaying ? 'invisible' : ''}>
                                    {getDelayText(
                                      delay,
                                      t('proxies.delayTest'),
                                      t('proxies.timeout')
                                    )}
                                  </span>
                                </span>
                              </Button>
                            </div>
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">
                              {t('proxies.notInRoutingGroup')}
                            </div>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
          {vpnGroup && (
            <div className="px-2 pb-2">
              <Card className="border-stroke bg-card/60">
                <CardContent className="px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-sm font-medium">{vpnGroup.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {t('proxies.groupRuntimeSharedBadge')}
                        </Badge>
                        <Badge
                          variant="ghost"
                          className={`text-[10px] px-1.5 py-0 h-4 rounded-md font-medium shrink-0 ${groupTypeColor[vpnGroup.type] || 'bg-muted text-muted-foreground'}`}
                        >
                          {vpnGroup.type}
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {t('proxies.sharedVpnCardDescription')}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {t('proxies.sharedVpnCurrentProxy', {
                          name: getCurrentGroupProxyName(vpnGroup)
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {vpnGroup.type === 'Selector' && (
                        <CollapseInput value={vpnSearchValue} onValueChange={setVpnSearchValue} />
                      )}
                      <Button
                        title={t('proxies.groupEditorOpenVpn')}
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditingGroupName(vpnGroup.name)}
                      >
                        <Pencil className="text-base" />
                      </Button>
                      <Button
                        title={t('sider.locateCurrentNode')}
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          const runtimeIndex = runtimeGroups.findIndex((group) =>
                            group.all.some((proxy) => proxy.name === vpnGroup.now)
                          )
                          if (runtimeIndex >= 0) {
                            scrollToCurrentProxy(runtimeIndex)
                          }
                        }}
                      >
                        <LocateFixed className="text-base" />
                      </Button>
                      <Button
                        title={t('sider.delayTest')}
                        variant="ghost"
                        size="icon-sm"
                        disabled={vpnDelaying}
                        aria-busy={vpnDelaying}
                        onClick={() => void onVpnDelay()}
                      >
                        {vpnDelaying ? (
                          <Spinner className="size-4" />
                        ) : (
                          <Gauge className="text-base" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
              {vpnGroup.type === 'Selector' && vpnProxies.length > 0 && (
                <div
                  style={
                    proxyCols !== 'auto'
                      ? { gridTemplateColumns: `repeat(${proxyCols}, minmax(0, 1fr))` }
                      : {}
                  }
                  className={`grid ${proxyCols === 'auto' ? 'sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' : ''} gap-2 pt-2`}
                >
                  {vpnProxies.map((proxy) => (
                    <ProxyItem
                      key={proxy.name}
                      mutateProxies={mutate}
                      onProxyDelay={onProxyDelay}
                      onSelect={onChangeProxy}
                      proxy={proxy}
                      group={vpnGroup}
                      proxyDisplayLayout={proxyDisplayLayout}
                      selected={proxy.name === vpnGroup.now}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="px-2 pb-2">
            <div className="px-2 py-1">
              <div className="text-sm font-medium">{t('proxies.activeProfileGroupsTitle')}</div>
              <div className="text-xs text-muted-foreground">
                {t('proxies.activeProfileGroupsDescription')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('proxies.activeProfileGroupsReadOnly')}
              </div>
            </div>
          </div>
          <GroupedVirtuoso
            ref={virtuosoRef}
            groupCounts={groupCounts}
            groupContent={groupContent}
            itemContent={itemContent}
          />
        </div>
      )}
    </BasePage>
  )
}

export default Proxies
