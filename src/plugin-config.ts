import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeConfigDir } from "./shared"

export interface OpencodeCcConfig {
  claude_code?: {
    plugins?: boolean
    plugins_override?: Record<string, boolean>
    commands?: boolean
    skills?: boolean
    agents?: boolean
    mcp?: boolean
    hooks?: boolean
    instructions?: boolean
  }
}

const DEFAULT_CONFIG: OpencodeCcConfig = {
  claude_code: {
    plugins: true,
    plugins_override: undefined,
    commands: true,
    skills: true,
    agents: true,
    mcp: true,
    hooks: true,
    instructions: true,
  },
}

function getProjectConfigPath(): string {
  return join(process.cwd(), ".opencode", "opencode-cc.json")
}

function getUserConfigPath(): string {
  return join(getOpenCodeConfigDir({ binary: "opencode" }), "opencode-cc.json")
}

function mergeConfig(base: OpencodeCcConfig, override?: OpencodeCcConfig): OpencodeCcConfig {
  if (!override) return base
  return {
    claude_code: {
      ...base.claude_code,
      ...override.claude_code,
      plugins_override: {
        ...base.claude_code?.plugins_override,
        ...override.claude_code?.plugins_override,
      },
    },
  }
}

function loadConfigFromPath(path: string): OpencodeCcConfig | null {
  if (!existsSync(path)) return null
  try {
    const content = readFileSync(path, "utf-8")
    const parsed = JSON.parse(content)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null
    }
    if (parsed.claude_code !== undefined && typeof parsed.claude_code !== "object") {
      return null
    }
    return parsed as OpencodeCcConfig
  } catch {
    return null
  }
}

export function loadPluginConfig(): OpencodeCcConfig {
  const userConfig = loadConfigFromPath(getUserConfigPath())
  const projectConfig = loadConfigFromPath(getProjectConfigPath())

  let merged = mergeConfig(DEFAULT_CONFIG, userConfig ?? undefined)
  merged = mergeConfig(merged, projectConfig ?? undefined)

  return merged
}
