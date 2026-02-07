import type {
  PostToolUseInput,
  PostToolUseOutput,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, executeHookCommand, objectToSnakeCase, transformToolName, log } from "./utils"
import { DEFAULT_CONFIG } from "./plugin-config"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"

export interface PostToolUseClient {
  session: {
    messages: (opts: { path: { id: string }; query?: { directory: string } }) => Promise<unknown>
  }
}

export interface PostToolUseContext {
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  toolOutput: {
    title?: string
    output?: string
    metadata?: Record<string, unknown>
  }
  cwd: string
  transcriptPath?: string
  toolUseId?: string
  client?: PostToolUseClient
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions"
}

export interface PostToolUseResult {
  block: boolean
  reason?: string
  warnings?: string[]
  message?: string
  hookName?: string
  toolName?: string
  elapsedMs?: number
  additionalContext?: string
}

export async function executePostToolUseHooks(
  ctx: PostToolUseContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<PostToolUseResult> {
  if (!config) {
    return { block: false }
  }

  const transformedToolName = transformToolName(ctx.toolName)
  const matchers = findMatchingHooks(config, "PostToolUse", transformedToolName)
  if (matchers.length === 0) {
    return { block: false }
  }

  const stdinData: PostToolUseInput = {
    session_id: ctx.sessionId,
    transcript_path: ctx.transcriptPath,
    cwd: ctx.cwd,
    permission_mode: ctx.permissionMode ?? "bypassPermissions",
    hook_event_name: "PostToolUse",
    tool_name: transformedToolName,
    tool_input: objectToSnakeCase(ctx.toolInput),
    tool_response: {
      title: ctx.toolOutput.title,
      output: ctx.toolOutput.output,
      metadata: ctx.toolOutput.metadata,
    },
    tool_use_id: ctx.toolUseId,
    hook_source: "opencode-plugin",
  }

  const startTime = Date.now()
  let firstHookName: string | undefined
  const warnings: string[] = []
  let message: string | undefined
  let additionalContext: string | undefined

  for (const matcher of matchers) {
    for (const hook of matcher.hooks) {
      if (hook.type !== "command") continue

      if (isHookCommandDisabled("PostToolUse", hook.command, extendedConfig ?? null)) {
        log("PostToolUse hook command skipped (disabled by config)", {
          command: hook.command,
          toolName: transformedToolName,
        })
        continue
      }

      const hookName = hook.command.split("/").pop() || hook.command
      if (!firstHookName) firstHookName = hookName

      const result = await executeHookCommand(
        hook.command,
        JSON.stringify(stdinData),
        ctx.cwd,
        { forceZsh: DEFAULT_CONFIG.forceZsh, zshPath: DEFAULT_CONFIG.zshPath }
      )

      if (result.exitCode !== 0) {
        try {
          const output = JSON.parse(result.stdout || "{}") as PostToolUseOutput
          if (output.decision === "block") {
            return {
              block: true,
              reason: output.reason || result.stderr,
              hookName: firstHookName,
              toolName: transformedToolName,
              elapsedMs: Date.now() - startTime,
            }
          }
        } catch {
          if (result.stderr) warnings.push(result.stderr)
        }
      }

      if (result.stdout) {
        try {
          const output = JSON.parse(result.stdout) as PostToolUseOutput
          if (output.hookSpecificOutput?.additionalContext) {
            additionalContext = output.hookSpecificOutput.additionalContext
          }

          if (output.systemMessage) {
            message = output.systemMessage
          }
        } catch {
          continue
        }
      }
    }
  }

  return {
    block: false,
    warnings: warnings.length > 0 ? warnings : undefined,
    message,
    hookName: firstHookName,
    toolName: transformedToolName,
    elapsedMs: Date.now() - startTime,
    additionalContext,
  }
}
