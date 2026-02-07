const PROVIDER_ALIASES: Record<string, string> = {
  claude: "anthropic",
}

function sanitizeProvider(provider: string): string {
  const lower = provider.trim().toLowerCase()
  return PROVIDER_ALIASES[lower] ?? lower
}

export function sanitizeModelField(
  model: unknown
): string | undefined {
  if (typeof model !== "string") return undefined
  const trimmed = model.trim()
  if (!trimmed) return undefined
  if (!trimmed.includes("/")) return trimmed

  const slashIndex = trimmed.indexOf("/")
  const provider = trimmed.slice(0, slashIndex)
  const modelId = trimmed.slice(slashIndex + 1)
  if (!provider || !modelId) return trimmed

  return `${sanitizeProvider(provider)}/${modelId}`
}
