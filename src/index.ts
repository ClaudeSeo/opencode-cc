import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import { createClaudeCodeHooksHook } from "./hooks"
import { loadPluginConfig } from "./plugin-config"
import { createConfigHandler } from "./plugin-handlers/config-handler"
import { listClaudePluginsTool } from "./tools/list-claude-plugins"

const OpencodeCcPlugin: Plugin = async (ctx: PluginInput) => {
  const pluginConfig = loadPluginConfig()
  const claudeCodeHooks = createClaudeCodeHooksHook(ctx, {
    disabledHooks: pluginConfig.claude_code?.hooks === false,
  })

  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
  })

  const hooks: Hooks = {
    tool: {
      list_claude_plugins: listClaudePluginsTool,
    },
    config: configHandler,
    "chat.message": async (input, output) => {
      await claudeCodeHooks["chat.message"]?.(input, output)
    },
    "tool.execute.before": async (input, output) => {
      await claudeCodeHooks["tool.execute.before"]?.(input, output)
    },
    "tool.execute.after": async (input, output) => {
      await claudeCodeHooks["tool.execute.after"]?.(input, output)
    },
    "experimental.session.compacting": async (input, output) => {
      await claudeCodeHooks["experimental.session.compacting"]?.(input, output)
    },
    event: async (input) => {
      await claudeCodeHooks.event?.(input)
    },
  }

  return hooks
}

export default OpencodeCcPlugin

export type { OpencodeCcConfig } from "./plugin-config"
