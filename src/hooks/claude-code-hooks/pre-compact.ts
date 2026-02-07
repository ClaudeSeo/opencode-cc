import type {
  PreCompactInput,
  PreCompactOutput,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, executeHookCommand, log } from "./utils"
import { DEFAULT_CONFIG } from "./plugin-config"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"

export interface PreCompactContext {
  sessionId: string
  cwd: string
}

export interface PreCompactResult {
  context: string[]
  hookName?: string
  elapsedMs?: number
}

export async function executePreCompactHooks(
  ctx: PreCompactContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<PreCompactResult> {
  if (!config) {
    return { context: [] }
  }

  const matchers = findMatchingHooks(config, "PreCompact")
  if (matchers.length === 0) {
    return { context: [] }
  }

  const stdinData: PreCompactInput = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: "PreCompact",
    hook_source: "opencode-plugin",
  }

  const startTime = Date.now()
  let firstHookName: string | undefined
  const context: string[] = []

  for (const matcher of matchers) {
    for (const hook of matcher.hooks) {
      if (hook.type !== "command") continue

      if (isHookCommandDisabled("PreCompact", hook.command, extendedConfig ?? null)) {
        log("PreCompact hook command skipped (disabled by config)", {
          command: hook.command,
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

      if (!result.stdout) continue

      try {
        const output = JSON.parse(result.stdout) as PreCompactOutput
        if (output.context && output.context.length > 0) {
          context.push(...output.context)
        }

        if (output.hookSpecificOutput?.additionalContext) {
          context.push(...output.hookSpecificOutput.additionalContext)
        }
      } catch {
        context.push(result.stdout)
      }
    }
  }

  return {
    context,
    hookName: firstHookName,
    elapsedMs: Date.now() - startTime,
  }
}
