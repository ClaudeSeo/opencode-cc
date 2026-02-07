import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs"
import { join } from "node:path"
import type { AgentConfig, Config } from "@opencode-ai/sdk"
import {
  loadUserCommands,
  loadProjectCommands,
  loadOpencodeGlobalCommands,
  loadOpencodeProjectCommands,
} from "../features/claude-code-command-loader"
import {
  loadUserSkills,
  loadProjectSkills,
  loadOpencodeGlobalSkills,
  loadOpencodeProjectSkills,
} from "../features/opencode-skill-loader"
import { loadUserAgents, loadProjectAgents } from "../features/claude-code-agent-loader"
import { loadMcpConfigs } from "../features/claude-code-mcp-loader"
import { loadAllPluginComponents } from "../features/claude-code-plugin-loader"
import { getClaudeConfigDir, log } from "../shared"
import type { OpencodeCcConfig } from "../plugin-config"

export interface ConfigHandlerDeps {
  ctx: { directory: string; client?: unknown }
  pluginConfig: OpencodeCcConfig
}

type PluginComponents = Awaited<ReturnType<typeof loadAllPluginComponents>>
type CommandMap = Awaited<ReturnType<typeof loadUserCommands>>

const EMPTY_PLUGIN_COMPONENTS: PluginComponents = {
  commands: {},
  skills: {},
  agents: {},
  mcpServers: {},
  hooksConfigs: [],
  instructions: [],
  plugins: [],
  errors: [],
}

function getSymlinkInstructionPatterns(rulesDir: string): string[] {
  if (!existsSync(rulesDir)) return []

  let entries: Array<{ name: string }>
  try {
    entries = readdirSync(rulesDir, { withFileTypes: true, encoding: "utf8" })
  } catch {
    return []
  }

  const patterns: string[] = []

  for (const entry of entries) {
    const entryPath = join(rulesDir, entry.name)

    let linkStat: ReturnType<typeof lstatSync>
    try {
      linkStat = lstatSync(entryPath)
    } catch {
      continue
    }

    if (!linkStat.isSymbolicLink()) continue

    let resolvedPath: string
    try {
      resolvedPath = realpathSync(entryPath)
    } catch {
      continue
    }

    let resolvedStat: ReturnType<typeof lstatSync>
    try {
      resolvedStat = lstatSync(resolvedPath)
    } catch {
      continue
    }

    if (resolvedStat.isDirectory()) {
      patterns.push(join(resolvedPath, "**", "*.md"))
      continue
    }

    if (resolvedStat.isFile() && resolvedPath.toLowerCase().endsWith(".md")) {
      patterns.push(`${resolvedPath}{,}`)
    }
  }

  return patterns
}

function getRuleInstructionPatterns(rulesDir: string): string[] {
  const patterns = [join(rulesDir, "**", "*.md")]

  try {
    const resolvedRulesDir = realpathSync(rulesDir)
    if (resolvedRulesDir !== rulesDir) {
      patterns.push(join(resolvedRulesDir, "**", "*.md"))
    }
  } catch {
    // Ignore missing or unreadable rule directories.
  }

  patterns.push(...getSymlinkInstructionPatterns(rulesDir))

  return patterns
}

function getDefaultClaudeInstructions(): string[] {
  const userRulesDir = join(getClaudeConfigDir(), "rules")
  const projectRulesDir = join(process.cwd(), ".claude", "rules")

  return [...getRuleInstructionPatterns(userRulesDir), ...getRuleInstructionPatterns(projectRulesDir)]
}

function toInstructionList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function mergeInstructions(existing: unknown, additions: string[]): string[] {
  const merged = toInstructionList(existing)
  const seen = new Set(merged)

  for (const addition of additions) {
    if (!seen.has(addition)) {
      seen.add(addition)
      merged.push(addition)
    }
  }

  return merged
}

function loadWhenEnabled<T>(
  enabled: boolean,
  loader: () => Promise<T>,
  fallback: T
): Promise<T> {
  return enabled ? loader() : Promise.resolve(fallback)
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  const { pluginConfig } = deps

  return async (config: Config) => {
    const claudeConfig = pluginConfig.claude_code

    const pluginComponents = claudeConfig?.plugins ?? true
      ? await loadAllPluginComponents({
          enabledPluginsOverride: claudeConfig?.plugins_override,
        })
      : EMPTY_PLUGIN_COMPONENTS

    if (pluginComponents.plugins.length > 0) {
      log(`Loaded ${pluginComponents.plugins.length} Claude Code plugins`, {
        plugins: pluginComponents.plugins.map((p) => `${p.name}@${p.version}`),
      })
    }

    if (pluginComponents.errors.length > 0) {
      log("Plugin load errors", { errors: pluginComponents.errors })
    }

    const includeClaudeCommands = claudeConfig?.commands ?? true
    const includeClaudeSkills = claudeConfig?.skills ?? true
    const includeClaudeAgents = claudeConfig?.agents ?? true
    const includeClaudeMcp = claudeConfig?.mcp ?? true
    const includeClaudeInstructions = claudeConfig?.instructions ?? true

    const [
      userCommands,
      projectCommands,
      opencodeGlobalCommands,
      opencodeProjectCommands,
      userSkills,
      projectSkills,
      opencodeGlobalSkills,
      opencodeProjectSkills,
    ] = await Promise.all([
      loadWhenEnabled(
        includeClaudeCommands,
        loadUserCommands,
        {} as Awaited<ReturnType<typeof loadUserCommands>>
      ),
      loadWhenEnabled(
        includeClaudeCommands,
        loadProjectCommands,
        {} as Awaited<ReturnType<typeof loadProjectCommands>>
      ),
      loadOpencodeGlobalCommands(),
      loadOpencodeProjectCommands(),
      loadWhenEnabled(
        includeClaudeSkills,
        loadUserSkills,
        {} as Awaited<ReturnType<typeof loadUserSkills>>
      ),
      loadWhenEnabled(
        includeClaudeSkills,
        loadProjectSkills,
        {} as Awaited<ReturnType<typeof loadProjectSkills>>
      ),
      loadOpencodeGlobalSkills(),
      loadOpencodeProjectSkills(),
    ])

    const userAgents = includeClaudeAgents ? loadUserAgents() : {}
    const projectAgents = includeClaudeAgents ? loadProjectAgents() : {}

    config.agent = {
      ...(config.agent as Record<string, AgentConfig> | undefined),
      ...userAgents,
      ...projectAgents,
      ...pluginComponents.agents,
    }

    const mcpResult = includeClaudeMcp ? await loadMcpConfigs() : { servers: {} }

    const existingMcp = (config.mcp || {}) as Config["mcp"]
    config.mcp = {
      ...existingMcp,
      ...mcpResult.servers,
      ...pluginComponents.mcpServers,
    }

    const systemCommands = (config.command ?? {}) as CommandMap

    config.command = {
      ...systemCommands,
      ...userCommands,
      ...userSkills,
      ...opencodeGlobalCommands,
      ...opencodeGlobalSkills,
      ...projectCommands,
      ...projectSkills,
      ...opencodeProjectCommands,
      ...opencodeProjectSkills,
      ...pluginComponents.commands,
      ...pluginComponents.skills,
    }

    if (includeClaudeInstructions) {
      const configWithInstructions = config as Config & { instructions?: unknown }
      const mergedInstructions = mergeInstructions(
        configWithInstructions.instructions,
        [...getDefaultClaudeInstructions(), ...pluginComponents.instructions]
      )

      configWithInstructions.instructions = mergedInstructions
    }
  }
}
