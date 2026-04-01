import React, { createContext, useContext, ReactNode } from 'react'
import useSWR from 'swr'
import { mihomoGroups } from '@renderer/utils/ipc'

interface GroupsContextType {
  groups: ControllerMixedGroup[] | undefined
  mutate: () => void
}

const GroupsContext = createContext<GroupsContextType | undefined>(undefined)

export const GroupsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { data: groups, mutate } = useSWR<ControllerMixedGroup[]>('mihomoGroups', mihomoGroups, {
    errorRetryInterval: 200,
    errorRetryCount: 10,
    refreshInterval: 3000
  })

  React.useEffect(() => {
    const handleGroupsUpdated = (): void => {
      mutate()
    }
    const handleCoreStarted = (): void => {
      mutate()
    }

    window.electron.ipcRenderer.on('groupsUpdated', handleGroupsUpdated)
    window.electron.ipcRenderer.on('core-started', handleCoreStarted)

    return (): void => {
      window.electron.ipcRenderer.removeListener('groupsUpdated', handleGroupsUpdated)
      window.electron.ipcRenderer.removeListener('core-started', handleCoreStarted)
    }
  }, [mutate])

  return <GroupsContext.Provider value={{ groups, mutate }}>{children}</GroupsContext.Provider>
}

export const useGroups = (): GroupsContextType => {
  const context = useContext(GroupsContext)
  if (context === undefined) {
    throw new Error('useGroups must be used within an GroupsProvider')
  }
  return context
}
