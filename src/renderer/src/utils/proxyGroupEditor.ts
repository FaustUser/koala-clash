interface ProxyGroupEditorLoadKeyInput {
  groupName: string
  onClose: () => void
  onSaved: () => void
}

export function getProxyGroupEditorLoadKey(input: ProxyGroupEditorLoadKeyInput): string {
  return input.groupName
}
