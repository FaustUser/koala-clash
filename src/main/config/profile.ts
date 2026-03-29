import { getControledMihomoConfig } from './controledMihomo'
import {
  legacyRulePath,
  mihomoProfileWorkDir,
  mihomoWorkDir,
  profileConfigPath,
  profilePath,
  rulePath
} from '../utils/dirs'
import { addProfileUpdater, delProfileUpdater } from '../core/profileUpdater'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { restartCore } from '../core/manager'
import { getAppConfig } from './app'
import { existsSync } from 'fs'
import axios, { AxiosResponse } from 'axios'
import https from 'https'
import { parseYaml, stringifyYaml } from '../utils/yaml'
import { defaultProfile } from '../utils/template'
import { dirname, join } from 'path'
import { deepMerge } from '../utils/merge'
import { getUserAgent } from '../utils/userAgent'
import { getHWID, getDeviceOS, getOSVersion, getDeviceModel } from '../utils/deviceInfo'
import { t } from '../utils/i18n'

let profileConfig: ProfileConfig // profile.yaml

export async function getProfileConfig(force = false): Promise<ProfileConfig> {
  if (force || !profileConfig) {
    const data = await readFile(profileConfigPath(), 'utf-8')
    profileConfig = parseYaml(data) || { items: [] }
  }
  if (typeof profileConfig !== 'object') profileConfig = { items: [] }
  return profileConfig
}

export async function setProfileConfig(config: ProfileConfig): Promise<void> {
  profileConfig = config
  await writeFile(profileConfigPath(), stringifyYaml(config), 'utf-8')
}

export async function getProfileItem(id: string | undefined): Promise<ProfileItem | undefined> {
  const { items } = await getProfileConfig()
  if (!id || id === 'default')
    return { id: 'default', type: 'local', name: t('ui.blankSubscription') }
  return items?.find((item) => item.id === id)
}

export async function changeCurrentProfile(id: string): Promise<void> {
  const config = await getProfileConfig()
  const current = config.current
  config.current = id
  await setProfileConfig(config)
  try {
    await restartCore()
  } catch (e) {
    config.current = current
    throw e
  } finally {
    await setProfileConfig(config)
  }
}

export async function updateProfileItem(item: ProfileItem): Promise<void> {
  const config = await getProfileConfig()
  const index = (config.items ?? []).findIndex((i) => i.id === item.id)
  if (index === -1) {
    throw new Error('Profile not found')
  }
  config.items[index] = item
  if (!item.autoUpdate) await delProfileUpdater(item.id)
  await setProfileConfig(config)
}

export async function addProfileItem(item: Partial<ProfileItem>): Promise<void> {
  if (item.url && item.type === 'remote') {
    const config = await getProfileConfig()
    const duplicate = config.items?.find(
      (existing) => existing.url === item.url && existing.id !== item.id
    )
    if (duplicate) {
      throw new Error(t('error.duplicateProfile'))
    }
  }
  const newItem = await createProfile(item)
  const config = await getProfileConfig()
  const isExisting = !!(await getProfileItem(newItem.id))
  if (isExisting) {
    await updateProfileItem(newItem)
  } else {
    if (!config.items) config.items = []
    config.items.push(newItem)
    await setProfileConfig(config)
  }

  if (!isExisting || !config.current) {
    await changeCurrentProfile(newItem.id)
  }
  await addProfileUpdater(newItem)
}

export async function removeProfileItem(id: string): Promise<void> {
  const config = await getProfileConfig()
  config.items = config.items?.filter((item) => item.id !== id)
  let shouldRestart = false
  if (config.current === id) {
    shouldRestart = true
    if (config.items && config.items.length > 0) {
      config.current = config.items[0].id
    } else {
      config.current = undefined
    }
  }
  await setProfileConfig(config)
  if (existsSync(profilePath(id))) {
    await rm(profilePath(id))
  }
  if (shouldRestart) {
    await restartCore()
  }
  if (existsSync(mihomoProfileWorkDir(id))) {
    await rm(mihomoProfileWorkDir(id), { recursive: true })
  }
  await delProfileUpdater(id)
}

export async function getCurrentProfileItem(): Promise<ProfileItem> {
  const { current } = await getProfileConfig()
  return (
    (await getProfileItem(current)) || {
      id: 'default',
      type: 'local',
      name: t('ui.blankSubscription')
    }
  )
}

async function downloadLogoAsBase64(
  logoUrl: string,
  proxy?: { protocol: string; host: string; port: number }
): Promise<string | null> {
  try {
    const httpsAgent = new https.Agent()
    const res = await axios.get(logoUrl, {
      httpsAgent,
      ...(proxy && { proxy }),
      responseType: 'arraybuffer',
      timeout: 10000
    })
    const contentType = res.headers['content-type'] || 'image/png'
    const base64 = Buffer.from(res.data).toString('base64')
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
}

export async function createProfile(item: Partial<ProfileItem>): Promise<ProfileItem> {
  const id = item.id || new Date().getTime().toString(16)
  const newItem = {
    id,
    name: item.name || (item.type === 'remote' ? 'Remote File' : 'Local File'),
    type: item.type,
    url: item.url,
    ua: item.ua,
    verify: item.verify ?? true,
    autoUpdate: item.autoUpdate ?? true,
    interval: item.interval || 0,
    useProxy: item.useProxy || false,
    updated: new Date().getTime()
  } as ProfileItem
  switch (newItem.type) {
    case 'remote': {
      if (!item.url) throw new Error('Empty URL')
      const directUriContent = convertUriSubscriptionToMihomoConfig(item.url, newItem.name)
      if (directUriContent) {
        if (newItem.name === 'Remote File') {
          newItem.name = extractFirstVlessName(item.url) || 'VLESS Import'
        }
        await setProfileStr(id, directUriContent)
        break
      }

      const { 'mixed-port': mixedPort = 7897 } = await getControledMihomoConfig()
      let res: AxiosResponse
      try {
        const httpsAgent = new https.Agent()

        res = await axios.get(item.url, {
          httpsAgent,
          ...(newItem.useProxy &&
            mixedPort && {
              proxy: { protocol: 'http', host: '127.0.0.1', port: mixedPort }
            }),
          headers: {
            'User-Agent': newItem.ua || (await getUserAgent()),
            'x-hwid': getHWID(),
            'x-device-os': getDeviceOS(),
            'x-ver-os': getOSVersion(),
            'x-device-model': getDeviceModel()
          },
          responseType: 'text'
        })
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED') {
            throw new Error(`${t('error.networkResetOrTimeout')}：${item.url}`)
          } else if (error.code === 'CERT_HAS_EXPIRED') {
            throw new Error(`${t('error.serverCertExpired')}：${item.url}`)
          } else if (error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
            throw new Error(`${t('error.unableToVerifyCert')}：${item.url}`)
          } else if (error.message.includes('Certificate verification failed')) {
            throw new Error(`${t('error.certVerificationFailed')}：${item.url}`)
          } else {
            throw new Error(`${t('error.requestFailed')}：${error.message}`)
          }
        }
        throw error
      }

      const data = normalizeImportedProfile(res.data, newItem.name)
      const headers = res.headers
      const contentType = (headers['content-type'] || '').toLowerCase()
      if (contentType.includes('text/html') || contentType.includes('text/xml')) {
        throw new Error(t('error.subscriptionFormatError'))
      }
      const hwidLimitKey = Object.keys(headers).find((k) =>
        k.toLowerCase().endsWith('x-hwid-limit')
      )
      if (hwidLimitKey && headers[hwidLimitKey] === 'true') {
        const hwidSupportKey = Object.keys(headers).find((k) =>
          k.toLowerCase().endsWith('support-url')
        )
        const hwidSupportUrl = hwidSupportKey ? headers[hwidSupportKey] : ''
        throw new Error(`HWID_LIMIT:${hwidSupportUrl}`)
      }
      const profileTitleKey = Object.keys(headers).find((k) =>
        k.toLowerCase().endsWith('profile-title')
      )
      if (profileTitleKey) {
        const titleValue = headers[profileTitleKey]
        if (titleValue.startsWith('base64:')) {
          newItem.name = Buffer.from(titleValue.slice(7), 'base64').toString('utf-8')
        } else {
          newItem.name = titleValue
        }
      } else {
        const contentDispositionKey = Object.keys(headers).find((k) =>
          k.toLowerCase().endsWith('content-disposition')
        )
        if (contentDispositionKey && newItem.name === 'Remote File') {
          newItem.name = parseFilename(headers[contentDispositionKey])
        }
      }
      const homeKey = Object.keys(headers).find((k) =>
        k.toLowerCase().endsWith('profile-web-page-url')
      )
      if (homeKey) {
        newItem.home = headers[homeKey]
      }
      const intervalKey = Object.keys(headers).find((k) =>
        k.toLowerCase().endsWith('profile-update-interval')
      )
      if (intervalKey) {
        newItem.interval = parseInt(headers[intervalKey]) * 60
        if (newItem.interval) {
          newItem.locked = true
        }
      }
      const userinfoKey = Object.keys(headers).find((k) =>
        k.toLowerCase().endsWith('subscription-userinfo')
      )
      if (userinfoKey) {
        newItem.extra = parseSubinfo(headers[userinfoKey])
      }
      const logoKey = Object.keys(headers).find((k) => k.toLowerCase().endsWith('profile-logo'))
      if (logoKey) {
        const logoUrl = headers[logoKey]
        const proxyConfig =
          newItem.useProxy && mixedPort
            ? { protocol: 'http', host: '127.0.0.1', port: mixedPort }
            : undefined
        const base64Logo = await downloadLogoAsBase64(logoUrl, proxyConfig)
        newItem.logo = base64Logo || logoUrl
      }
      const supportUrlKey = Object.keys(headers).find((k) =>
        k.toLowerCase().endsWith('support-url')
      )
      if (supportUrlKey) {
        newItem.supportUrl = headers[supportUrlKey]
      }
      const announceKey = Object.keys(headers).find((k) => k.toLowerCase().endsWith('announce'))
      if (announceKey) {
        const announceValue = headers[announceKey]
        if (announceValue.startsWith('base64:')) {
          newItem.announce = Buffer.from(announceValue.slice(7), 'base64').toString('utf-8')
        } else {
          newItem.announce = announceValue
        }
      }
      if (newItem.verify) {
        let parsed: MihomoConfig
        try {
          parsed = parseYaml<MihomoConfig>(data)
        } catch (error) {
          throw new Error(t('error.subscriptionFormatError') + '\n' + (error as Error).message)
        }
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          Array.isArray(parsed) ||
          !(
            'proxies' in parsed ||
            'proxy-providers' in parsed ||
            'proxy-groups' in parsed ||
            'rules' in parsed ||
            'rule-providers' in parsed ||
            'dns' in parsed ||
            'tun' in parsed ||
            'mixed-port' in parsed
          )
        ) {
          throw new Error(t('error.subscriptionFormatError'))
        }
      }
      await setProfileStr(id, data)
      break
    }
    case 'local': {
      const data = normalizeImportedProfile(item.file || '', newItem.name)
      if (newItem.name === 'Local File') {
        newItem.name = extractFirstVlessName(item.file || '') || newItem.name
      }
      await setProfileStr(id, data)
      break
    }
  }
  return newItem
}

export async function getProfileStr(id: string | undefined): Promise<string> {
  if (existsSync(profilePath(id || 'default'))) {
    return await readFile(profilePath(id || 'default'), 'utf-8')
  } else {
    return stringifyYaml(defaultProfile)
  }
}

export async function getProfileParseStr(id: string | undefined): Promise<string> {
  let data: string
  if (existsSync(profilePath(id || 'default'))) {
    data = await readFile(profilePath(id || 'default'), 'utf-8')
  } else {
    data = stringifyYaml(defaultProfile)
  }
  const profile = deepMerge(parseYaml<object>(data), {})
  return stringifyYaml(profile)
}

export async function setProfileStr(id: string, content: string): Promise<void> {
  const { current } = await getProfileConfig()
  await writeFile(profilePath(id), content, 'utf-8')
  if (current === id) await restartCore()
}

export async function getProfile(id: string | undefined): Promise<MihomoConfig> {
  const profile = await getProfileStr(id)
  let result = parseYaml<MihomoConfig>(profile)
  if (typeof result !== 'object') result = {} as MihomoConfig
  return result
}

// attachment;filename=xxx.yaml; filename*=UTF-8''%xx%xx%xx
function parseFilename(str: string): string {
  if (str.match(/filename\*=.*''/)) {
    return decodeURIComponent(str.split(/filename\*=.*''/)[1])
  } else {
    return str.split('filename=')[1]
  }
}

// subscription-userinfo: upload=1234; download=2234; total=1024000; expire=2218532293
function parseSubinfo(str: string): SubscriptionUserInfo {
  const parts = str.split(';')
  const obj = {} as SubscriptionUserInfo
  parts.forEach((part) => {
    const [key, value] = part.trim().split('=')
    obj[key] = parseInt(value)
  })
  return obj
}

function normalizeImportedProfile(content: string, fallbackName: string): string {
  return convertUriSubscriptionToMihomoConfig(content, fallbackName) || content
}

function convertUriSubscriptionToMihomoConfig(
  content: string,
  fallbackName: string
): string | undefined {
  const links = extractVlessLinks(content)
  if (links.length > 0) {
    return stringifyYaml(buildVlessProfile(links, fallbackName))
  }

  const decodedContent = decodeBase64Subscription(content)
  if (!decodedContent) {
    return undefined
  }

  const decodedLinks = extractVlessLinks(decodedContent)
  if (decodedLinks.length === 0) {
    return undefined
  }

  return stringifyYaml(buildVlessProfile(decodedLinks, fallbackName))
}

function extractVlessLinks(content: string): string[] {
  return Array.from(content.match(/vless:\/\/[^\s]+/gi) || [])
}

function decodeBase64Subscription(content: string): string | undefined {
  const normalized = content.replace(/\s+/g, '')
  if (!normalized || normalized.includes('://') || /[^A-Za-z0-9+/_=-]/.test(normalized)) {
    return undefined
  }

  const padded = normalized
    .padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    .replace(/-/g, '+')
    .replace(/_/g, '/')

  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf-8').trim()
    return decoded.includes('vless://') ? decoded : undefined
  } catch {
    return undefined
  }
}

function extractFirstVlessName(content: string): string | undefined {
  const firstLink = extractVlessLinks(content)[0]
  if (firstLink) {
    return decodeURIComponent(new URL(firstLink).hash.replace(/^#/, '')) || undefined
  }

  const decodedContent = decodeBase64Subscription(content)
  const firstDecodedLink = decodedContent ? extractVlessLinks(decodedContent)[0] : undefined
  if (!firstDecodedLink) {
    return undefined
  }

  return decodeURIComponent(new URL(firstDecodedLink).hash.replace(/^#/, '')) || undefined
}

function buildVlessProfile(links: string[], fallbackName: string): MihomoConfig {
  const usedNames = new Set<string>()
  const proxies = links.map((link, index) => parseVlessLink(link, fallbackName, index, usedNames))
  const proxyNames = proxies.map((proxy) => proxy.name)

  const config = {
    proxies,
    'proxy-groups': [
      {
        name: 'PROXY',
        type: 'select',
        proxies: [...proxyNames, 'DIRECT']
      }
    ],
    rules: ['MATCH,PROXY']
  }

  return config as unknown as MihomoConfig
}

function parseVlessLink(
  rawLink: string,
  fallbackName: string,
  index: number,
  usedNames: Set<string>
): Record<string, unknown> {
  const link = new URL(rawLink)
  const uuid = decodeURIComponent(link.username)
  const port = parseInt(link.port, 10)

  if (!uuid || !link.hostname || Number.isNaN(port)) {
    throw new Error(t('error.subscriptionFormatError'))
  }

  const network = normalizeVlessNetwork(getSearchParam(link, 'type'))
  const host = getFirstSearchParam(link, ['host'])
  const path = getFirstSearchParam(link, ['path'])
  const security = (getFirstSearchParam(link, ['security']) || '').toLowerCase()
  const sni = getFirstSearchParam(link, ['sni', 'servername'])
  const serviceName = getFirstSearchParam(link, ['serviceName', 'service-name'])
  const proxyName = makeUniqueProxyName(
    decodeURIComponent(link.hash.replace(/^#/, '')) || `${fallbackName || 'VLESS'} ${index + 1}`,
    usedNames
  )

  const proxy: Record<string, unknown> = {
    name: proxyName,
    type: 'vless',
    server: link.hostname,
    port,
    uuid,
    udp: true,
    encryption: normalizeVlessEncryption(getFirstSearchParam(link, ['encryption']))
  }

  const flow = getFirstSearchParam(link, ['flow'])
  if (flow) proxy.flow = flow

  const packetEncoding = getFirstSearchParam(link, ['packetEncoding', 'packet-encoding'])
  if (packetEncoding) proxy['packet-encoding'] = packetEncoding

  if (security === 'tls' || security === 'reality') {
    proxy.tls = true
  }
  if (sni) {
    proxy.servername = sni
  }

  const allowInsecure = parseBooleanParam(getFirstSearchParam(link, ['allowInsecure']))
  if (allowInsecure !== undefined) {
    proxy['skip-cert-verify'] = allowInsecure
  }

  const clientFingerprint = getFirstSearchParam(link, ['fp'])
  if (clientFingerprint) {
    proxy['client-fingerprint'] = clientFingerprint
  }

  const alpn = getFirstSearchParam(link, ['alpn'])
  if (alpn) {
    proxy.alpn = alpn
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  const publicKey = getFirstSearchParam(link, ['pbk'])
  const shortId = getFirstSearchParam(link, ['sid'])
  if (security === 'reality' && publicKey) {
    proxy['reality-opts'] = {
      'public-key': publicKey,
      ...(shortId ? { 'short-id': shortId } : {})
    }
  }

  if (network) {
    proxy.network = network
    applyVlessTransportOptions(proxy, network, {
      host,
      path,
      serviceName,
      mode: getFirstSearchParam(link, ['mode']),
      earlyData: getFirstSearchParam(link, ['ed']),
      earlyDataHeaderName: getFirstSearchParam(link, ['eh'])
    })
  }

  return proxy
}

function applyVlessTransportOptions(
  proxy: Record<string, unknown>,
  network: string,
  options: {
    host?: string
    path?: string
    serviceName?: string
    mode?: string
    earlyData?: string
    earlyDataHeaderName?: string
  }
): void {
  const normalizedPath = options.path || '/'

  if (network === 'ws') {
    proxy['ws-opts'] = {
      path: normalizedPath,
      ...(options.host ? { headers: { Host: options.host } } : {}),
      ...(parseNumberParam(options.earlyData) !== undefined
        ? { 'max-early-data': parseNumberParam(options.earlyData) }
        : {}),
      ...(options.earlyDataHeaderName
        ? { 'early-data-header-name': options.earlyDataHeaderName }
        : {})
    }
    return
  }

  if (network === 'http-upgrade') {
    proxy.network = 'ws'
    proxy['ws-opts'] = {
      path: normalizedPath,
      ...(options.host ? { headers: { Host: options.host } } : {}),
      'v2ray-http-upgrade': true,
      ...(options.mode === 'fast-open' ? { 'v2ray-http-upgrade-fast-open': true } : {})
    }
    return
  }

  if (network === 'http') {
    proxy['http-opts'] = {
      method: 'GET',
      path: [normalizedPath],
      ...(options.host
        ? { headers: { Host: options.host.split(',').map((item) => item.trim()) } }
        : {})
    }
    return
  }

  if (network === 'h2') {
    proxy['h2-opts'] = {
      ...(options.host ? { host: options.host.split(',').map((item) => item.trim()) } : {}),
      path: normalizedPath
    }
    return
  }

  if (network === 'grpc') {
    const serviceName = options.serviceName || normalizedPath.replace(/^\//, '')
    proxy['grpc-opts'] = {
      ...(serviceName ? { 'grpc-service-name': serviceName } : {})
    }
  }
}

function getSearchParam(link: URL, key: string): string | undefined {
  const value = link.searchParams.get(key)
  return value ? value.trim() : undefined
}

function getFirstSearchParam(link: URL, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = getSearchParam(link, key)
    if (value) {
      return value
    }
  }
  return undefined
}

function normalizeVlessNetwork(type: string | undefined): string | undefined {
  if (!type) return 'tcp'
  switch (type.toLowerCase()) {
    case 'tcp':
    case 'ws':
    case 'http':
    case 'h2':
    case 'grpc':
      return type.toLowerCase()
    case 'httpupgrade':
      return 'http-upgrade'
    default:
      return undefined
  }
}

function normalizeVlessEncryption(value: string | undefined): string {
  if (!value || value.toLowerCase() === 'none') {
    return ''
  }
  return value
}

function parseBooleanParam(value: string | undefined): boolean | undefined {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (normalized === '1' || normalized === 'true') return true
  if (normalized === '0' || normalized === 'false') return false
  return undefined
}

function parseNumberParam(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? undefined : parsed
}

function makeUniqueProxyName(name: string, usedNames: Set<string>): string {
  const baseName = name.trim() || 'VLESS'
  let candidate = baseName
  let counter = 2
  while (usedNames.has(candidate)) {
    candidate = `${baseName} ${counter}`
    counter += 1
  }
  usedNames.add(candidate)
  return candidate
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:\\/.test(path)
}

export async function getFileStr(path: string): Promise<string> {
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  if (isAbsolutePath(path)) {
    return await readFile(path, 'utf-8')
  } else {
    return await readFile(
      join(diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), path),
      'utf-8'
    )
  }
}

export async function setFileStr(path: string, content: string): Promise<void> {
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  if (isAbsolutePath(path)) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf-8')
  } else {
    const target = join(diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf-8')
  }
}

async function migrateLegacyRuleStr(preferredId?: string): Promise<string> {
  const sharedPath = rulePath()
  const sharedDir = dirname(sharedPath)
  const preferredLegacyPath = preferredId ? legacyRulePath(preferredId) : undefined
  const candidatePaths = new Set<string>()

  if (preferredLegacyPath && existsSync(preferredLegacyPath)) {
    candidatePaths.add(preferredLegacyPath)
  }

  if (existsSync(sharedDir)) {
    const legacyFiles = (await readdir(sharedDir))
      .filter((file) => file.endsWith('.yaml') && file !== 'shared.yaml')
      .map((file) => legacyRulePath(file.slice(0, -5)))

    legacyFiles.forEach((filePath) => candidatePaths.add(filePath))
  }

  const sortedCandidates = await Promise.all(
    [...candidatePaths].map(async (filePath) => ({
      filePath,
      mtimeMs: (await stat(filePath)).mtimeMs
    }))
  )

  sortedCandidates.sort((left, right) => right.mtimeMs - left.mtimeMs)

  for (const { filePath } of sortedCandidates) {
    const content = await readFile(filePath, 'utf-8')
    if (!content.trim()) continue

    await mkdir(dirname(sharedPath), { recursive: true })
    await writeFile(sharedPath, content, 'utf-8')
    return content
  }

  return ''
}

export async function getRuleStr(id: string): Promise<string> {
  const sharedPath = rulePath()

  if (existsSync(sharedPath)) {
    return await readFile(sharedPath, 'utf-8')
  }

  return await migrateLegacyRuleStr(id)
}

export async function setRuleStr(_id: string, str: string): Promise<void> {
  await mkdir(dirname(rulePath()), { recursive: true })
  await writeFile(rulePath(), str, 'utf-8')
}

export async function convertMrsRuleset(filePath: string, behavior: string): Promise<string> {
  const { exec } = await import('child_process')
  const { promisify } = await import('util')
  const execAsync = promisify(exec)
  const { mihomoCorePath } = await import('../utils/dirs')
  const { getAppConfig } = await import('./app')
  const { tmpdir } = await import('os')
  const { randomBytes } = await import('crypto')
  const { unlink } = await import('fs/promises')

  const { core = 'mihomo' } = await getAppConfig()
  const corePath = mihomoCorePath(core)
  const { diffWorkDir = false } = await getAppConfig()
  const { current } = await getProfileConfig()
  let fullPath: string
  if (isAbsolutePath(filePath)) {
    fullPath = filePath
  } else {
    fullPath = join(diffWorkDir ? mihomoProfileWorkDir(current) : mihomoWorkDir(), filePath)
  }

  const tempFileName = `mrs-convert-${randomBytes(8).toString('hex')}.txt`
  const tempFilePath = join(tmpdir(), tempFileName)

  try {
    // 使用 mihomo convert-ruleset 命令转换 MRS 文件为 text 格式
    // 命令格式: mihomo convert-ruleset <behavior> <format> <source>
    await execAsync(`"${corePath}" convert-ruleset ${behavior} mrs "${fullPath}" "${tempFilePath}"`)
    const content = await readFile(tempFilePath, 'utf-8')
    await unlink(tempFilePath)

    return content
  } catch (error) {
    try {
      await unlink(tempFilePath)
    } catch {
      // ignore
    }
    throw error
  }
}
