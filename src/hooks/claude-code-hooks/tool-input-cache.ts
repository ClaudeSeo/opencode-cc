const TOOL_INPUT_CACHE = new Map<string, Record<string, unknown>>()
const MAX_CACHE_SIZE = 1000

function buildKey(sessionId: string, toolName: string, callId: string): string {
  return `${sessionId}:${toolName}:${callId}`
}

export function cacheToolInput(
  sessionId: string,
  toolName: string,
  callId: string,
  input: Record<string, unknown>
): void {
  if (TOOL_INPUT_CACHE.size >= MAX_CACHE_SIZE) {
    const firstKey = TOOL_INPUT_CACHE.keys().next().value
    if (firstKey) TOOL_INPUT_CACHE.delete(firstKey)
  }
  TOOL_INPUT_CACHE.set(buildKey(sessionId, toolName, callId), input)
}

export function getToolInput(
  sessionId: string,
  toolName: string,
  callId: string
): Record<string, unknown> | undefined {
  return TOOL_INPUT_CACHE.get(buildKey(sessionId, toolName, callId))
}

export function clearSessionCache(sessionId: string): void {
  const prefix = `${sessionId}:`
  for (const key of TOOL_INPUT_CACHE.keys()) {
    if (key.startsWith(prefix)) {
      TOOL_INPUT_CACHE.delete(key)
    }
  }
}
