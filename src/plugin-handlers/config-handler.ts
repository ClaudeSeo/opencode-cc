import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
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
import { loadAllPluginComponents, loadPluginMcpServers } from "../features/claude-code-plugin-loader"
import { getClaudeConfigDir, log } from "../shared"
import type { OpencodeCcConfig } from "../plugin-config"

export interface ConfigHandlerDeps {
  ctx: { directory: string; client?: unknown }
  pluginConfig: OpencodeCcConfig
}

type PluginComponents = Awaited<ReturnType<typeof loadAllPluginComponents>>
type CommandMap = Awaited<ReturnType<typeof loadUserCommands>>
type McpServerMap = Awaited<ReturnType<typeof loadPluginMcpServers>>

interface McpSourceCounts {
  system: number
  plugin: number
  merged: number
}

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
    if (isAbsolute(rulesDir) && resolvedRulesDir !== rulesDir) {
      patterns.push(join(resolvedRulesDir, "**", "*.md"))
    }
  } catch {
    // Ignore missing or unreadable rule directories.
  }

  patterns.push(...getSymlinkInstructionPatterns(rulesDir))

  return patterns
}

function getDefaultClaudeInstructions(): string[] {
  const userRulesDirs = [join(getClaudeConfigDir(), "rules"), join(homedir(), ".cursor", "rules")]
  const projectRulesDirs = [join(".claude", "rules"), join(".cursor", "rules")]

  return [
    ...userRulesDirs.flatMap((rulesDir) => getRuleInstructionPatterns(rulesDir)),
    ...projectRulesDirs.flatMap((rulesDir) => getRuleInstructionPatterns(rulesDir)),
  ]
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

function applyMcpOverride(
  servers: McpServerMap,
  override?: Record<string, boolean>
): McpServerMap {
  if (!override) return servers

  const filtered: McpServerMap = { ...servers }
  for (const [serverName, enabled] of Object.entries(override)) {
    if (enabled === false) {
      delete filtered[serverName]
    }
  }

  return filtered
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  const { pluginConfig } = deps
  let lazyMcpWarmupStarted = false
  let lazyMcpWarmupPromise: Promise<void> | undefined
  let lazyMcpMergedServers: McpServerMap | undefined
  let lazyMcpSourceCounts: McpSourceCounts | undefined

  function startLazyMcpWarmup(plugins: PluginComponents["plugins"]) {
    if (lazyMcpWarmupStarted) return
    lazyMcpWarmupStarted = true

    log("Starting lazy MCP warmup", { pluginCount: plugins.length })

    lazyMcpWarmupPromise = (async () => {
      try {
        const [systemMcpResult, pluginMcpServers] = await Promise.all([
          loadMcpConfigs(),
          loadPluginMcpServers(plugins),
        ])

        lazyMcpMergedServers = {
          ...systemMcpResult.servers,
          ...pluginMcpServers,
        }
        lazyMcpSourceCounts = {
          system: Object.keys(systemMcpResult.servers).length,
          plugin: Object.keys(pluginMcpServers).length,
          merged: Object.keys(lazyMcpMergedServers).length,
        }

        log("Lazy MCP warmup completed", lazyMcpSourceCounts)
      } catch (error) {
        log("Lazy MCP warmup failed", error)
      } finally {
        lazyMcpWarmupPromise = undefined
      }
    })()
  }

  return async (config: Config) => {
    const handlerStartMs = Date.now()
    const claudeConfig = pluginConfig.claude_code

    const includeClaudeCommands = claudeConfig?.commands ?? true
    const includeClaudeSkills = claudeConfig?.skills ?? true
    const includeClaudeAgents = claudeConfig?.agents ?? true
    const includeClaudeMcp = claudeConfig?.mcp ?? true
    const includeClaudeHooks = claudeConfig?.hooks ?? true
    const includeClaudeInstructions = claudeConfig?.instructions ?? true
    const mcpMode = claudeConfig?.mcp_mode ?? "eager"

    const pluginComponentsPromise =
      claudeConfig?.plugins ?? true
        ? loadAllPluginComponents({
            enabledPluginsOverride: claudeConfig?.plugins_override,
            include: {
              commands: includeClaudeCommands,
              skills: includeClaudeSkills,
              agents: includeClaudeAgents,
              mcpServers: includeClaudeMcp && mcpMode === "eager",
              hooks: includeClaudeHooks,
              instructions: includeClaudeInstructions,
            },
          })
        : Promise.resolve(EMPTY_PLUGIN_COMPONENTS)

    const parallelLoaderStartMs = Date.now()
    const [
      pluginComponents,
      userCommands,
      projectCommands,
      opencodeGlobalCommands,
      opencodeProjectCommands,
      userSkills,
      projectSkills,
      opencodeGlobalSkills,
      opencodeProjectSkills,
    ] = await Promise.all([
      pluginComponentsPromise,
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
    const parallelLoaderMs = Date.now() - parallelLoaderStartMs

    if (pluginComponents.plugins.length > 0) {
      log(`Loaded ${pluginComponents.plugins.length} Claude Code plugins`, {
        plugins: pluginComponents.plugins.map((p) => `${p.name}@${p.version}`),
      })
    }

    if (pluginComponents.errors.length > 0) {
      log("Plugin load errors", { errors: pluginComponents.errors })
    }

    const agentLoadingStartMs = Date.now()
    const userAgents = includeClaudeAgents ? loadUserAgents() : {}
    const projectAgents = includeClaudeAgents ? loadProjectAgents() : {}
    const agentLoadingMs = Date.now() - agentLoadingStartMs

    let mergeApplyMs = 0
    const mergeAgentStartMs = Date.now()

    config.agent = {
      ...(config.agent as Record<string, AgentConfig> | undefined),
      ...userAgents,
      ...projectAgents,
      ...pluginComponents.agents,
    }
    mergeApplyMs += Date.now() - mergeAgentStartMs

    const mcpLoadingStartMs = Date.now()
    const mcpResult =
      includeClaudeMcp && mcpMode === "eager" ? await loadMcpConfigs() : { servers: {} as McpServerMap }
    const mcpLoadingMs = Date.now() - mcpLoadingStartMs

    if (includeClaudeMcp && mcpMode === "lazy") {
      startLazyMcpWarmup(pluginComponents.plugins)
    }

    const mcpSourceCounts: McpSourceCounts = includeClaudeMcp
      ? mcpMode === "eager"
        ? {
            system: Object.keys(mcpResult.servers).length,
            plugin: Object.keys(pluginComponents.mcpServers).length,
            merged: Object.keys({ ...mcpResult.servers, ...pluginComponents.mcpServers }).length,
          }
        : lazyMcpSourceCounts ?? { system: 0, plugin: 0, merged: 0 }
      : { system: 0, plugin: 0, merged: 0 }

    const lazyMcpServers = mcpMode === "lazy" ? lazyMcpMergedServers ?? ({} as McpServerMap) : ({} as McpServerMap)

    const mergeMcpStartMs = Date.now()
    const existingMcp = (config.mcp || {}) as Config["mcp"]
    const mergedMcpServers: McpServerMap = {
      ...existingMcp,
      ...mcpResult.servers,
      ...pluginComponents.mcpServers,
      ...lazyMcpServers,
    }
    config.mcp = applyMcpOverride(mergedMcpServers, claudeConfig?.mcp_override)
    mergeApplyMs += Date.now() - mergeMcpStartMs

    const mergeCommandStartMs = Date.now()
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
    mergeApplyMs += Date.now() - mergeCommandStartMs

    if (includeClaudeInstructions) {
      const mergeInstructionsStartMs = Date.now()
      const configWithInstructions = config as Config & { instructions?: unknown }
      const mergedInstructions = mergeInstructions(
        configWithInstructions.instructions,
        [...getDefaultClaudeInstructions(), ...pluginComponents.instructions]
      )

      configWithInstructions.instructions = mergedInstructions
      mergeApplyMs += Date.now() - mergeInstructionsStartMs
    }

    const finalMcpServerCount =
      config.mcp && typeof config.mcp === "object" ? Object.keys(config.mcp).length : 0

    log("Config handler timings", {
      totalMs: Date.now() - handlerStartMs,
      parallelLoaderMs,
      agentLoadingMs,
      mcpLoadingMs,
      mergeApplyMs,
      mcpMode,
      mcpWarmupState:
        mcpMode === "lazy"
          ? lazyMcpMergedServers
            ? "ready"
            : lazyMcpWarmupPromise
              ? "warming"
              : lazyMcpWarmupStarted
                ? "pending"
                : "idle"
          : "n/a",
      pluginCount: pluginComponents.plugins.length,
      pluginErrorCount: pluginComponents.errors.length,
      commandCounts: {
        user: Object.keys(userCommands).length,
        project: Object.keys(projectCommands).length,
        opencodeGlobal: Object.keys(opencodeGlobalCommands).length,
        opencodeProject: Object.keys(opencodeProjectCommands).length,
        pluginCommands: Object.keys(pluginComponents.commands).length,
        pluginSkills: Object.keys(pluginComponents.skills).length,
      },
      skillCounts: {
        user: Object.keys(userSkills).length,
        project: Object.keys(projectSkills).length,
        opencodeGlobal: Object.keys(opencodeGlobalSkills).length,
        opencodeProject: Object.keys(opencodeProjectSkills).length,
      },
      agentCount: Object.keys(userAgents).length + Object.keys(projectAgents).length,
      pluginAgentCount: Object.keys(pluginComponents.agents).length,
      mcpServerCount: mcpSourceCounts.system,
      pluginMcpServerCount: mcpSourceCounts.plugin,
      mergedMcpServerCount: mcpSourceCounts.merged,
      finalMcpServerCount,
      instructionCount: includeClaudeInstructions
        ? ((config as Config & { instructions?: unknown }).instructions as unknown[] | undefined)?.length ?? 0
        : 0,
      pluginInstructionCount: pluginComponents.instructions.length,
    })
  }
}
