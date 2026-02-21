function isDebugEnabled(): boolean {
  const debug = process.env.OPENCODE_CC_DEBUG?.toLowerCase()
  return debug === "1" || debug === "true"
}

export function log(message: string, data?: unknown): void {
  if (!isDebugEnabled()) return

  if (data) {
    console.error(`[opencode-cc] ${message}`, data)
    return
  }
  console.error(`[opencode-cc] ${message}`)
}

export function createLogger(namespace: string): (message: string, data?: unknown) => void {
  return (message: string, data?: unknown): void => {
    if (!isDebugEnabled()) return

    if (data) {
      console.error(`[opencode-cc][${namespace}] ${message}`, data)
      return
    }
    console.error(`[opencode-cc][${namespace}] ${message}`)
  }
}
