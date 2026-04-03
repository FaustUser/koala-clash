import React, { createContext, useContext, type ReactNode } from 'react'
import useSWR from 'swr'
import { getRuntimeConfig } from '@renderer/utils/ipc'

interface RulesContextType {
  rules: ControllerRules | undefined
  mutate: () => void
}

const RulesContext = createContext<RulesContextType | undefined>(undefined)

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

function parseRuntimeRule(ruleValue: unknown): ControllerRulesDetail {
  const serializedRule =
    Array.isArray(ruleValue) ? ruleValue.join(',') : typeof ruleValue === 'string' ? ruleValue : ''
  const parts = splitByTopLevelCommas(serializedRule).map((part) => part.trim())
  const firstPartIsNumber = parts.length >= 3 && parts[0] !== '' && !Number.isNaN(Number(parts[0]))
  const ruleParts = firstPartIsNumber ? parts.slice(1) : parts
  const [type = '', payloadOrTarget = '', proxy = ''] = ruleParts

  return {
    type,
    payload: type === 'MATCH' ? '' : payloadOrTarget,
    proxy: type === 'MATCH' ? payloadOrTarget : proxy,
    size: 0
  }
}

async function getOrderedRuntimeRules(): Promise<ControllerRules> {
  const runtimeConfig = await getRuntimeConfig()
  const rules = Array.isArray(runtimeConfig.rules) ? runtimeConfig.rules : []

  return {
    rules: rules.map((rule) => parseRuntimeRule(rule))
  }
}

export const RulesProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { data: rules, mutate } = useSWR<ControllerRules>('orderedRuntimeRules', getOrderedRuntimeRules, {
    errorRetryInterval: 200,
    errorRetryCount: 10
  })

  React.useEffect(() => {
    const handleRulesUpdated = (): void => {
      mutate()
    }
    const handleCoreStarted = (): void => {
      mutate()
    }

    window.electron.ipcRenderer.on('rulesUpdated', handleRulesUpdated)
    window.electron.ipcRenderer.on('core-started', handleCoreStarted)

    return (): void => {
      window.electron.ipcRenderer.removeListener('rulesUpdated', handleRulesUpdated)
      window.electron.ipcRenderer.removeListener('core-started', handleCoreStarted)
    }
  }, [mutate])

  return <RulesContext.Provider value={{ rules, mutate }}>{children}</RulesContext.Provider>
}

export const useRules = (): RulesContextType => {
  const context = useContext(RulesContext)
  if (context === undefined) {
    throw new Error('useRules must be used within an RulesProvider')
  }
  return context
}
