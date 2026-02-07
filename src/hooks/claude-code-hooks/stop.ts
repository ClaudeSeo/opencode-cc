import type {
  StopInput,
  StopOutput,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, executeHookCommand, log } from "./utils"
import { DEFAULT_CONFIG } from "./plugin-config"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"

export interface StopContext {
  sessionId: string
  parentSessionId?: string
  cwd: string
}

export interface StopResult {
  block: boolean
  reason?: string
  hookName?: string
  elapsedMs?: number
  injectPrompt?: string
}

export async function executeStopHooks(
  ctx: StopContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<StopResult> {
  if (!config) {
    return { block: false }
  }

  const matchers = findMatchingHooks(config, "Stop")
  if (matchers.length === 0) {
    return { block: false }
  }

  const stdinData: StopInput = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: "Stop",
    stop_hook_active: true,
    hook_source: "opencode-plugin",
  }

  const startTime = Date.now()
  let firstHookName: string | undefined

  for (const matcher of matchers) {
    for (const hook of matcher.hooks) {
      if (hook.type !== "command") continue

      if (isHookCommandDisabled("Stop", hook.command, extendedConfig ?? null)) {
        log("Stop hook command skipped (disabled by config)", { command: hook.command })
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
        const output = JSON.parse(result.stdout) as StopOutput
        if (output.decision === "block") {
          return {
            block: true,
            reason: output.reason || result.stderr,
            hookName: firstHookName,
            elapsedMs: Date.now() - startTime,
            injectPrompt: output.inject_prompt,
          }
        }
      } catch {
        if (result.stdout.trim().length > 0) {
          return {
            block: true,
            reason: result.stdout,
            hookName: firstHookName,
            elapsedMs: Date.now() - startTime,
          }
        }
      }
    }
  }

  return { block: false }
}
