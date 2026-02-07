export type SkillScope =
  | "user"
  | "project"
  | "opencode"
  | "opencode-project"
  | "plugin"

export interface SkillMetadata extends Record<string, unknown> {
  name?: string
  description?: string
  license?: string
  compatibility?: string
  metadata?: Record<string, unknown>
  model?: string
  agent?: string
  subtask?: boolean
  "argument-hint"?: string
  "allowed-tools"?: string
}

export interface LazyContentLoader {
  loaded: boolean
  content?: string
  load: () => Promise<string>
}

export interface LoadedSkill {
  name: string
  path: string
  resolvedPath: string
  definition: CommandDefinition
  scope: SkillScope
  license?: string
  compatibility?: string
  metadata?: Record<string, unknown>
  allowedTools?: string[]
  mcpConfig?: SkillMcpConfig
  lazyContent: LazyContentLoader
}

export type OpenCodeCommandEntry = Omit<CommandDefinition, "name" | "argumentHint">

export type SkillMcpConfig = Record<
  string,
  {
    command?: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
    url?: string
    type?: "stdio" | "http" | "sse"
    disabled?: boolean
    headers?: Record<string, string>
  }
>

export interface CommandDefinition {
  name: string
  description?: string
  template: string
  agent?: string
  model?: string
  subtask?: boolean
  argumentHint?: string
}
