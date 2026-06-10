export const ALL_PROFILES_KEY = 'all'
export const ACTIVE_PROFILE_KEY = '__active__'

export interface ProfileProxyItem {
  proxy: ControllerProxiesDetail
  profileName: string
  profileKey: string
  isCurrentProfile: boolean
}

export interface ProfileFilterOption {
  key: string
  label: string
  count: number
}

export type ProfileProxyOrder = 'default' | 'delay' | 'name'

function isLeafProxy(
  proxy: ControllerProxiesDetail | ControllerGroupDetail
): proxy is ControllerProxiesDetail {
  return !('all' in proxy)
}

export function getProxyDelay(proxy: ControllerProxiesDetail): number | undefined {
  return proxy.history.length > 0 ? proxy.history[proxy.history.length - 1].delay : undefined
}

export function buildProfileProxyItems(
  proxies: ControllerProxiesDetail[],
  activeProfileLabel = 'Active profile'
): ProfileProxyItem[] {
  const seen = new Set<string>()
  const items: ProfileProxyItem[] = []

  for (const proxy of proxies) {
    if (seen.has(proxy.name)) continue
    seen.add(proxy.name)

    const sourceProfileName = proxy.serverDescription?.trim()
    const isCurrentProfile = !sourceProfileName
    const profileName = sourceProfileName || activeProfileLabel
    items.push({
      proxy,
      profileName,
      profileKey: isCurrentProfile ? ACTIVE_PROFILE_KEY : profileName,
      isCurrentProfile
    })
  }

  return items
}

export function flattenProfileProxies(
  groups: ControllerMixedGroup[],
  activeProfileLabel = 'Active profile'
): ProfileProxyItem[] {
  const seen = new Set<string>()
  const proxies: ControllerProxiesDetail[] = []

  for (const group of groups) {
    for (const proxy of group.all) {
      if (!isLeafProxy(proxy) || seen.has(proxy.name)) continue
      seen.add(proxy.name)
      proxies.push(proxy)
    }
  }

  return buildProfileProxyItems(proxies, activeProfileLabel)
}

export function buildProfileOptions(
  proxies: ProfileProxyItem[],
  allProfilesLabel = 'All profiles'
): ProfileFilterOption[] {
  const options = new Map<string, ProfileFilterOption>()

  for (const item of proxies) {
    const current = options.get(item.profileKey)
    if (current) {
      current.count += 1
      continue
    }

    options.set(item.profileKey, {
      key: item.profileKey,
      label: item.profileName,
      count: 1
    })
  }

  return [
    { key: ALL_PROFILES_KEY, label: allProfilesLabel, count: proxies.length },
    ...options.values()
  ]
}

function delayRank(proxy: ControllerProxiesDetail): number {
  const delay = getProxyDelay(proxy)
  if (delay === 0 || proxy.alive === false) return Number.POSITIVE_INFINITY
  if (delay === undefined) return Number.MAX_SAFE_INTEGER
  return delay
}

export function sortProfileProxies(
  proxies: ProfileProxyItem[],
  order: ProfileProxyOrder
): ProfileProxyItem[] {
  const result = [...proxies]

  if (order === 'delay') {
    return result.sort((a, b) => delayRank(a.proxy) - delayRank(b.proxy))
  }

  if (order === 'name') {
    return result.sort((a, b) => a.proxy.name.localeCompare(b.proxy.name))
  }

  return result
}

export function getFastestProxy(proxies: ProfileProxyItem[]): ProfileProxyItem | undefined {
  return sortProfileProxies(
    proxies.filter((item) => {
      const delay = getProxyDelay(item.proxy)
      return item.proxy.alive !== false && delay !== undefined && delay > 0
    }),
    'delay'
  )[0]
}
