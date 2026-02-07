import { log } from "../../shared"

function expandEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    const envValue = process.env[name]
    if (envValue === undefined) {
      log(`Environment variable "${name}" is not set, replacing with empty string`)
    }
    return envValue ?? ""
  })
}

export function expandEnvVarsInObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") {
    return expandEnv(obj) as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => expandEnvVarsInObject(item)) as T
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = expandEnvVarsInObject(value)
    }
    return result as T
  }
  return obj
}
