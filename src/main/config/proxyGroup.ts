import { getAppConfig, patchAppConfig } from './app'
import { getProfile, getProfileConfig } from './profile'
import { getMergedProfileProxies } from './profileMerge'
import { buildCandidateProfileLabels } from './proxyGroupLabels'

const BUILTIN_PROXY_CANDIDATES = ['DIRECT']
const VPN_RULE_TARGET = 'VPN'
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

function sanitizeProxySelections(selections: string[], candidates: string[]): string[] {
  const validCandidates = new Set(candidates)
  return getUniqueStrings(selections).filter((selection) => validCandidates.has(selection))
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

function buildEditableGroupConfig(
  group: MihomoProxyGroupRecord,
  proxyNames: string[],
  groupNames: string[],
  extra?: Partial<EditableProxyGroupConfig>
): EditableProxyGroupConfig {
  const proxies = getStringArray(group.proxies)
  const providers = getStringArray(group.use)

  return {
    name: group.name!,
    type: parseGroupType(group.type),
    proxies,
    candidates: getUniqueStrings(
      proxies.concat(
        proxyNames,
        groupNames.filter((name) => name !== group.name),
        BUILTIN_PROXY_CANDIDATES
      )
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
      typeof group['expected-status'] === 'string' ? group['expected-status'] : undefined,
    ...extra
  }
}

function getVpnRoutingGroupProxies(
  vpnRoutingGroup: GlobalVpnRoutingGroupConfig | undefined,
  proxyNames: string[],
  candidates: string[]
): string[] {
  if (vpnRoutingGroup?.type === 'Selector') {
    return proxyNames
  }

  const configuredProxies = vpnRoutingGroup?.proxies?.length
    ? sanitizeProxySelections(vpnRoutingGroup.proxies, candidates)
    : []

  return configuredProxies.length > 0 ? configuredProxies : proxyNames
}

async function getEditableRuntimeProxyGroups(): Promise<EditableProxyGroupConfig[]> {
  const { current, items = [] } = await getProfileConfig()
  const activeProfileLabel =
    items.find((item) => item.id === current)?.name?.trim() || current || 'Active profile'
  const profile = await getProfile(current)
  const appConfig = await getAppConfig()
  const rawProxyGroups = Array.isArray(profile['proxy-groups'])
    ? (profile['proxy-groups'] as unknown[])
    : []
  const mergedProfileProxies = await getMergedProfileProxies(current)
  const proxyNames = getUniqueStrings(mergedProfileProxies.map((proxy) => proxy.name!))
  const candidateProfiles = buildCandidateProfileLabels(mergedProfileProxies, activeProfileLabel)

  const proxyGroups = rawProxyGroups.filter(isProxyGroupRecord)
  const groupNames = getUniqueStrings(proxyGroups.map((group) => group.name!))

  const editableGroups: EditableProxyGroupConfig[] = proxyGroups
    .filter((group) => isEditableGroupType(group.type))
    .map((group) => {
      const config = buildEditableGroupConfig(group, proxyNames, groupNames)
      return {
        ...config,
        candidateProfiles,
        proxies: sanitizeProxySelections(config.proxies, config.candidates)
      }
    })

  const vpnRoutingGroup = appConfig.vpnRoutingGroup
  const vpnCandidates = getUniqueStrings(proxyNames.concat(groupNames, BUILTIN_PROXY_CANDIDATES))
  const generatedVpnGroup: MihomoProxyGroupRecord = {
    name: VPN_RULE_TARGET,
    type: EDITABLE_TO_RAW_GROUP_TYPE[vpnRoutingGroup?.type ?? 'Fallback'],
    proxies: getVpnRoutingGroupProxies(vpnRoutingGroup, proxyNames, vpnCandidates),
    url: vpnRoutingGroup?.url,
    interval: vpnRoutingGroup?.interval,
    timeout: vpnRoutingGroup?.timeout,
    lazy: vpnRoutingGroup?.lazy,
    'max-failed-times': vpnRoutingGroup?.maxFailedTimes,
    tolerance: vpnRoutingGroup?.tolerance,
    'expected-status': vpnRoutingGroup?.expectedStatus
  }

  return editableGroups
    .filter((group) => group.name !== VPN_RULE_TARGET)
    .concat(
      buildEditableGroupConfig(generatedVpnGroup, proxyNames, groupNames, {
        generated: true,
        candidateProfiles
      })
    )
}

export async function getEditableVpnRoutingGroup(): Promise<EditableProxyGroupConfig> {
  const groups = await getEditableRuntimeProxyGroups()
  const vpnGroup = groups.find((group) => group.name === VPN_RULE_TARGET)
  if (!vpnGroup) {
    throw new Error('Global VPN routing group configuration not found')
  }
  return vpnGroup
}

export async function updateVpnRoutingGroup(patch: EditableProxyGroupPatch): Promise<void> {
  if (patch.name !== VPN_RULE_TARGET) {
    throw new Error('Only the global VPN group supports routing mode changes')
  }

  await patchAppConfig({
    vpnRoutingGroup: {
      type: patch.type,
      proxies: patch.type === 'Selector' ? [] : getUniqueStrings(patch.proxies),
      url: patch.url?.trim() || undefined,
      interval: toOptionalPositiveNumber(patch.interval),
      timeout: toOptionalPositiveNumber(patch.timeout),
      lazy: typeof patch.lazy === 'boolean' ? patch.lazy : undefined,
      maxFailedTimes: toOptionalPositiveNumber(patch.maxFailedTimes),
      tolerance: patch.type === 'URLTest' ? toOptionalPositiveNumber(patch.tolerance) : undefined,
      expectedStatus: patch.expectedStatus?.trim() || undefined
    }
  })
}
