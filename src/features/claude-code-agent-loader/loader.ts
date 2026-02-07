import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, basename } from "node:path"
import type { AgentConfig } from "@opencode-ai/sdk"
import { parseFrontmatter } from "../../shared"
import { isMarkdownFile } from "../../shared"
import { getClaudeConfigDir } from "../../shared"
import { parseToolsConfig } from "../../shared"
import type { AgentScope, AgentFrontmatter, LoadedAgent } from "./types"

function loadAgentsFromDir(agentsDir: string, scope: AgentScope): LoadedAgent[] {
  if (!existsSync(agentsDir)) {
    return []
  }

  const entries = readdirSync(agentsDir, { withFileTypes: true })
  const agents: LoadedAgent[] = []

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue

    const agentPath = join(agentsDir, entry.name)
    const agentName = basename(entry.name, ".md")

    try {
      const content = readFileSync(agentPath, "utf-8")
      const { data, body } = parseFrontmatter<AgentFrontmatter>(content)

      const name = data.name || agentName
      const originalDescription = data.description || ""

      const formattedDescription = `(${scope}) ${originalDescription}`

      const config: AgentConfig = {
        description: formattedDescription,
        mode: "subagent",
        prompt: body.trim(),
      }

      const toolsConfig = parseToolsConfig(data.tools)
      if (toolsConfig) {
        config.tools = toolsConfig
      }

      agents.push({
        name,
        path: agentPath,
        config,
        scope,
      })
    } catch {
      continue
    }
  }

  return agents
}

export function loadUserAgents(): Record<string, AgentConfig> {
  const userAgentsDir = join(getClaudeConfigDir(), "agents")
  const agents = loadAgentsFromDir(userAgentsDir, "user")

  const result: Record<string, AgentConfig> = {}
  for (const agent of agents) {
    result[agent.name] = agent.config as AgentConfig
  }
  return result
}

export function loadProjectAgents(): Record<string, AgentConfig> {
  const projectAgentsDir = join(process.cwd(), ".claude", "agents")
  const agents = loadAgentsFromDir(projectAgentsDir, "project")

  const result: Record<string, AgentConfig> = {}
  for (const agent of agents) {
    result[agent.name] = agent.config as AgentConfig
  }
  return result
}
