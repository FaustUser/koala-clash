import React, { createContext, useContext, ReactNode, useEffect, useState } from 'react'
import { getCoreHealth } from '@renderer/utils/ipc'

interface CoreHealthState {
  alive: boolean
  recovering: boolean
}

interface CoreHealthContextType {
  coreHealth: CoreHealthState | undefined
  refreshCoreHealth: () => Promise<void>
}

const CoreHealthContext = createContext<CoreHealthContextType | undefined>(undefined)

export const CoreHealthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [coreHealth, setCoreHealth] = useState<CoreHealthState>()

  const refreshCoreHealth = async (): Promise<void> => {
    try {
      const health = await getCoreHealth()
      setCoreHealth(health)
    } catch {
      setCoreHealth({ alive: false, recovering: false })
    }
  }

  useEffect(() => {
    const handleCoreHealthChanged = (
      _event: unknown,
      health: { alive: boolean; recovering: boolean }
    ): void => {
      setCoreHealth(health)
    }

    void refreshCoreHealth()
    window.electron.ipcRenderer.on('core-health-changed', handleCoreHealthChanged)

    return (): void => {
      window.electron.ipcRenderer.removeListener('core-health-changed', handleCoreHealthChanged)
    }
  }, [])

  return (
    <CoreHealthContext.Provider value={{ coreHealth, refreshCoreHealth }}>
      {children}
    </CoreHealthContext.Provider>
  )
}

export const useCoreHealth = (): CoreHealthContextType => {
  const context = useContext(CoreHealthContext)
  if (context === undefined) {
    throw new Error('useCoreHealth must be used within a CoreHealthProvider')
  }
  return context
}
