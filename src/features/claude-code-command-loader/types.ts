export interface CommandFrontmatter extends Record<string, unknown> {
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
  "argument-hint"?: string
  handoffs?: string[]
}

export interface CommandDefinition {
  name: string
  description?: string
  template: string
  agent?: string
  model?: string
  subtask?: boolean
  argumentHint?: string
  handoffs?: string[]
}

export type OpenCodeCommandEntry = Omit<CommandDefinition, "name" | "argumentHint">

export type CommandScope = "user" | "project" | "opencode" | "opencode-project" | "plugin"

export interface LoadedCommand {
  name: string
  path: string
  definition: CommandDefinition
  scope: CommandScope
}
