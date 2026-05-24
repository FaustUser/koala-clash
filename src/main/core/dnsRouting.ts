const DIRECT_RULE_TARGET = 'DIRECT'
const VPN_RULE_TARGET = 'VPN'
const SYSTEM_DNS_RESOLVER = 'system'
const FALLBACK_PROXY_SERVER_NAMESERVER = ['tls://1.1.1.1']

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

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function getRuleTarget(ruleStr: string): string | undefined {
  const parts = splitByTopLevelCommas(ruleStr).map((part) => part.trim())
  const firstPartIsNumber = !Number.isNaN(Number(parts[0])) && parts[0] !== '' && parts.length >= 3
  const ruleParts = firstPartIsNumber ? parts.slice(1) : parts
  const [type = '', payloadOrTarget = '', proxy = ''] = ruleParts

  if (!type) return undefined
  return type === 'MATCH' ? payloadOrTarget : proxy
}

function hasRuleTarget(rules: unknown, target: string): boolean {
  if (!Array.isArray(rules)) return false

  return rules.some((rule) => typeof rule === 'string' && getRuleTarget(rule) === target)
}

export function alignDnsWithDirectRules(profile: MihomoConfig): void {
  const dns = profile.dns

  if (!dns?.enable) return
  if (!hasRuleTarget(profile.rules, DIRECT_RULE_TARGET)) return
  if (!hasRuleTarget(profile.rules, VPN_RULE_TARGET)) return

  dns['respect-rules'] = true

  if (getStringArray(dns['direct-nameserver']).length === 0) {
    dns['direct-nameserver'] = [SYSTEM_DNS_RESOLVER]
  }

  if (getStringArray(dns['proxy-server-nameserver']).length === 0) {
    const defaultNameserver = getStringArray(dns['default-nameserver'])
    dns['proxy-server-nameserver'] =
      defaultNameserver.length > 0 ? defaultNameserver : FALLBACK_PROXY_SERVER_NAMESERVER
  }

  if (dns['direct-nameserver-follow-policy'] === undefined) {
    dns['direct-nameserver-follow-policy'] = false
  }
}
