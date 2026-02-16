import { tool } from "@opencode-ai/plugin"
import { discoverInstalledPlugins } from "../features/claude-code-plugin-loader"

export const listClaudePluginsTool = tool({
  description: "List Claude Code plugins installed in ~/.claude/plugins",
  args: {},
  execute: async () => {
    const result = await discoverInstalledPlugins()
    if (result.plugins.length === 0) {
      return "No Claude Code plugins found."
    }

    const lines = result.plugins.map(
      (plugin) => `${plugin.name}@${plugin.version} (${plugin.scope})`
    )
    return lines.join("\n")
  },
})
