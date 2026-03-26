import { getProfile, getProfileConfig } from './profile'

interface MihomoNamedProxyRecord extends Record<string, unknown> {
  name?: string
  serverDescription?: string
}

function isNamedProxyRecord(proxy: unknown): proxy is MihomoNamedProxyRecord {
  return !!proxy && typeof proxy === 'object' && 'name' in proxy && typeof proxy.name === 'string'
}

function cloneProxy(proxy: MihomoNamedProxyRecord): MihomoNamedProxyRecord {
  return JSON.parse(JSON.stringify(proxy)) as MihomoNamedProxyRecord
}

function getNormalizedProxyName(proxy: MihomoNamedProxyRecord): string {
  return proxy.name?.trim() || ''
}

function makeUniqueProxyName(
  baseName: string,
  profileLabel: string,
  usedNames: Set<string>
): string {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName)
    return baseName
  }

  const suffixBase = `${baseName} [${profileLabel}]`
  let candidate = suffixBase
  let counter = 2
  while (usedNames.has(candidate)) {
    candidate = `${suffixBase} ${counter}`
    counter += 1
  }
  usedNames.add(candidate)
  return candidate
}

export async function getMergedProfileProxies(currentId?: string): Promise<MihomoNamedProxyRecord[]> {
  const { current, items = [] } = await getProfileConfig()
  const activeProfileId = currentId || current
  const currentProfile = await getProfile(activeProfileId)
  const currentProxies = Array.isArray(currentProfile.proxies)
    ? (currentProfile.proxies as unknown[])
    : []

  const mergedProxies = currentProxies
    .filter(isNamedProxyRecord)
    .map((proxy) => cloneProxy(proxy))
  const usedNames = new Set(mergedProxies.map(getNormalizedProxyName).filter(Boolean))

  for (const item of items) {
    if (item.id === activeProfileId) continue

    const profile = await getProfile(item.id)
    const profileProxies = Array.isArray(profile.proxies) ? (profile.proxies as unknown[]) : []
    const profileLabel = item.name?.trim() || item.id

    for (const proxy of profileProxies) {
      if (!isNamedProxyRecord(proxy)) continue

      const clonedProxy = cloneProxy(proxy)
      const baseName = getNormalizedProxyName(clonedProxy)
      if (!baseName) continue

      const uniqueName = makeUniqueProxyName(baseName, profileLabel, usedNames)
      if (uniqueName !== baseName) {
        clonedProxy.name = uniqueName
      }
      if (!clonedProxy.serverDescription) {
        clonedProxy.serverDescription = profileLabel
      }
      mergedProxies.push(clonedProxy)
    }
  }

  return mergedProxies
}
