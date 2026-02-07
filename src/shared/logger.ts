export function log(message: string, data?: unknown): void {
  if (data) {
    console.log(`[opencode-cc] ${message}`, data)
    return
  }
  console.log(`[opencode-cc] ${message}`)
}

export function createLogger(namespace: string): (message: string, data?: unknown) => void {
  return (message: string, data?: unknown): void => {
    if (data) {
      console.log(`[opencode-cc][${namespace}] ${message}`, data)
      return
    }
    console.log(`[opencode-cc][${namespace}] ${message}`)
  }
}
