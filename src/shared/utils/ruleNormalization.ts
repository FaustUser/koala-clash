export const VPN_RULE_TARGET = 'VPN'
export const DIRECT_RULE_TARGET = 'DIRECT'

const LEGACY_VPN_RULE_TARGETS = new Set(['__VPN_ROUTE__', '__ACTIVE_VPN__'])

function splitByTopLevelCommas(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0

  for (const char of value) {
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }

    if (char === '(') {
      depth += 1
    } else if (char === ')') {
      depth = Math.max(0, depth - 1)
    }

    current += char
  }

  parts.push(current)
  return parts
}

function getRuleParts(ruleStr: string): {
  parts: string[]
  rulePartsStart: number
  type: string
  targetIndex: number | null
  target: string | undefined
} {
  const parts = splitByTopLevelCommas(ruleStr).map((part) => part.trim())
  const firstPartIsNumber = parts.length >= 3 && parts[0] !== '' && !Number.isNaN(Number(parts[0]))
  const rulePartsStart = firstPartIsNumber ? 1 : 0
  const type = parts[rulePartsStart] || ''
  const targetIndex = type === 'MATCH' ? rulePartsStart + 1 : rulePartsStart + 2
  const target = targetIndex < parts.length ? parts[targetIndex] : undefined

  return {
    parts,
    rulePartsStart,
    type,
    targetIndex: type ? targetIndex : null,
    target
  }
}

export function getRuleTarget(ruleStr: string): string | undefined {
  return getRuleParts(ruleStr).target
}

export function getProfileDefaultRuleTargetFromRules(ruleStrings: string[]): string {
  const matchRule = [...ruleStrings].reverse().find((rule) => getRuleParts(rule).type === 'MATCH')

  return matchRule ? getRuleTarget(matchRule) || DIRECT_RULE_TARGET : DIRECT_RULE_TARGET
}

function replaceRuleTarget(ruleStr: string, target: string): string {
  const { parts, targetIndex } = getRuleParts(ruleStr)

  if (targetIndex === null || targetIndex >= parts.length) {
    return ruleStr
  }

  parts[targetIndex] = target
  return parts.join(',')
}

function shouldNormalizeTargetToVpn(
  target: string | undefined,
  defaultTarget: string,
  isProfileFallbackRule: boolean
): boolean {
  if (!target) return false
  if (LEGACY_VPN_RULE_TARGETS.has(target)) return true

  if (target !== defaultTarget) return false

  if (defaultTarget === DIRECT_RULE_TARGET) {
    return isProfileFallbackRule
  }

  return true
}

export function normalizeRuleTargetForVpnRouting(
  ruleStr: string,
  defaultTarget: string,
  options: { isProfileFallbackRule?: boolean } = {}
): string {
  const target = getRuleTarget(ruleStr)

  if (shouldNormalizeTargetToVpn(target, defaultTarget, options.isProfileFallbackRule === true)) {
    return replaceRuleTarget(ruleStr, VPN_RULE_TARGET)
  }

  return ruleStr
}

export function normalizeProfileRuleTargets(
  ruleStrings: string[],
  defaultTarget = getProfileDefaultRuleTargetFromRules(ruleStrings)
): string[] {
  const fallbackRuleIndex = ruleStrings.findLastIndex((rule) => getRuleParts(rule).type === 'MATCH')

  return ruleStrings.map((ruleStr, index) =>
    normalizeRuleTargetForVpnRouting(ruleStr, defaultTarget, {
      isProfileFallbackRule: index === fallbackRuleIndex
    })
  )
}
