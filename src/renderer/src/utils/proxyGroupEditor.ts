interface ProxyGroupEditorLoadKeyInput {
  groupName: string
  onClose: () => void
  onSaved: () => void
}

export function getProxyGroupEditorLoadKey(input: ProxyGroupEditorLoadKeyInput): string {
  return input.groupName
}

export function getProxyGroupEditorScrollClassName(): string {
  return 'py-2 pr-4 flex flex-col gap-1 overflow-y-auto min-h-0 [scrollbar-gutter:stable]'
}
