export type ClaudeCodeMcpServer = {
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  type?: "stdio" | "http" | "sse"
  disabled?: boolean
  headers?: Record<string, string>
}

export type ClaudeCodeMcpConfig = {
  mcpServers?: Record<string, ClaudeCodeMcpServer>
}

export type McpServerConfig =
  | {
      type: "local"
      command: string[]
      environment?: Record<string, string>
      enabled?: boolean
      timeout?: number
    }
  | {
      type: "remote"
      url: string
      enabled?: boolean
      headers?: Record<string, string>
      timeout?: number
    }

export type McpScope = "user" | "project" | "local" | "plugin"

export interface LoadedMcpServer {
  name: string
  scope: McpScope
  config: McpServerConfig
}

export interface McpLoadResult {
  servers: Record<string, McpServerConfig>
  loadedServers: LoadedMcpServer[]
}
