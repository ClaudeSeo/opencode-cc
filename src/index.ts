import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin"
import { createClaudeCodeHooksHook } from "./hooks"
import { loadPluginConfig } from "./plugin-config"
import { createConfigHandler } from "./plugin-handlers/config-handler"
import { listClaudePluginsTool } from "./tools/list-claude-plugins"

function forwardTwoArgHook<TInput, TOutput>(
  handler?: (input: TInput, output: TOutput) => Promise<void>
) {
  return async (input: TInput, output: TOutput) => {
    await handler?.(input, output)
  }
}

function forwardOneArgHook<TInput>(handler?: (input: TInput) => Promise<void>) {
  return async (input: TInput) => {
    await handler?.(input)
  }
}

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
    "chat.message": forwardTwoArgHook(claudeCodeHooks["chat.message"]),
    "tool.execute.before": forwardTwoArgHook(claudeCodeHooks["tool.execute.before"]),
    "tool.execute.after": forwardTwoArgHook(claudeCodeHooks["tool.execute.after"]),
    "experimental.session.compacting": forwardTwoArgHook(
      claudeCodeHooks["experimental.session.compacting"]
    ),
    event: forwardOneArgHook(claudeCodeHooks.event),
  }

  return hooks
}

export default OpencodeCcPlugin

export type { OpencodeCcConfig } from "./plugin-config"
