import React, { createContext, useContext, ReactNode } from 'react'
import useSWR from 'swr'
import { mihomoGroups } from '@renderer/utils/ipc'

interface GroupsContextType {
  groups: ControllerMixedGroup[] | undefined
  mutate: () => void
  pauseRefresh: () => void
  resumeRefresh: () => void
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined)

export const GroupsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [refreshPauseCount, setRefreshPauseCount] = React.useState(0)
  const refreshPaused = refreshPauseCount > 0
  const pauseRefresh = React.useCallback(() => {
    setRefreshPauseCount((count) => count + 1)
  }, [])
  const resumeRefresh = React.useCallback(() => {
    setRefreshPauseCount((count) => Math.max(0, count - 1))
  }, [])
  const { data: groups, mutate } = useSWR<ControllerMixedGroup[]>('mihomoGroups', mihomoGroups, {
    errorRetryInterval: 200,
    errorRetryCount: 10,
    refreshInterval: refreshPaused ? 0 : 3000
  })

  React.useEffect(() => {
    const handleGroupsUpdated = (): void => {
      if (refreshPaused) return
      mutate()
    }
    const handleCoreStarted = (): void => {
      if (refreshPaused) return
      mutate()
    }

    window.electron.ipcRenderer.on('groupsUpdated', handleGroupsUpdated)
    window.electron.ipcRenderer.on('core-started', handleCoreStarted)

    return (): void => {
      window.electron.ipcRenderer.removeListener('groupsUpdated', handleGroupsUpdated)
      window.electron.ipcRenderer.removeListener('core-started', handleCoreStarted)
    }
  }, [mutate, refreshPaused])

  React.useEffect(() => {
    if (!refreshPaused) {
      mutate()
    }
  }, [mutate, refreshPaused])

  return (
    <GroupsContext.Provider value={{ groups, mutate, pauseRefresh, resumeRefresh }}>
      {children}
    </GroupsContext.Provider>
  )
}

export const useGroups = (): GroupsContextType => {
  const context = useContext(GroupsContext)
  if (context === undefined) {
    throw new Error('useGroups must be used within an GroupsProvider')
  }
  return context
}
