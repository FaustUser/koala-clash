import { getProfile, getProfileConfig, setProfileStr } from './profile'
import { stringifyYaml } from '../utils/yaml'

const BUILTIN_PROXY_CANDIDATES = ['DIRECT']
const RAW_TO_EDITABLE_GROUP_TYPE: Record<string, EditableProxyGroupType> = {
  select: 'Selector',
  selector: 'Selector',
  fallback: 'Fallback',
  'url-test': 'URLTest',
  urltest: 'URLTest'
}
const EDITABLE_TO_RAW_GROUP_TYPE: Record<EditableProxyGroupType, string> = {
  Selector: 'select',
  Fallback: 'fallback',
  URLTest: 'url-test'
}

interface MihomoNamedProxy {
  name?: string
}

interface MihomoProxyGroupRecord {
  name?: string
  type?: string
  proxies?: string[]
  use?: string[]
  url?: string
  interval?: number
  timeout?: number
  lazy?: boolean
  'max-failed-times'?: number
  tolerance?: number
  'expected-status'?: string
  [key: string]: unknown
}

function isNamedProxy(proxy: unknown): proxy is MihomoNamedProxy {
  return !!proxy && typeof proxy === 'object' && 'name' in proxy && typeof proxy.name === 'string'
}

function isProxyGroupRecord(group: unknown): group is MihomoProxyGroupRecord {
  return !!group && typeof group === 'object' && 'name' in group && typeof group.name === 'string'
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function getUniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
}

function parseGroupType(value: unknown): EditableProxyGroupType {
  if (typeof value !== 'string') return 'Selector'
  return RAW_TO_EDITABLE_GROUP_TYPE[value.toLowerCase()] ?? 'Selector'
}

function isEditableGroupType(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase() in RAW_TO_EDITABLE_GROUP_TYPE
}

function toOptionalPositiveNumber(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return undefined
  }
  return Math.trunc(value)
}

export async function getEditableCurrentProfileProxyGroups(): Promise<EditableProxyGroupConfig[]> {
  const { current } = await getProfileConfig()
  const profile = await getProfile(current)
  const rawProxies = Array.isArray(profile.proxies) ? (profile.proxies as unknown[]) : []
  const rawProxyGroups = Array.isArray(profile['proxy-groups'])
    ? (profile['proxy-groups'] as unknown[])
    : []
  const proxyNames = getUniqueStrings(
    rawProxies.filter(isNamedProxy).map((proxy) => proxy.name!)
  )

  const proxyGroups = rawProxyGroups.filter(isProxyGroupRecord)
  const groupNames = getUniqueStrings(proxyGroups.map((group) => group.name!))

  return proxyGroups
    .filter((group) => isEditableGroupType(group.type))
    .map((group) => {
      const proxies = getStringArray(group.proxies)
      const providers = getStringArray(group.use)

      return {
        name: group.name!,
        type: parseGroupType(group.type),
        proxies,
        candidates: getUniqueStrings(
          proxies.concat(proxyNames, groupNames.filter((name) => name !== group.name), BUILTIN_PROXY_CANDIDATES)
        ),
        usesProviders: providers.length > 0,
        providerOnly: providers.length > 0 && proxies.length === 0,
        providers,
        url: typeof group.url === 'string' ? group.url : undefined,
        interval: typeof group.interval === 'number' ? group.interval : undefined,
        timeout: typeof group.timeout === 'number' ? group.timeout : undefined,
        lazy: typeof group.lazy === 'boolean' ? group.lazy : undefined,
        maxFailedTimes:
          typeof group['max-failed-times'] === 'number' ? group['max-failed-times'] : undefined,
        tolerance: typeof group.tolerance === 'number' ? group.tolerance : undefined,
        expectedStatus:
          typeof group['expected-status'] === 'string' ? group['expected-status'] : undefined
      }
    })
}

export async function updateCurrentProfileProxyGroup(
  patch: EditableProxyGroupPatch
): Promise<void> {
  const { current } = await getProfileConfig()
  const profile = await getProfile(current)
  const rawProxyGroups = Array.isArray(profile['proxy-groups'])
    ? (profile['proxy-groups'] as unknown[])
    : []
  const proxyGroups = rawProxyGroups.filter(isProxyGroupRecord)
  const groupIndex = proxyGroups.findIndex((group) => group.name === patch.name)

  if (groupIndex === -1) {
    throw new Error(`Proxy group "${patch.name}" not found`)
  }

  const targetGroup = proxyGroups[groupIndex]
  targetGroup.type = EDITABLE_TO_RAW_GROUP_TYPE[patch.type]
  targetGroup.proxies = getUniqueStrings(patch.proxies)

  const url = patch.url?.trim()
  if (url) {
    targetGroup.url = url
  } else {
    delete targetGroup.url
  }

  const interval = toOptionalPositiveNumber(patch.interval)
  if (interval !== undefined) {
    targetGroup.interval = interval
  } else {
    delete targetGroup.interval
  }

  const timeout = toOptionalPositiveNumber(patch.timeout)
  if (timeout !== undefined) {
    targetGroup.timeout = timeout
  } else {
    delete targetGroup.timeout
  }

  if (typeof patch.lazy === 'boolean') {
    targetGroup.lazy = patch.lazy
  } else {
    delete targetGroup.lazy
  }

  const maxFailedTimes = toOptionalPositiveNumber(patch.maxFailedTimes)
  if (maxFailedTimes !== undefined) {
    targetGroup['max-failed-times'] = maxFailedTimes
  } else {
    delete targetGroup['max-failed-times']
  }

  const tolerance = toOptionalPositiveNumber(patch.tolerance)
  if (patch.type === 'URLTest' && tolerance !== undefined) {
    targetGroup.tolerance = tolerance
  } else {
    delete targetGroup.tolerance
  }

  const expectedStatus = patch.expectedStatus?.trim()
  if (expectedStatus) {
    targetGroup['expected-status'] = expectedStatus
  } else {
    delete targetGroup['expected-status']
  }

  profile['proxy-groups'] = proxyGroups as unknown as []
  await setProfileStr(current || 'default', stringifyYaml(profile))
}
