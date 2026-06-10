interface ProfileLabeledProxy {
  name?: string
  serverDescription?: string
}

export function buildCandidateProfileLabels(
  proxies: ProfileLabeledProxy[],
  activeProfileLabel: string
): Record<string, string> {
  const labels: Record<string, string> = {}

  for (const proxy of proxies) {
    const name = proxy.name?.trim()
    if (!name) continue
    labels[name] = proxy.serverDescription?.trim() || activeProfileLabel
  }

  return labels
}
