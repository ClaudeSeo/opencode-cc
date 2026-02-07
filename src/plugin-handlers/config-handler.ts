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
import { log } from "../shared"
import type { OpencodeCcConfig } from "../plugin-config"

export interface ConfigHandlerDeps {
  ctx: { directory: string; client?: unknown }
  pluginConfig: OpencodeCcConfig
}

export function createConfigHandler(deps: ConfigHandlerDeps) {
  const { pluginConfig } = deps

  return async (config: Config) => {
    const claudeConfig = pluginConfig.claude_code

    const pluginComponents = claudeConfig?.plugins ?? true
      ? await loadAllPluginComponents({
          enabledPluginsOverride: claudeConfig?.plugins_override,
        })
      : {
          commands: {},
          skills: {},
          agents: {},
          mcpServers: {},
          hooksConfigs: [],
          plugins: [],
          errors: [],
        }

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
      includeClaudeCommands ? loadUserCommands() : Promise.resolve({}),
      includeClaudeCommands ? loadProjectCommands() : Promise.resolve({}),
      loadOpencodeGlobalCommands(),
      loadOpencodeProjectCommands(),
      includeClaudeSkills ? loadUserSkills() : Promise.resolve({}),
      includeClaudeSkills ? loadProjectSkills() : Promise.resolve({}),
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

    const systemCommands = (config.command as Record<string, unknown>) ?? {}

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
  }
}
