import { existsSync, readdirSync, realpathSync } from "node:fs"
import { readFile, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join, basename, resolve } from "node:path"
import type { AgentConfig } from "@opencode-ai/sdk"
import { parseFrontmatter } from "../../shared"
import { sanitizeModelField } from "../../shared"
import { isMarkdownFile, resolveSymlink } from "../../shared"
import { log } from "../../shared"
import { parseToolsConfig } from "../../shared"
import { expandEnvVarsInObject } from "../claude-code-mcp-loader"
import { transformMcpServer } from "../claude-code-mcp-loader"
import type { CommandDefinition, CommandFrontmatter } from "../claude-code-command-loader/types"
import type { SkillMetadata } from "../opencode-skill-loader/types"
import type { AgentFrontmatter } from "../claude-code-agent-loader/types"
import type {
  ClaudeCodeMcpConfig,
  McpServerConfig,
} from "../claude-code-mcp-loader/types"
import type {
  InstalledPluginsDatabase,
  PluginInstallation,
  PluginManifest,
  LoadedPlugin,
  PluginLoadResult,
  PluginLoadError,
  PluginScope,
  HooksConfig,
  ClaudeSettings,
  PluginLoaderOptions,
} from "./types"

const CLAUDE_PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}"

interface CachedFileEntry {
  mtimeMs: number
  size: number
  content: string
}

const fileTextCache = new Map<string, CachedFileEntry>()
const fileTextInFlightCache = new Map<string, Promise<string>>()

async function getResolvedCachePath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath)
  } catch {
    return resolve(filePath)
  }
}

async function readTextFileCached(filePath: string): Promise<string> {
  const resolvedPath = await getResolvedCachePath(filePath)
  const inFlight = fileTextInFlightCache.get(resolvedPath)
  if (inFlight) {
    return inFlight
  }

  const readPromise = (async (): Promise<string> => {
    let fileStat: Awaited<ReturnType<typeof stat>>
    try {
      fileStat = await stat(resolvedPath)
    } catch {
      return await readFile(filePath, "utf-8")
    }

    const cached = fileTextCache.get(resolvedPath)
    if (cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
      return cached.content
    }

    let content: string
    try {
      content = await readFile(resolvedPath, "utf-8")
    } catch {
      content = await readFile(filePath, "utf-8")
    }

    fileTextCache.set(resolvedPath, {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      content,
    })

    return content
  })()

  fileTextInFlightCache.set(resolvedPath, readPromise)
  return readPromise.finally(() => {
    fileTextInFlightCache.delete(resolvedPath)
  })
}

function getPluginsBaseDir(): string {
  if (process.env.CLAUDE_PLUGINS_HOME) {
    return process.env.CLAUDE_PLUGINS_HOME
  }
  return join(homedir(), ".claude", "plugins")
}

function getInstalledPluginsPath(): string {
  return join(getPluginsBaseDir(), "installed_plugins.json")
}

function resolvePluginPath(path: string, pluginRoot: string): string {
  return path.replace(CLAUDE_PLUGIN_ROOT_VAR, pluginRoot)
}

function resolvePluginPaths<T>(obj: T, pluginRoot: string): T {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === "string") {
    return resolvePluginPath(obj, pluginRoot) as T
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolvePluginPaths(item, pluginRoot)) as T
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolvePluginPaths(value, pluginRoot)
    }
    return result as T
  }
  return obj
}

async function loadInstalledPlugins(): Promise<InstalledPluginsDatabase | null> {
  const dbPath = getInstalledPluginsPath()
  if (!existsSync(dbPath)) {
    return null
  }

  try {
    const content = await readTextFileCached(dbPath)
    return JSON.parse(content) as InstalledPluginsDatabase
  } catch (error) {
    log("Failed to load installed plugins database", error)
    return null
  }
}

function getClaudeSettingsPath(): string {
  if (process.env.CLAUDE_SETTINGS_PATH) {
    return process.env.CLAUDE_SETTINGS_PATH
  }
  return join(homedir(), ".claude", "settings.json")
}

async function loadClaudeSettings(): Promise<ClaudeSettings | null> {
  const settingsPath = getClaudeSettingsPath()
  if (!existsSync(settingsPath)) {
    return null
  }

  try {
    const content = await readTextFileCached(settingsPath)
    return JSON.parse(content) as ClaudeSettings
  } catch (error) {
    log("Failed to load Claude settings", error)
    return null
  }
}

async function loadPluginManifest(installPath: string): Promise<PluginManifest | null> {
  const manifestPaths = [
    join(installPath, ".claude-plugin", "plugin.json"),
    join(installPath, "plugin.json"),
  ]

  for (const manifestPath of manifestPaths) {
    if (!existsSync(manifestPath)) {
      continue
    }

    try {
      const content = await readTextFileCached(manifestPath)
      return JSON.parse(content) as PluginManifest
    } catch (error) {
      log(`Failed to load plugin manifest from ${manifestPath}`, error)
    }
  }

  return null
}

function derivePluginNameFromKey(pluginKey: string): string {
  const atIndex = pluginKey.indexOf("@")
  if (atIndex > 0) {
    return pluginKey.substring(0, atIndex)
  }
  return pluginKey
}

function isPluginEnabled(
  pluginKey: string,
  settingsEnabledPlugins: Record<string, boolean> | undefined,
  overrideEnabledPlugins: Record<string, boolean> | undefined
): boolean {
  if (overrideEnabledPlugins && pluginKey in overrideEnabledPlugins) {
    return overrideEnabledPlugins[pluginKey]
  }
  if (settingsEnabledPlugins && pluginKey in settingsEnabledPlugins) {
    return settingsEnabledPlugins[pluginKey]
  }
  return true
}

function extractPluginEntries(
  db: InstalledPluginsDatabase
): Array<[string, PluginInstallation | undefined]> {
  if (db.version === 1) {
    return Object.entries(db.plugins).map(([key, installation]) => [key, installation])
  }
  return Object.entries(db.plugins).map(([key, installations]) => [key, installations[0]])
}

export async function discoverInstalledPlugins(
  options?: PluginLoaderOptions
): Promise<PluginLoadResult> {
  const [db, settings] = await Promise.all([loadInstalledPlugins(), loadClaudeSettings()])
  const plugins: LoadedPlugin[] = []
  const errors: PluginLoadError[] = []
  const seenInstallPaths = new Set<string>()
  const loggedDuplicatePaths = new Set<string>()

  if (!db || !db.plugins) {
    return { plugins, errors }
  }

  const settingsEnabledPlugins = settings?.enabledPlugins
  const overrideEnabledPlugins = options?.enabledPluginsOverride

  for (const [pluginKey, installation] of extractPluginEntries(db)) {
    if (!installation) continue

    if (!isPluginEnabled(pluginKey, settingsEnabledPlugins, overrideEnabledPlugins)) {
      log(`Plugin disabled: ${pluginKey}`)
      continue
    }

    const { installPath, scope, version } = installation

    if (!existsSync(installPath)) {
      errors.push({
        pluginKey,
        installPath,
        error: "Plugin installation path does not exist",
      })
      continue
    }

    let dedupeInstallPath = installPath
    try {
      dedupeInstallPath = realpathSync(installPath)
    } catch {
      dedupeInstallPath = installPath
    }

    if (seenInstallPaths.has(dedupeInstallPath)) {
      if (!loggedDuplicatePaths.has(dedupeInstallPath)) {
        loggedDuplicatePaths.add(dedupeInstallPath)
        log(`Skipping duplicate plugin install path: ${dedupeInstallPath}`)
      }
      continue
    }
    seenInstallPaths.add(dedupeInstallPath)

    const manifest = await loadPluginManifest(installPath)
    const pluginName = manifest?.name || derivePluginNameFromKey(pluginKey)

    const loadedPlugin: LoadedPlugin = {
      name: pluginName,
      version: version || manifest?.version || "unknown",
      scope: scope as PluginScope,
      installPath,
      pluginKey,
      manifest: manifest ?? undefined,
    }

    if (existsSync(join(installPath, "commands"))) {
      loadedPlugin.commandsDir = join(installPath, "commands")
    }
    if (existsSync(join(installPath, "agents"))) {
      loadedPlugin.agentsDir = join(installPath, "agents")
    }
    if (existsSync(join(installPath, "skills"))) {
      loadedPlugin.skillsDir = join(installPath, "skills")
    }
    if (existsSync(join(installPath, "instructions"))) {
      loadedPlugin.instructionsDir = join(installPath, "instructions")
    }

    const hooksPath = join(installPath, "hooks", "hooks.json")
    if (existsSync(hooksPath)) {
      loadedPlugin.hooksPath = hooksPath
    }

    const mcpPath = join(installPath, ".mcp.json")
    if (existsSync(mcpPath)) {
      loadedPlugin.mcpPath = mcpPath
    }

    plugins.push(loadedPlugin)
    log(`Discovered plugin: ${pluginName}@${version} (${scope})`, {
      installPath,
      hasManifest: !!manifest,
    })
  }

  return { plugins, errors }
}

export async function loadPluginCommands(
  plugins: LoadedPlugin[]
): Promise<Record<string, CommandDefinition>> {
  const pluginResults = await Promise.all(
    plugins.map(async (plugin) => {
      const pluginCommands: Record<string, CommandDefinition> = {}
      if (!plugin.commandsDir || !existsSync(plugin.commandsDir)) {
        return pluginCommands
      }

      const entries = readdirSync(plugin.commandsDir, { withFileTypes: true })

      await Promise.all(
        entries.map(async (entry) => {
          if (!isMarkdownFile(entry)) return

          const commandPath = join(plugin.commandsDir!, entry.name)
          const commandName = basename(entry.name, ".md")
          const namespacedName = `${plugin.name}:${commandName}`

          try {
            const content = await readTextFileCached(commandPath)
            const { data, body } = parseFrontmatter<CommandFrontmatter>(content)

            const wrappedTemplate = `<command-instruction>
${body.trim()}
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`

            const formattedDescription = `(plugin: ${plugin.name}) ${data.description || ""}`

            const definition = {
              name: namespacedName,
              description: formattedDescription,
              template: wrappedTemplate,
              agent: data.agent,
              model: sanitizeModelField(data.model),
              subtask: data.subtask,
              argumentHint: data["argument-hint"],
            }
            const { name: _name, argumentHint: _argumentHint, ...openCodeCompatible } = definition
            pluginCommands[namespacedName] = openCodeCompatible as CommandDefinition

            log(`Loaded plugin command: ${namespacedName}`, { path: commandPath })
          } catch (error) {
            log(`Failed to load plugin command: ${commandPath}`, error)
          }
        })
      )

      return pluginCommands
    })
  )

  const commands: Record<string, CommandDefinition> = {}
  for (const pluginCommands of pluginResults) {
    Object.assign(commands, pluginCommands)
  }

  return commands
}

export async function loadPluginSkillsAsCommands(
  plugins: LoadedPlugin[]
): Promise<Record<string, CommandDefinition>> {
  const pluginResults = await Promise.all(
    plugins.map(async (plugin) => {
      const pluginSkills: Record<string, CommandDefinition> = {}
      if (!plugin.skillsDir || !existsSync(plugin.skillsDir)) {
        return pluginSkills
      }

      const entries = readdirSync(plugin.skillsDir, { withFileTypes: true })

      await Promise.all(
        entries.map(async (entry) => {
          if (entry.name.startsWith(".")) return

          const skillPath = join(plugin.skillsDir!, entry.name)
          if (!entry.isDirectory() && !entry.isSymbolicLink()) return

          const resolvedPath = resolveSymlink(skillPath)
          const skillMdPath = join(resolvedPath, "SKILL.md")
          if (!existsSync(skillMdPath)) return

          try {
            const content = await readTextFileCached(skillMdPath)
            const { data, body } = parseFrontmatter<SkillMetadata>(content)

            const skillName = data.name || entry.name
            const namespacedName = `${plugin.name}:${skillName}`
            const originalDescription = data.description || ""
            const formattedDescription = `(plugin: ${plugin.name} - Skill) ${originalDescription}`

            const wrappedTemplate = `<skill-instruction>
Base directory for this skill: ${resolvedPath}/
File references (@path) in this skill are relative to this directory.

${body.trim()}
</skill-instruction>

<user-request>
$ARGUMENTS
</user-request>`

            const definition = {
              name: namespacedName,
              description: formattedDescription,
              template: wrappedTemplate,
              model: sanitizeModelField(data.model),
            }
            const { name: _name, ...openCodeCompatible } = definition
            pluginSkills[namespacedName] = openCodeCompatible as CommandDefinition

            log(`Loaded plugin skill: ${namespacedName}`, { path: resolvedPath })
          } catch (error) {
            log(`Failed to load plugin skill: ${skillPath}`, error)
          }
        })
      )

      return pluginSkills
    })
  )

  const skills: Record<string, CommandDefinition> = {}
  for (const pluginSkills of pluginResults) {
    Object.assign(skills, pluginSkills)
  }

  return skills
}

export async function loadPluginAgents(
  plugins: LoadedPlugin[]
): Promise<Record<string, AgentConfig>> {
  const pluginResults = await Promise.all(
    plugins.map(async (plugin) => {
      const pluginAgents: Record<string, AgentConfig> = {}
      if (!plugin.agentsDir || !existsSync(plugin.agentsDir)) {
        return pluginAgents
      }

      const entries = readdirSync(plugin.agentsDir, { withFileTypes: true })

      await Promise.all(
        entries.map(async (entry) => {
          if (!isMarkdownFile(entry)) return

          const agentPath = join(plugin.agentsDir!, entry.name)
          const agentName = basename(entry.name, ".md")

          try {
            const content = await readTextFileCached(agentPath)
            const { data, body } = parseFrontmatter<AgentFrontmatter>(content)

            const customName = data.name || agentName
            const namespacedName = `${plugin.name}:${customName}`
            const originalDescription = data.description || ""
            const formattedDescription = `(plugin: ${plugin.name}) ${originalDescription}`

            const config: AgentConfig = {
              description: formattedDescription,
              mode: "subagent",
              prompt: body.trim(),
            }

            const toolsConfig = parseToolsConfig(data.tools)
            if (toolsConfig) {
              config.tools = toolsConfig
            }

            pluginAgents[namespacedName] = config
            log(`Loaded plugin agent: ${namespacedName}`, { path: agentPath })
          } catch (error) {
            log(`Failed to load plugin agent: ${agentPath}`, error)
          }
        })
      )

      return pluginAgents
    })
  )

  const agents: Record<string, AgentConfig> = {}
  for (const pluginAgents of pluginResults) {
    Object.assign(agents, pluginAgents)
  }

  return agents
}

export async function loadPluginMcpServers(
  plugins: LoadedPlugin[]
): Promise<Record<string, McpServerConfig>> {
  const pluginResults = await Promise.all(
    plugins.map(async (plugin) => {
      const pluginServers: Record<string, McpServerConfig> = {}
      if (!plugin.mcpPath || !existsSync(plugin.mcpPath)) {
        return pluginServers
      }

      try {
        const content = await readTextFileCached(plugin.mcpPath)
        let config = JSON.parse(content) as ClaudeCodeMcpConfig

        config = resolvePluginPaths(config, plugin.installPath)
        config = expandEnvVarsInObject(config)

        if (!config.mcpServers) {
          return pluginServers
        }

        for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
          if (serverConfig.disabled) {
            log(`Skipping disabled MCP server "${name}" from plugin ${plugin.name}`)
            continue
          }

          try {
            const transformed = transformMcpServer(name, serverConfig)
            const namespacedName = `${plugin.name}:${name}`
            pluginServers[namespacedName] = transformed
            log(`Loaded plugin MCP server: ${namespacedName}`, { path: plugin.mcpPath })
          } catch (error) {
            log(`Failed to transform plugin MCP server "${name}"`, error)
          }
        }
      } catch (error) {
        log(`Failed to load plugin MCP config: ${plugin.mcpPath}`, error)
      }

      return pluginServers
    })
  )

  const servers: Record<string, McpServerConfig> = {}
  for (const pluginServers of pluginResults) {
    Object.assign(servers, pluginServers)
  }

  return servers
}

export async function loadPluginHooksConfigs(
  plugins: LoadedPlugin[]
): Promise<HooksConfig[]> {
  const pluginResults = await Promise.all(
    plugins.map(async (plugin) => {
      if (!plugin.hooksPath || !existsSync(plugin.hooksPath)) {
        return null
      }

      try {
        const content = await readTextFileCached(plugin.hooksPath)
        let config = JSON.parse(content) as HooksConfig

        config = resolvePluginPaths(config, plugin.installPath)

        log(`Loaded plugin hooks config from ${plugin.name}`, { path: plugin.hooksPath })
        return config
      } catch (error) {
        log(`Failed to load plugin hooks config: ${plugin.hooksPath}`, error)
        return null
      }
    })
  )

  const configs: HooksConfig[] = []
  for (const config of pluginResults) {
    if (config) {
      configs.push(config)
    }
  }

  return configs
}

export async function loadPluginInstructions(
  plugins: LoadedPlugin[]
): Promise<string[]> {
  const instructions: string[] = []

  for (const plugin of plugins) {
    if (!plugin.instructionsDir || !existsSync(plugin.instructionsDir)) continue

    // Add glob pattern for all markdown files in the plugin's instructions directory
    const instructionPattern = join(plugin.instructionsDir, "**", "*.md")
    instructions.push(instructionPattern)
    log(`Loaded plugin instructions pattern from ${plugin.name}`, { pattern: instructionPattern })
  }

  return instructions
}

export interface PluginComponentsResult {
  commands: Record<string, CommandDefinition>
  skills: Record<string, CommandDefinition>
  agents: Record<string, AgentConfig>
  mcpServers: Record<string, McpServerConfig>
  hooksConfigs: HooksConfig[]
  instructions: string[]
  plugins: LoadedPlugin[]
  errors: PluginLoadError[]
}

export async function loadAllPluginComponents(
  options?: PluginLoaderOptions
): Promise<PluginComponentsResult> {
  const totalStartMs = Date.now()
  const { plugins, errors } = await discoverInstalledPlugins(options)
  const include = {
    commands: options?.include?.commands ?? true,
    skills: options?.include?.skills ?? true,
    agents: options?.include?.agents ?? true,
    mcpServers: options?.include?.mcpServers ?? true,
    hooks: options?.include?.hooks ?? true,
    instructions: options?.include?.instructions ?? true,
  }

  const phaseTimingsMs = {
    commands: 0,
    skills: 0,
    agents: 0,
    hooks: 0,
    mcpServers: 0,
    instructions: 0,
  }

  const loadPhase = async <T>(
    phase: keyof typeof phaseTimingsMs,
    loader: () => Promise<T>
  ): Promise<T> => {
    const startMs = Date.now()
    try {
      return await loader()
    } finally {
      phaseTimingsMs[phase] = Date.now() - startMs
    }
  }

  const [commands, skills, agents, hooksConfigs, mcpServers, instructions] = await Promise.all([
    loadPhase("commands", () =>
      include.commands
        ? loadPluginCommands(plugins)
        : Promise.resolve({} as Record<string, CommandDefinition>)
    ),
    loadPhase("skills", () =>
      include.skills
        ? loadPluginSkillsAsCommands(plugins)
        : Promise.resolve({} as Record<string, CommandDefinition>)
    ),
    loadPhase("agents", () =>
      include.agents ? loadPluginAgents(plugins) : Promise.resolve({} as Record<string, AgentConfig>)
    ),
    loadPhase("hooks", () =>
      include.hooks ? loadPluginHooksConfigs(plugins) : Promise.resolve([] as HooksConfig[])
    ),
    loadPhase("mcpServers", () =>
      include.mcpServers
        ? loadPluginMcpServers(plugins)
        : Promise.resolve({} as Record<string, McpServerConfig>)
    ),
    loadPhase("instructions", () =>
      include.instructions ? loadPluginInstructions(plugins) : Promise.resolve([] as string[])
    ),
  ])

  log(
    `Loaded ${plugins.length} plugins with ${Object.keys(commands).length} commands, ` +
      `${Object.keys(skills).length} skills, ${Object.keys(agents).length} agents, ` +
      `${Object.keys(mcpServers).length} MCP servers, ${instructions.length} instruction patterns`
  )

  log("Plugin component load timings", {
    totalMs: Date.now() - totalStartMs,
    ...phaseTimingsMs,
    pluginCount: plugins.length,
    commandCount: Object.keys(commands).length,
    skillCount: Object.keys(skills).length,
    agentCount: Object.keys(agents).length,
    hookConfigCount: hooksConfigs.length,
    mcpServerCount: Object.keys(mcpServers).length,
    instructionCount: instructions.length,
  })

  return {
    commands,
    skills,
    agents,
    mcpServers,
    hooksConfigs,
    instructions,
    plugins,
    errors,
  }
}
