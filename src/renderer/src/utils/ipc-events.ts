type IpcListener<T = unknown> = (event: unknown, payload: T) => void

type ChannelEntry = {
  bridgeListener: (event: unknown, payload: unknown) => void
  listeners: Set<IpcListener>
}

type RendererIpcStore = {
  channels: Map<string, ChannelEntry>
}

type WindowWithIpcStore = Window & {
  __koalaIpcEventStore?: RendererIpcStore
}

function getIpcStore(): RendererIpcStore {
  const currentWindow = window as WindowWithIpcStore

  if (!currentWindow.__koalaIpcEventStore) {
    currentWindow.__koalaIpcEventStore = {
      channels: new Map<string, ChannelEntry>()
    }
  }

  return currentWindow.__koalaIpcEventStore
}

export function subscribeIpcEvent<T = unknown>(
  channel: string,
  listener: IpcListener<T>
): () => void {
  const store = getIpcStore()
  let entry = store.channels.get(channel)

  if (!entry) {
    const listeners = new Set<IpcListener>()
    const bridgeListener = (event: unknown, payload: unknown): void => {
      const currentEntry = store.channels.get(channel)
      if (!currentEntry) return

      currentEntry.listeners.forEach((registeredListener) => {
        registeredListener(event, payload)
      })
    }

    window.electron.ipcRenderer.on(channel, bridgeListener)
    entry = { bridgeListener, listeners }
    store.channels.set(channel, entry)
  }

  entry.listeners.add(listener as IpcListener)

  return (): void => {
    const currentEntry = store.channels.get(channel)
    if (!currentEntry) return

    currentEntry.listeners.delete(listener as IpcListener)
    if (currentEntry.listeners.size === 0) {
      window.electron.ipcRenderer.removeListener(channel, currentEntry.bridgeListener)
      store.channels.delete(channel)
    }
  }
}
