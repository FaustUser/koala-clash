import {
  getControledMihomoConfig,
  getProfileConfig,
  getProfile,
  getProfileStr,
  getAppConfig,
  getRuleStr
} from '../config'
import { getMergedProfileProxies } from '../config/profileMerge'
import { mihomoProfileWorkDir, mihomoWorkConfigPath, mihomoWorkDir } from '../utils/dirs'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { copyFile, mkdir, writeFile } from 'fs/promises'
import { deepMerge } from '../utils/merge'
import { existsSync } from 'fs'
import path from 'path'

let runtimeConfigStr: string,
  rawProfileStr: string,
  currentProfileStr: string,
  runtimeConfig: MihomoConfig

// 辅助函数：处理带偏移量的规则
function processRulesWithOffset(ruleStrings: string[], currentRules: string[], isAppend = false) {
  const normalRules: string[] = []
  const rules = [...currentRules]

  ruleStrings.forEach((ruleStr) => {
    const parts = ruleStr.split(',')
    const firstPartIsNumber =
      !isNaN(Number(parts[0])) && parts[0].trim() !== '' && parts.length >= 3

    if (firstPartIsNumber) {
      const offset = parseInt(parts[0])
      const rule = parts.slice(1).join(',')

      if (isAppend) {
        // 后置规则的插入位置计算
        const insertPosition = Math.max(0, rules.length - Math.min(offset, rules.length))
        rules.splice(insertPosition, 0, rule)
      } else {
        // 前置规则的插入位置计算
        const insertPosition = Math.min(offset, rules.length)
        rules.splice(insertPosition, 0, rule)
      }
    } else {
      normalRules.push(ruleStr)
    }
  })

  return { normalRules, insertRules: rules }
}

function getDefaultAppendInsertPosition(rules: string[]): number {
  const matchIndex = rules.findLastIndex((rule) => rule.split(',')[0]?.trim() === 'MATCH')
  return matchIndex === -1 ? rules.length : matchIndex
}

const VPN_RULE_TARGET = 'VPN'
const LEGACY_VPN_RULE_TARGETS = new Set(['__VPN_ROUTE__', '__ACTIVE_VPN__'])

function getRuleTarget(ruleStr: string): string | undefined {
  const parts = ruleStr.split(',').map((part) => part.trim())
  const firstPartIsNumber = !isNaN(Number(parts[0])) && parts[0] !== '' && parts.length >= 3
  const ruleParts = firstPartIsNumber ? parts.slice(1) : parts
  const [type = '', payloadOrTarget = '', proxy = ''] = ruleParts

  if (!type) return undefined
  return type === 'MATCH' ? payloadOrTarget : proxy
}

function getProfileDefaultRuleTarget(profile: MihomoConfig): string {
  const rawRules = Array.isArray(profile.rules) ? (profile.rules as unknown as string[]) : []
  const matchRule = [...rawRules].reverse().find((rule) => rule.split(',')[0]?.trim() === 'MATCH')

  return getRuleTarget(matchRule || '') || 'DIRECT'
}

function normalizeRuleTarget(ruleStr: string, defaultTarget: string): string {
  const target = getRuleTarget(ruleStr)
  if (!target) {
    return ruleStr
  }

  if (LEGACY_VPN_RULE_TARGETS.has(target) || target === defaultTarget) {
    return ruleStr.replace(target, VPN_RULE_TARGET)
  }

  return ruleStr
}

interface MihomoProxyGroupRecord extends Record<string, unknown> {
  name?: string
  type?: string
  proxies?: string[]
  url?: string
  interval?: number
  timeout?: number
  lazy?: boolean
  'max-failed-times'?: number
  tolerance?: number
  'expected-status'?: string
}

function isProxyGroupRecord(group: unknown): group is MihomoProxyGroupRecord {
  return !!group && typeof group === 'object'
}

function buildVpnRouteGroup(
  profile: MihomoConfig,
  mergedProxies: Array<{ name?: unknown }>,
  defaultTarget: string
): MihomoProxyGroupRecord | null {
  const proxyNames = [
    ...new Set(
      mergedProxies
        .map((proxy) => (typeof proxy?.name === 'string' ? proxy.name.trim() : ''))
        .filter(Boolean)
    )
  ]

  if (proxyNames.length === 0) {
    return null
  }

  const sourceGroups = Array.isArray(profile['proxy-groups'])
    ? (profile['proxy-groups'] as unknown[])
    : []
  const sourceGroup = sourceGroups.find((group) => {
    return (
      isProxyGroupRecord(group) && typeof group.name === 'string' && group.name === defaultTarget
    )
  }) as MihomoProxyGroupRecord | undefined

  const vpnGroup: MihomoProxyGroupRecord = {
    name: VPN_RULE_TARGET,
    type:
      sourceGroup?.type === 'fallback' || sourceGroup?.type === 'url-test'
        ? sourceGroup.type
        : 'fallback',
    proxies: proxyNames
  }

  if (typeof sourceGroup?.url === 'string') {
    vpnGroup.url = sourceGroup.url
  }
  if (typeof sourceGroup?.interval === 'number') {
    vpnGroup.interval = sourceGroup.interval
  }
  if (typeof sourceGroup?.timeout === 'number') {
    vpnGroup.timeout = sourceGroup.timeout
  }
  if (typeof sourceGroup?.lazy === 'boolean') {
    vpnGroup.lazy = sourceGroup.lazy
  }
  if (typeof sourceGroup?.['max-failed-times'] === 'number') {
    vpnGroup['max-failed-times'] = sourceGroup['max-failed-times']
  }
  if (typeof sourceGroup?.tolerance === 'number') {
    vpnGroup.tolerance = sourceGroup.tolerance
  }
  if (typeof sourceGroup?.['expected-status'] === 'string') {
    vpnGroup['expected-status'] = sourceGroup['expected-status']
  }

  if (!vpnGroup.url && ['fallback', 'url-test'].includes(String(vpnGroup.type))) {
    vpnGroup.url = 'https://www.gstatic.com/generate_204'
  }
  if (vpnGroup.interval === undefined && ['fallback', 'url-test'].includes(String(vpnGroup.type))) {
    vpnGroup.interval = 300
  }

  return vpnGroup
}

function getAvailableRuleTargets(profile: MihomoConfig, mergedProxies: unknown[]): Set<string> {
  const targets = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'])

  if (Array.isArray(profile['proxy-groups'])) {
    profile['proxy-groups'].forEach((group) => {
      const groupName =
        group && typeof group === 'object' && 'name' in group
          ? (group as { name?: unknown }).name
          : undefined
      if (typeof groupName === 'string') {
        targets.add(groupName)
      }
    })
  }

  if (Array.isArray(mergedProxies)) {
    mergedProxies.forEach((proxy) => {
      const proxyName =
        proxy && typeof proxy === 'object' && 'name' in proxy
          ? (proxy as { name?: unknown }).name
          : undefined
      if (typeof proxyName === 'string') {
        targets.add(proxyName)
      }
    })
  }

  return targets
}

function prepareSharedRulesForProfile(
  ruleStrings: string[],
  availableTargets: Set<string>,
  defaultTarget: string
): string[] {
  return ruleStrings
    .map((ruleStr) => normalizeRuleTarget(ruleStr, defaultTarget))
    .filter((ruleStr) => {
      const target = getRuleTarget(ruleStr)
      return !target || availableTargets.has(target)
    })
}

export async function generateProfile(): Promise<void> {
  const { current } = await getProfileConfig()
  const {
    diffWorkDir = false,
    controlDns = true,
    controlSniff = true,
    controlTun = false
  } = await getAppConfig()
  const currentProfile = await getProfile(current)
  rawProfileStr = await getProfileStr(current)
  currentProfileStr = stringifyYaml(currentProfile)
  const controledMihomoConfig = await getControledMihomoConfig()

  const configToMerge = JSON.parse(JSON.stringify(controledMihomoConfig))
  if (!controlDns && currentProfile.dns) {
    delete configToMerge.dns
    delete configToMerge.hosts
  }
  if (!controlSniff && currentProfile.sniffer) {
    delete configToMerge.sniffer
  }
  if (!controlTun && currentProfile.tun) {
    currentProfile.tun.enable = controledMihomoConfig.tun?.enable ?? false
    delete configToMerge.tun
  }

  const mergedProfileProxies = await getMergedProfileProxies(current)
  const defaultRuleTarget = getProfileDefaultRuleTarget(currentProfile)
  const normalizedBaseRules = Array.isArray(currentProfile.rules)
    ? (currentProfile.rules as unknown as string[]).map((rule) =>
        normalizeRuleTarget(rule, defaultRuleTarget)
      )
    : []
  currentProfile.rules = normalizedBaseRules as unknown as []
  const existingProxyGroups = Array.isArray(currentProfile['proxy-groups'])
    ? (currentProfile['proxy-groups'] as unknown[]).filter(
        (group) =>
          !(
            isProxyGroupRecord(group) &&
            typeof group.name === 'string' &&
            group.name === VPN_RULE_TARGET
          )
      )
    : []
  const vpnRouteGroup = buildVpnRouteGroup(
    currentProfile,
    mergedProfileProxies as Array<{ name?: unknown }>,
    defaultRuleTarget
  )
  if (vpnRouteGroup) {
    currentProfile['proxy-groups'] = [...existingProxyGroups, vpnRouteGroup] as unknown as []
  } else if (existingProxyGroups.length > 0) {
    currentProfile['proxy-groups'] = existingProxyGroups as unknown as []
  }
  const availableRuleTargets = getAvailableRuleTargets(currentProfile, mergedProfileProxies)
  const ruleFileContent = await getRuleStr(current || 'default')
  if (ruleFileContent.trim()) {
    const ruleData = parseYaml(ruleFileContent) as {
      prepend?: string[]
      append?: string[]
      delete?: string[]
    } | null

    if (ruleData && typeof ruleData === 'object') {
      // 确保 rules 数组存在
      if (!currentProfile.rules) {
        currentProfile.rules = [] as unknown as []
      }

      let rules = [...currentProfile.rules] as unknown as string[]

      // 处理前置规则
      if (ruleData.prepend?.length) {
        const prependRuleStrings = prepareSharedRulesForProfile(
          ruleData.prepend,
          availableRuleTargets,
          defaultRuleTarget
        )
        const { normalRules: prependRules, insertRules } = processRulesWithOffset(
          prependRuleStrings,
          rules
        )
        rules = [...prependRules, ...insertRules]
      }

      // 处理后置规则
      if (ruleData.append?.length) {
        const appendRuleStrings = prepareSharedRulesForProfile(
          ruleData.append,
          availableRuleTargets,
          defaultRuleTarget
        )
        const { normalRules: appendRules, insertRules } = processRulesWithOffset(
          appendRuleStrings,
          rules,
          true
        )
        rules = [...insertRules]
        appendRules.forEach((rule) => {
          const insertPosition = getDefaultAppendInsertPosition(rules)
          rules.splice(insertPosition, 0, rule)
        })
      }

      // 处理删除规则
      if (ruleData.delete?.length) {
        const deleteSet = new Set(ruleData.delete)
        rules = rules.filter((rule) => {
          const ruleStr = Array.isArray(rule) ? rule.join(',') : rule
          return !deleteSet.has(ruleStr)
        })
      }

      currentProfile.rules = rules as unknown as []
    }
  }

  currentProfile.proxies = mergedProfileProxies as unknown as []

  const profile = deepMerge(JSON.parse(JSON.stringify(currentProfile)), configToMerge)

  await cleanProfile(profile, controlDns, controlSniff, controlTun)

  runtimeConfig = profile
  runtimeConfigStr = stringifyYaml(profile)
  if (diffWorkDir) {
    await prepareProfileWorkDir(current)
  }
  await writeFile(
    diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
    runtimeConfigStr
  )
}

async function cleanProfile(
  profile: MihomoConfig,
  controlDns: boolean,
  controlSniff: boolean,
  controlTun: boolean
): Promise<void> {
  if (!['info', 'debug'].includes(profile['log-level'])) {
    profile['log-level'] = 'info'
  }

  configureLanSettings(profile)
  cleanBooleanConfigs(profile)
  cleanNumberConfigs(profile)
  cleanStringConfigs(profile)
  cleanAuthenticationConfig(profile)
  cleanTunConfig(profile, controlTun)
  cleanDnsConfig(profile, controlDns)
  cleanSnifferConfig(profile, controlSniff)
  cleanProxyConfigs(profile)
}

function cleanBooleanConfigs(profile: MihomoConfig): void {
  if (profile.ipv6) {
    delete (profile as Partial<MihomoConfig>).ipv6
  }

  const booleanConfigs = [
    'unified-delay',
    'tcp-concurrent',
    'geodata-mode',
    'geo-auto-update',
    'disable-keep-alive'
  ]

  booleanConfigs.forEach((key) => {
    if (!profile[key]) delete (profile as Partial<MihomoConfig>)[key]
  })

  if (!profile.profile) return

  const { 'store-selected': hasStoreSelected, 'store-fake-ip': hasStoreFakeIp } = profile.profile

  if (!hasStoreSelected && !hasStoreFakeIp) {
    delete (profile as Partial<MihomoConfig>).profile
  } else {
    const profileConfig = profile.profile as MihomoProfileConfig
    if (!hasStoreSelected) delete profileConfig['store-selected']
    if (!hasStoreFakeIp) delete profileConfig['store-fake-ip']
  }
}

function cleanNumberConfigs(profile: MihomoConfig): void {
  ;[
    'port',
    'socks-port',
    'redir-port',
    'tproxy-port',
    'mixed-port',
    'keep-alive-idle',
    'keep-alive-interval'
  ].forEach((key) => {
    if (profile[key] === 0) delete (profile as Partial<MihomoConfig>)[key]
  })
}

function cleanStringConfigs(profile: MihomoConfig): void {
  const partialProfile = profile as Partial<MihomoConfig>

  if (profile.mode === 'rule') delete partialProfile.mode

  const emptyStringConfigs = ['interface-name', 'secret', 'global-client-fingerprint']
  emptyStringConfigs.forEach((key) => {
    if (profile[key] === '') delete partialProfile[key]
  })

  if (profile['external-controller'] === '') {
    delete partialProfile['external-controller']
    delete partialProfile['external-ui']
    delete partialProfile['external-ui-url']
    delete partialProfile['external-controller-cors']
  } else if (profile['external-ui'] === '') {
    delete partialProfile['external-ui']
    delete partialProfile['external-ui-url']
  }
}

function configureLanSettings(profile: MihomoConfig): void {
  const partialProfile = profile as Partial<MihomoConfig>

  if (!profile['allow-lan']) {
    delete partialProfile['lan-allowed-ips']
    delete partialProfile['lan-disallowed-ips']
    return
  }

  if (!profile['allow-lan']) {
    delete partialProfile['allow-lan']
    delete partialProfile['lan-allowed-ips']
    delete partialProfile['lan-disallowed-ips']
    return
  }

  const allowedIps = profile['lan-allowed-ips']
  if (allowedIps?.length === 0) {
    delete partialProfile['lan-allowed-ips']
  } else if (allowedIps && !allowedIps.some((ip: string) => ip.startsWith('127.0.0.1/'))) {
    allowedIps.push('127.0.0.1/8')
  }

  if (profile['lan-disallowed-ips']?.length === 0) {
    delete partialProfile['lan-disallowed-ips']
  }
}

function cleanAuthenticationConfig(profile: MihomoConfig): void {
  if (profile.authentication?.length === 0) {
    const partialProfile = profile as Partial<MihomoConfig>
    delete partialProfile.authentication
    delete partialProfile['skip-auth-prefixes']
  }
}

function cleanTunConfig(profile: MihomoConfig, controlTun: boolean): void {
  if (!controlTun) return
  if (!profile.tun?.enable) {
    delete (profile as Partial<MihomoConfig>).tun
    return
  }

  const tunConfig = profile.tun as MihomoTunConfig

  if (tunConfig['auto-route'] !== false) {
    delete tunConfig['auto-route']
  }
  if (tunConfig['auto-detect-interface'] !== false) {
    delete tunConfig['auto-detect-interface']
  }

  const tunBooleanConfigs = ['auto-redirect', 'strict-route', 'disable-icmp-forwarding']
  tunBooleanConfigs.forEach((key) => {
    if (!tunConfig[key]) delete tunConfig[key]
  })

  if (tunConfig.device === '') {
    delete tunConfig.device
  } else if (
    process.platform === 'darwin' &&
    tunConfig.device &&
    !tunConfig.device.startsWith('utun')
  ) {
    delete tunConfig.device
  }

  if (tunConfig['dns-hijack']?.length === 0) delete tunConfig['dns-hijack']
  if (tunConfig['route-exclude-address']?.length === 0) delete tunConfig['route-exclude-address']
}

function cleanDnsConfig(profile: MihomoConfig, controlDns: boolean): void {
  if (!controlDns) return
  if (!profile.dns?.enable) {
    delete (profile as Partial<MihomoConfig>).dns
    return
  }

  const dnsConfig = profile.dns as MihomoDNSConfig
  const dnsArrayConfigs = [
    'fake-ip-range',
    'fake-ip-range6',
    'fake-ip-filter',
    'proxy-server-nameserver',
    'direct-nameserver',
    'nameserver'
  ]

  dnsArrayConfigs.forEach((key) => {
    if (dnsConfig[key]?.length === 0) delete dnsConfig[key]
  })

  if (dnsConfig['respect-rules'] === false || dnsConfig['proxy-server-nameserver']?.length === 0) {
    delete dnsConfig['respect-rules']
  }

  if (dnsConfig['nameserver-policy'] && Object.keys(dnsConfig['nameserver-policy']).length === 0) {
    delete dnsConfig['nameserver-policy']
  }

  delete dnsConfig.fallback
  delete dnsConfig['fallback-filter']
}

function cleanSnifferConfig(profile: MihomoConfig, controlSniff: boolean): void {
  if (!controlSniff) return
  if (!profile.sniffer?.enable) {
    delete (profile as Partial<MihomoConfig>).sniffer
  }
}

function cleanProxyConfigs(profile: MihomoConfig): void {
  const partialProfile = profile as Partial<MihomoConfig>
  const arrayConfigs = ['proxies', 'proxy-groups', 'rules']
  const objectConfigs = ['proxy-providers', 'rule-providers']

  arrayConfigs.forEach((key) => {
    if (Array.isArray(profile[key]) && profile[key]?.length === 0) {
      delete partialProfile[key]
    }
  })

  objectConfigs.forEach((key) => {
    const value = profile[key]
    if (
      value === null ||
      value === undefined ||
      (value && typeof value === 'object' && Object.keys(value).length === 0)
    ) {
      delete partialProfile[key]
    }
  })
}

async function prepareProfileWorkDir(current: string | undefined): Promise<void> {
  if (!existsSync(mihomoProfileWorkDir(current))) {
    await mkdir(mihomoProfileWorkDir(current), { recursive: true })
  }
  const copy = async (file: string): Promise<void> => {
    const targetPath = path.join(mihomoProfileWorkDir(current), file)
    const sourcePath = path.join(mihomoWorkDir(), file)
    if (!existsSync(targetPath) && existsSync(sourcePath)) {
      await copyFile(sourcePath, targetPath)
    }
  }
  await Promise.all([
    copy('country.mmdb'),
    copy('geoip.metadb'),
    copy('geoip.dat'),
    copy('geosite.dat'),
    copy('ASN.mmdb')
  ])
}

export async function getRuntimeConfigStr(): Promise<string> {
  return runtimeConfigStr
}

export async function getRawProfileStr(): Promise<string> {
  return rawProfileStr
}

export async function getCurrentProfileStr(): Promise<string> {
  return currentProfileStr
}

export async function getRuntimeConfig(): Promise<MihomoConfig> {
  return runtimeConfig
}
