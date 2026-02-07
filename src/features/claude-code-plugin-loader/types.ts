export type PluginScope = "user" | "project" | "local" | "managed"

export interface PluginInstallation {
  scope: PluginScope
  installPath: string
  version: string
  installedAt: string
  lastUpdated: string
  gitCommitSha?: string
  isLocal?: boolean
}

export interface InstalledPluginsDatabaseV1 {
  version: 1
  plugins: Record<string, PluginInstallation>
}

export interface InstalledPluginsDatabaseV2 {
  version: 2
  plugins: Record<string, PluginInstallation[]>
}

export type InstalledPluginsDatabase =
  | InstalledPluginsDatabaseV1
  | InstalledPluginsDatabaseV2

export interface PluginAuthor {
  name?: string
  email?: string
  url?: string
}

export interface PluginManifest {
  name: string
  version?: string
  description?: string
  author?: PluginAuthor
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]

  commands?: string | string[]
  agents?: string | string[]
  skills?: string | string[]
  hooks?: string | HooksConfig
  mcpServers?: string | McpServersConfig
  lspServers?: string | LspServersConfig
  outputStyles?: string | string[]
}

export interface HookEntry {
  type: "command" | "prompt" | "agent"
  command?: string
  prompt?: string
  agent?: string
}

export interface HookMatcher {
  matcher?: string
  hooks: HookEntry[]
}

export interface HooksConfig {
  hooks?: {
    PreToolUse?: HookMatcher[]
    PostToolUse?: HookMatcher[]
    PostToolUseFailure?: HookMatcher[]
    PermissionRequest?: HookMatcher[]
    UserPromptSubmit?: HookMatcher[]
    Notification?: HookMatcher[]
    Stop?: HookMatcher[]
    SubagentStart?: HookMatcher[]
    SubagentStop?: HookMatcher[]
    SessionStart?: HookMatcher[]
    SessionEnd?: HookMatcher[]
    PreCompact?: HookMatcher[]
  }
}

export interface PluginMcpServer {
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  type?: "stdio" | "http" | "sse"
  disabled?: boolean
}

export interface McpServersConfig {
  mcpServers?: Record<string, PluginMcpServer>
}

export interface LspServerConfig {
  command: string
  args?: string[]
  extensionToLanguage: Record<string, string>
  transport?: "stdio" | "socket"
  env?: Record<string, string>
  initializationOptions?: Record<string, unknown>
  settings?: Record<string, unknown>
  workspaceFolder?: string
  startupTimeout?: number
  shutdownTimeout?: number
  restartOnCrash?: boolean
  maxRestarts?: number
  loggingConfig?: {
    args?: string[]
    env?: Record<string, string>
  }
}

export interface LspServersConfig {
  [language: string]: LspServerConfig
}

export interface LoadedPlugin {
  name: string
  version: string
  scope: PluginScope
  installPath: string
  manifest?: PluginManifest
  pluginKey: string
  commandsDir?: string
  agentsDir?: string
  skillsDir?: string
  hooksPath?: string
  mcpPath?: string
  lspPath?: string
}

export interface PluginLoadResult {
  plugins: LoadedPlugin[]
  errors: PluginLoadError[]
}

export interface PluginLoadError {
  pluginKey: string
  installPath: string
  error: string
}

export interface ClaudeSettings {
  enabledPlugins?: Record<string, boolean>
  [key: string]: unknown
}

export interface PluginLoaderOptions {
  enabledPluginsOverride?: Record<string, boolean>
}
