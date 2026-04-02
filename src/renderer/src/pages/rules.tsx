import BasePage from '@renderer/components/base/base-page'
import RuleItem from '@renderer/components/rules/rule-item'
import EditRulesModal from '@renderer/components/profiles/edit-rules-modal'
import { Virtuoso } from 'react-virtuoso'
import { useEffect, useMemo, useState } from 'react'
import { Separator } from '@renderer/components/ui/separator'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Spinner } from '@renderer/components/ui/spinner'
import { useRules } from '@renderer/hooks/use-rules'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { getCurrentProfileStr, mihomoTestRuleUrl, restartCore } from '@renderer/utils/ipc'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Database, Pencil } from 'lucide-react'
import yaml from 'js-yaml'
import { toast } from 'sonner'

const VPN_LABEL = 'VPN'
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

const formatMatchedRule = (result: ControllerRuleTestResult): string => {
  return result.matchedRulePayload
    ? `${result.matchedRuleType}(${result.matchedRulePayload})`
    : result.matchedRuleType
}

const formatProxyChain = (result: ControllerRuleTestResult, fallback: string): string => {
  return result.proxyChain.length > 0 ? [...result.proxyChain].reverse().join(' → ') : fallback
}

const formatRequestResult = (result: ControllerRuleTestResult, fallback: string): string => {
  if (result.requestError) {
    return result.requestError
  }

  if (result.statusCode) {
    return result.statusMessage
      ? `${result.statusCode} ${result.statusMessage}`
      : `${result.statusCode}`
  }

  return fallback
}

const getTrafficPathBadgeVariant = (path: ControllerRuleTestTrafficPath): BadgeVariant => {
  switch (path) {
    case 'direct':
      return 'secondary'
    case 'vpn':
      return 'default'
    case 'reject':
      return 'destructive'
    default:
      return 'outline'
  }
}

const getTrafficPathLabel = (
  path: ControllerRuleTestTrafficPath,
  t: ReturnType<typeof useTranslation>['t']
): string => {
  switch (path) {
    case 'direct':
      return t('pages.rules.urlTest.pathDirect')
    case 'vpn':
      return t('pages.rules.urlTest.pathVpn')
    case 'reject':
      return t('pages.rules.urlTest.pathReject')
    default:
      return t('pages.rules.urlTest.pathUnknown')
  }
}

const ResultRow: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3">
    <span className="min-w-24 text-xs text-muted-foreground">{label}</span>
    <span className="text-right text-sm break-all">{value}</span>
  </div>
)

const getDefaultRuleTarget = (profileStr: string): string | null => {
  const parsed = yaml.load(profileStr) as Record<string, unknown> | undefined
  const rawRules = Array.isArray(parsed?.rules) ? (parsed.rules as string[]) : []
  const matchRule = [...rawRules].reverse().find((rule) => rule.split(',')[0]?.trim() === 'MATCH')

  if (!matchRule) return null

  const [, target = ''] = matchRule.split(',')
  return target.trim() || null
}

const Rules: React.FC = () => {
  const { t } = useTranslation()
  const { rules } = useRules()
  const { profileConfig } = useProfileConfig()
  const [filter, setFilter] = useState('')
  const [testUrl, setTestUrl] = useState('')
  const [testResult, setTestResult] = useState<ControllerRuleTestResult | null>(null)
  const [isTestingUrl, setIsTestingUrl] = useState(false)
  const [showRulesEditor, setShowRulesEditor] = useState(false)
  const [defaultRuleTarget, setDefaultRuleTarget] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    let mounted = true

    void getCurrentProfileStr()
      .then((profileStr) => {
        if (!mounted) return
        setDefaultRuleTarget(getDefaultRuleTarget(profileStr))
      })
      .catch(() => {
        if (!mounted) return
        setDefaultRuleTarget(null)
      })

    return () => {
      mounted = false
    }
  }, [profileConfig?.current])

  const displayedRules = useMemo(() => {
    if (!rules) return []

    return rules.rules.map((rule) => ({
      ...rule,
      proxy: defaultRuleTarget && rule.proxy === defaultRuleTarget ? VPN_LABEL : rule.proxy
    }))
  }, [rules, defaultRuleTarget])

  const filteredRules = useMemo(() => {
    if (!rules) return []
    if (filter === '') return displayedRules
    return displayedRules.filter((rule) => {
      return (
        includesIgnoreCase(rule.payload, filter) ||
        includesIgnoreCase(rule.type, filter) ||
        includesIgnoreCase(rule.proxy, filter)
      )
    })
  }, [rules, displayedRules, filter])

  const handleTestUrl = async (): Promise<void> => {
    const normalizedUrl = testUrl.trim()

    if (!normalizedUrl) {
      toast.error(t('common.cannotBeEmpty'))
      return
    }

    setIsTestingUrl(true)
    setTestResult(null)

    try {
      const result = await mihomoTestRuleUrl(normalizedUrl)
      setTestResult(result)
    } catch (error) {
      toast.error(`${error}`)
    } finally {
      setIsTestingUrl(false)
    }
  }

  return (
    <BasePage
      title={t('pages.rules.title')}
      header={
        <>
          {profileConfig?.current && (
            <Button
              size="icon-sm"
              variant="ghost"
              className="app-nodrag"
              title={t('profile.editRule')}
              onClick={() => setShowRulesEditor(true)}
            >
              <Pencil className="size-4" />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className="app-nodrag"
            title={t('pages.resources.title')}
            onClick={() => navigate('/resources')}
          >
            <Database className="text-lg" />
          </Button>
        </>
      }
    >
      {showRulesEditor && profileConfig?.current && (
        <EditRulesModal
          id={profileConfig.current}
          onClose={async () => {
            setShowRulesEditor(false)
            await restartCore()
          }}
        />
      )}
      <div className="flex h-full flex-col">
        <div className="sticky top-0 z-40 bg-background/75 backdrop-blur-xl">
          <div className="flex flex-col gap-2 px-2 pb-2">
            <div className="rounded-xl border bg-card/50 p-3">
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-sm font-medium">{t('pages.rules.urlTest.title')}</div>
                  <p className="text-xs text-muted-foreground">
                    {t('pages.rules.urlTest.description')}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    className="h-9 text-sm"
                    value={testUrl}
                    placeholder={t('pages.rules.urlTest.placeholder')}
                    onChange={(e) => setTestUrl(e.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        void handleTestUrl()
                      }
                    }}
                  />
                  <Button
                    className="sm:min-w-28"
                    disabled={isTestingUrl}
                    onClick={() => void handleTestUrl()}
                  >
                    {isTestingUrl && <Spinner className="size-4" />}
                    {isTestingUrl
                      ? t('pages.rules.urlTest.testing')
                      : t('pages.rules.urlTest.action')}
                  </Button>
                </div>
                {testResult && (
                  <div className="rounded-lg border bg-background/60 p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">{t('pages.rules.urlTest.result')}</div>
                      <Badge variant={getTrafficPathBadgeVariant(testResult.trafficPath)}>
                        {getTrafficPathLabel(testResult.trafficPath, t)}
                      </Badge>
                    </div>
                    <div className="grid gap-2">
                      <ResultRow label={t('pages.rules.urlTest.url')} value={testResult.url} />
                      <ResultRow label={t('pages.rules.urlTest.host')} value={testResult.host} />
                      <ResultRow
                        label={t('pages.rules.urlTest.rule')}
                        value={formatMatchedRule(testResult)}
                      />
                      <ResultRow
                        label={t('pages.rules.urlTest.target')}
                        value={testResult.matchedRuleTarget}
                      />
                      <ResultRow
                        label={t('pages.rules.urlTest.outbound')}
                        value={testResult.outbound}
                      />
                      <ResultRow
                        label={t('pages.rules.urlTest.chain')}
                        value={formatProxyChain(testResult, t('common.noData'))}
                      />
                      <ResultRow
                        label={t('pages.rules.urlTest.request')}
                        value={formatRequestResult(testResult, t('common.noData'))}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <Input
              className="h-8 text-sm"
              value={filter}
              placeholder={t('common.filter')}
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
          <Separator className="mx-2" />
        </div>
        <div className="mt-px min-h-0 flex-1">
          <Virtuoso
            style={{ height: '100%' }}
            data={filteredRules}
            itemContent={(i, rule) => (
              <RuleItem
                index={i}
                type={rule.type}
                payload={rule.payload}
                proxy={rule.proxy}
                size={rule.size}
              />
            )}
          />
        </div>
      </div>
    </BasePage>
  )
}

export default Rules
