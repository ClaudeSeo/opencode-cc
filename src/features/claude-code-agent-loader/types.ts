export type AgentScope = "user" | "project" | "plugin"

export interface AgentFrontmatter extends Record<string, unknown> {
  name?: string
  description?: string
  tools?: string
}

export interface LoadedAgent {
  name: string
  path: string
  config: Record<string, unknown>
  scope: AgentScope
}
