import React, { useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import SettingCard from '../base/base-setting-card'
import SettingItem from '../base/base-setting-item'
import EditableList from '../base/base-list-editor'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Separator } from '@renderer/components/ui/separator'
import { Switch } from '@renderer/components/ui/switch'
import { Textarea } from '@renderer/components/ui/textarea'
import type { ValidationResult } from '@renderer/utils/validate'
import {
  isValidDnsServer,
  isValidDomainWildcard,
  isValidIPv4Cidr,
  isValidIPv6Cidr
} from '@renderer/utils/validate'
import { useTranslation } from 'react-i18next'

type FallbackFilterTemplateId =
  | 'docs-cn'
  | 'local-ru'
  | 'local-us'
  | 'global-services'
  | 'minimal'

const FALLBACK_FILTER_TEMPLATE_IDS: FallbackFilterTemplateId[] = [
  'docs-cn',
  'local-ru',
  'local-us',
  'global-services',
  'minimal'
]

interface AdvancedDnsSettingProps {
  respectRules: boolean
  selectedFallbackTemplateId?: FallbackFilterTemplateId
  fallbackTemplatePreviewTitle?: string
  fallbackTemplatePreviewResolvers: string[]
  fallbackTemplatePreviewFilter: Record<string, unknown>
  fallback: string[]
  fallbackGeoIP: boolean
  fallbackGeoIPCode: string[]
  fallbackDomain: string[]
  fallbackIPCIDR: string[]
  fallbackGeoSite: string[]
  fallbackFilterExtra: string
  directNameserver: string[]
  proxyServerNameserver: string[]
  nameserverPolicy: Record<string, string | string[]>
  hosts?: IHost[]
  useHosts: boolean
  useSystemHosts: boolean
  onRespectRulesChange: (v: boolean) => void
  onFallbackChange: (list: string[]) => void
  onFallbackGeoIPChange: (v: boolean) => void
  onFallbackGeoIPCodeChange: (list: string[]) => void
  onFallbackDomainChange: (list: string[]) => void
  onFallbackIPCIDRChange: (list: string[]) => void
  onFallbackGeoSiteChange: (list: string[]) => void
  onFallbackFilterExtraChange: (value: string) => void
  onApplyFallbackFilterTemplate: (templateId: string) => void
  onDirectNameserverChange: (list: string[]) => void
  onProxyNameserverChange: (list: string[]) => void
  onNameserverPolicyChange: (policy: Record<string, string | string[]>) => void
  onUseSystemHostsChange: (v: boolean) => void
  onUseHostsChange: (v: boolean) => void
  onHostsChange: (hosts: IHost[]) => void
  onErrorChange?: (hasError: boolean) => void
}

const AdvancedDnsSetting: React.FC<AdvancedDnsSettingProps> = ({
  respectRules,
  selectedFallbackTemplateId,
  fallbackTemplatePreviewTitle,
  fallbackTemplatePreviewResolvers,
  fallbackTemplatePreviewFilter,
  fallback,
  fallbackGeoIP,
  fallbackGeoIPCode,
  fallbackDomain,
  fallbackIPCIDR,
  fallbackGeoSite,
  fallbackFilterExtra,
  directNameserver,
  proxyServerNameserver,
  nameserverPolicy,
  hosts,
  useHosts,
  useSystemHosts,
  onRespectRulesChange,
  onFallbackChange,
  onFallbackGeoIPChange,
  onFallbackGeoIPCodeChange,
  onFallbackDomainChange,
  onFallbackIPCIDRChange,
  onFallbackGeoSiteChange,
  onFallbackFilterExtraChange,
  onApplyFallbackFilterTemplate,
  onDirectNameserverChange,
  onProxyNameserverChange,
  onNameserverPolicyChange,
  onUseSystemHostsChange,
  onUseHostsChange,
  onHostsChange,
  onErrorChange
}) => {
  const { t } = useTranslation()
  const isValidIPCIDR = (value: string): ValidationResult => {
    const ipv4Result = isValidIPv4Cidr(value)
    if (ipv4Result.ok) return { ok: true }

    const ipv6Result = isValidIPv6Cidr(value)
    if (ipv6Result.ok) return { ok: true }

    return ipv4Result.error ? ipv4Result : ipv6Result
  }

  const isValidToken = (value: string): ValidationResult => {
    return value.trim()
      ? { ok: true }
      : { ok: false, error: t('common.cannotBeEmpty') }
  }

  const validateFallbackFilterExtra = (value: string): string | null => {
    if (!value.trim()) return null

    try {
      const parsed = JSON.parse(value) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return t('dns.fallbackFilterExtraObjectError')
      }
      return null
    } catch {
      return t('dns.fallbackFilterExtraFormatError')
    }
  }

  const [fallbackError, setFallbackError] = useState<string | null>(null)
  const [fallbackDomainError, setFallbackDomainError] = useState<string | null>(null)
  const [fallbackIPCIDRError, setFallbackIPCIDRError] = useState<string | null>(null)
  const [fallbackFilterExtraError, setFallbackFilterExtraError] = useState<string | null>(() =>
    validateFallbackFilterExtra(fallbackFilterExtra)
  )
  const [directNameserverError, setDirectNameserverError] = useState<string | null>(null)
  const [proxyNameserverError, setProxyNameserverError] = useState<string | null>(null)
  const [nameserverPolicyError, setNameserverPolicyError] = useState<string | null>(null)
  const [hostsError, setHostsError] = useState<string | null>(null)

  const fallbackTemplateMeta: Record<
    FallbackFilterTemplateId,
    { title: string; description: string }
  > = {
    'docs-cn': {
      title: t('dns.fallbackFilterTemplateDocsCn'),
      description: t('dns.fallbackFilterTemplateDocsCnDesc')
    },
    'local-ru': {
      title: t('dns.fallbackFilterTemplateLocalRu'),
      description: t('dns.fallbackFilterTemplateLocalRuDesc')
    },
    'local-us': {
      title: t('dns.fallbackFilterTemplateLocalUs'),
      description: t('dns.fallbackFilterTemplateLocalUsDesc')
    },
    'global-services': {
      title: t('dns.fallbackFilterTemplateGlobalServices'),
      description: t('dns.fallbackFilterTemplateGlobalServicesDesc')
    },
    minimal: {
      title: t('dns.fallbackFilterTemplateMinimal'),
      description: t('dns.fallbackFilterTemplateMinimalDesc')
    }
  }

  React.useEffect(() => {
    const hasError = Boolean(
      fallbackError ||
        fallbackDomainError ||
        fallbackIPCIDRError ||
        fallbackFilterExtraError ||
        directNameserverError ||
        proxyNameserverError ||
        nameserverPolicyError ||
        hostsError
    )
    onErrorChange?.(hasError)
  }, [
    fallbackError,
    fallbackDomainError,
    fallbackIPCIDRError,
    fallbackFilterExtraError,
    directNameserverError,
    proxyNameserverError,
    nameserverPolicyError,
    hostsError,
    onErrorChange
  ])

  return (
    <SettingCard title={t('dns.moreSettings')}>
      <SettingItem title={t('dns.connectionRespectRules')} divider>
        <Switch
          checked={respectRules}
          disabled={proxyServerNameserver.length === 0}
          onCheckedChange={onRespectRulesChange}
        />
      </SettingItem>
      <EditableList
        title={t('dns.fallbackResolver')}
        items={fallback}
        validate={(part) => isValidDnsServer(part as string)}
        onChange={(list) => {
          const arr = list as string[]
          onFallbackChange(arr)
          const firstInvalid = arr.find((item) => !isValidDnsServer(item).ok)
          setFallbackError(
            firstInvalid ? (isValidDnsServer(firstInvalid).error ?? t('common.formatError')) : null
          )
        }}
        placeholder={t('pages.dns.placeholderTLS')}
      />
      <SettingItem
        title={t('dns.fallbackFilterGeoIP')}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline">
                {t('dns.applyFallbackFilterTemplate')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {FALLBACK_FILTER_TEMPLATE_IDS.map((templateId) => (
                <DropdownMenuItem
                  key={templateId}
                  onClick={() => onApplyFallbackFilterTemplate(templateId)}
                >
                  <div className="flex flex-col">
                    <span>{fallbackTemplateMeta[templateId].title}</span>
                    <span className="text-xs text-muted-foreground">
                      {fallbackTemplateMeta[templateId].description}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
        divider
      >
        <Switch checked={fallbackGeoIP} onCheckedChange={onFallbackGeoIPChange} />
      </SettingItem>
      {selectedFallbackTemplateId && (
        <div className="mb-2 rounded-xl border border-stroke bg-card/30 p-3 text-sm">
          <div className="font-medium">{fallbackTemplatePreviewTitle}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {fallbackTemplateMeta[selectedFallbackTemplateId].description}
          </div>
          <div className="mt-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('dns.previewFallbackResolvers')}
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-all text-xs">
              {fallbackTemplatePreviewResolvers.length > 0
                ? fallbackTemplatePreviewResolvers.join('\n')
                : '[]'}
            </pre>
          </div>
          <div className="mt-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('dns.previewFallbackFilter')}
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(fallbackTemplatePreviewFilter, null, 2)}
            </pre>
          </div>
        </div>
      )}
      <EditableList
        title={t('dns.fallbackFilterGeoIPCode')}
        items={fallbackGeoIPCode}
        validate={(part) => isValidToken(part as string)}
        onChange={(list) => {
          onFallbackGeoIPCodeChange(list as string[])
        }}
        placeholder={t('pages.dns.placeholderCountryCode')}
      />
      <EditableList
        title={t('dns.fallbackFilterDomain')}
        items={fallbackDomain}
        validate={(part) => isValidDomainWildcard(part as string)}
        onChange={(list) => {
          const arr = list as string[]
          onFallbackDomainChange(arr)
          const firstInvalid = arr.find((item) => !isValidDomainWildcard(item).ok)
          setFallbackDomainError(
            firstInvalid
              ? (isValidDomainWildcard(firstInvalid).error ?? t('common.formatError'))
              : null
          )
        }}
        placeholder={t('pages.dns.placeholderLan')}
      />
      <EditableList
        title={t('dns.fallbackFilterIPCIDR')}
        items={fallbackIPCIDR}
        validate={(part) => isValidIPCIDR(part as string)}
        onChange={(list) => {
          const arr = list as string[]
          onFallbackIPCIDRChange(arr)
          const firstInvalid = arr.find((item) => !isValidIPCIDR(item).ok)
          setFallbackIPCIDRError(
            firstInvalid ? (isValidIPCIDR(firstInvalid).error ?? t('common.formatError')) : null
          )
        }}
        placeholder={t('pages.dns.placeholderCIDR')}
      />
      <EditableList
        title={t('dns.fallbackFilterGeoSite')}
        items={fallbackGeoSite}
        validate={(part) => isValidToken(part as string)}
        onChange={(list) => {
          onFallbackGeoSiteChange(list as string[])
        }}
        placeholder={t('pages.dns.placeholderGeosite')}
      />
      <div className="flex flex-col space-y-2">
        <h4 className="text-base font-medium">{t('dns.fallbackFilterExtra')}</h4>
        <Textarea
          rows={6}
          className={
            fallbackFilterExtraError
              ? 'border-red-500 ring-1 ring-red-500 rounded-lg'
              : undefined
          }
          placeholder={t('dns.fallbackFilterExtraPlaceholder')}
          value={fallbackFilterExtra}
          onChange={(event) => {
            const nextValue = event.target.value
            onFallbackFilterExtraChange(nextValue)
            setFallbackFilterExtraError(validateFallbackFilterExtra(nextValue))
          }}
        />
        {fallbackFilterExtraError && (
          <p className="text-sm text-destructive">{fallbackFilterExtraError}</p>
        )}
      </div>
      <Separator className="mt-2 mb-2" />
      <EditableList
        title={t('dns.directResolver')}
        items={directNameserver}
        validate={(part) => isValidDnsServer(part as string)}
        onChange={(list) => {
          const arr = list as string[]
          onDirectNameserverChange(arr)
          const firstInvalid = arr.find((f) => !isValidDnsServer(f).ok)
          setDirectNameserverError(
            firstInvalid ? (isValidDnsServer(firstInvalid).error ?? t('common.formatError')) : null
          )
        }}
        placeholder={t('pages.dns.placeholderTLS')}
      />
      <EditableList
        title={t('dns.proxyNodeResolver')}
        items={proxyServerNameserver}
        validate={(part) => isValidDnsServer(part as string)}
        onChange={(list) => {
          const arr = list as string[]
          onProxyNameserverChange(arr)
          const firstInvalid = arr.find((f) => !isValidDnsServer(f).ok)
          setProxyNameserverError(
            firstInvalid ? (isValidDnsServer(firstInvalid).error ?? t('common.formatError')) : null
          )
        }}
        placeholder={t('pages.dns.placeholderTLS')}
      />

      <EditableList
        title={t('dns.domainResolutionPolicy')}
        items={nameserverPolicy}
        validatePart1={(part1) => isValidDomainWildcard(part1)}
        validatePart2={(part2) => {
          const parts = part2
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
          for (const p of parts) {
            const result = isValidDnsServer(p)
            if (!result.ok) {
              return result
            }
          }
          return { ok: true }
        }}
        onChange={(newValue) => {
          onNameserverPolicyChange(newValue as Record<string, string | string[]>)
          try {
            const rec = newValue as Record<string, string | string[]>
            for (const domain of Object.keys(rec)) {
              if (!isValidDomainWildcard(domain).ok) {
                setNameserverPolicyError(
                  isValidDomainWildcard(domain).error ?? t('dns.domainFormatError')
                )
                return
              }
            }
            for (const v of Object.values(rec)) {
              if (Array.isArray(v)) {
                for (const vv of v) {
                  if (!isValidDnsServer(vv).ok) {
                    setNameserverPolicyError(
                      isValidDnsServer(vv).error ?? t('common.formatError')
                    )
                    return
                  }
                }
              } else {
                const parts = (v as string)
                  .split(',')
                  .map((p) => p.trim())
                  .filter(Boolean)
                for (const p of parts) {
                  if (!isValidDnsServer(p).ok) {
                    setNameserverPolicyError(
                      isValidDnsServer(p).error ?? t('common.formatError')
                    )
                    return
                  }
                }
              }
            }
            setNameserverPolicyError(null)
          } catch (e) {
            setNameserverPolicyError(t('dns.policyFormatError'))
          }
        }}
        placeholder={t('dns.domain')}
        part2Placeholder={t('dns.dnsServerCommaSeparated')}
        objectMode="record"
      />
      <SettingItem title={t('dns.useSystemHosts')} divider>
        <Switch checked={useSystemHosts} onCheckedChange={onUseSystemHostsChange} />
      </SettingItem>
      <SettingItem title={t('dns.customHosts')}>
        <Switch checked={useHosts} onCheckedChange={onUseHostsChange} />
      </SettingItem>
      {useHosts && (
        <EditableList
          items={hosts ? Object.fromEntries(hosts.map((h) => [h.domain, h.value])) : {}}
          validatePart1={(part1) => isValidDomainWildcard(part1)}
          onChange={(rec) => {
            const hostArr: IHost[] = Object.entries(rec as Record<string, string | string[]>).map(
              ([domain, value]) => ({
                domain,
                value: value as string | string[]
              })
            )
            onHostsChange(hostArr)
            for (const domain of Object.keys(rec as Record<string, string | string[]>)) {
              if (!isValidDomainWildcard(domain).ok) {
                setHostsError(isValidDomainWildcard(domain).error ?? t('dns.domainFormatError'))
                return
              }
            }
            setHostsError(null)
          }}
          placeholder={t('dns.domain')}
          part2Placeholder={t('dns.domainOrIPCommaSeparated')}
          objectMode="record"
          divider={false}
        />
      )}
    </SettingCard>
  )
}

export default AdvancedDnsSetting
