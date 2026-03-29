import BasePage from '@renderer/components/base/base-page'
import RuleItem from '@renderer/components/rules/rule-item'
import EditRulesModal from '@renderer/components/profiles/edit-rules-modal'
import { Virtuoso } from 'react-virtuoso'
import { useEffect, useMemo, useState } from 'react'
import { Separator } from '@renderer/components/ui/separator'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { useRules } from '@renderer/hooks/use-rules'
import { useProfileConfig } from '@renderer/hooks/use-profile-config'
import { getCurrentProfileStr, restartCore } from '@renderer/utils/ipc'
import { includesIgnoreCase } from '@renderer/utils/includes'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Database, Pencil } from 'lucide-react'
import yaml from 'js-yaml'

const VPN_LABEL = 'VPN'

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
      <div className="sticky top-0 z-40">
        <div className="flex px-2 pb-2">
          <Input
            className="h-8 text-sm"
            value={filter}
            placeholder={t('common.filter')}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <Separator className="mx-2" />
      </div>
      <div className="h-[calc(100vh-108px)] mt-px">
        <Virtuoso
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
    </BasePage>
  )
}

export default Rules
