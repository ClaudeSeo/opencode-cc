import type { PluginInput } from "@opencode-ai/plugin"
import { loadClaudeHooksConfig } from "./config"
import { loadPluginExtendedConfig } from "./config-loader"
import { executePreToolUseHooks, type PreToolUseContext } from "./pre-tool-use"
import {
  executePostToolUseHooks,
  type PostToolUseContext,
  type PostToolUseClient,
} from "./post-tool-use"
import {
  executeUserPromptSubmitHooks,
  type UserPromptSubmitContext,
  type MessagePart,
} from "./user-prompt-submit"
import { executeStopHooks, type StopContext } from "./stop"
import { executePreCompactHooks, type PreCompactContext } from "./pre-compact"
import { cacheToolInput, getToolInput, clearSessionCache } from "./tool-input-cache"
import {
  recordToolUse,
  recordToolResult,
  getTranscriptPath,
  recordUserMessage,
} from "./transcript"
import type { ClaudeHooksConfig, PluginConfig } from "./types"
import type { PluginExtendedConfig } from "./config-loader"
import { log } from "./utils"

const sessionFirstMessageProcessed = new Set<string>()
const sessionErrorState = new Map<string, { hasError: boolean; errorMessage?: string }>()
const sessionInterruptState = new Map<string, { interrupted: boolean }>()

const CONFIG_TTL_MS = 30_000

let cachedHooksConfig: { config: ClaudeHooksConfig | null; loadedAt: number } | null = null
let cachedExtendedConfig: { config: PluginExtendedConfig; loadedAt: number } | null = null

async function getCachedHooksConfig(): Promise<ClaudeHooksConfig | null> {
  if (cachedHooksConfig && Date.now() - cachedHooksConfig.loadedAt < CONFIG_TTL_MS) {
    return cachedHooksConfig.config
  }
  const config = await loadClaudeHooksConfig()
  cachedHooksConfig = { config, loadedAt: Date.now() }
  return config
}

async function getCachedExtendedConfig(): Promise<PluginExtendedConfig> {
  if (cachedExtendedConfig && Date.now() - cachedExtendedConfig.loadedAt < CONFIG_TTL_MS) {
    return cachedExtendedConfig.config
  }
  const config = await loadPluginExtendedConfig()
  cachedExtendedConfig = { config, loadedAt: Date.now() }
  return config
}

function clearConfigCaches(): void {
  cachedHooksConfig = null
  cachedExtendedConfig = null
}

export function createClaudeCodeHooksHook(ctx: PluginInput, config: PluginConfig = {}) {
  return {
    "experimental.session.compacting": async (
      input: { sessionID: string },
      output: { context: string[] }
    ): Promise<void> => {
      if (config.disabledHooks === true) {
        return
      }

      const claudeConfig = await getCachedHooksConfig()
      const extendedConfig = await getCachedExtendedConfig()

      const preCompactCtx: PreCompactContext = {
        sessionId: input.sessionID,
        cwd: ctx.directory,
      }

      const result = await executePreCompactHooks(preCompactCtx, claudeConfig, extendedConfig)

      if (result.context.length > 0) {
        log("PreCompact hooks injecting context", {
          sessionID: input.sessionID,
          contextCount: result.context.length,
          hookName: result.hookName,
          elapsedMs: result.elapsedMs,
        })
        output.context.push(...result.context)
      }
    },

    "chat.message": async (
      input: {
        sessionID: string
        agent?: string
        model?: { providerID: string; modelID: string }
        messageID?: string
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      const interruptState = sessionInterruptState.get(input.sessionID)
      if (interruptState?.interrupted) {
        log("chat.message hook skipped - session interrupted", { sessionID: input.sessionID })
        return
      }

      const claudeConfig = await getCachedHooksConfig()
      const extendedConfig = await getCachedExtendedConfig()

      const textParts = output.parts.filter((p) => p.type === "text" && p.text)
      const prompt = textParts.map((p) => p.text ?? "").join("\n")

      recordUserMessage(input.sessionID, prompt)

      const messageParts: MessagePart[] = textParts.map((p) => ({
        type: p.type as "text",
        text: p.text,
      }))

      const interruptStateBeforeHooks = sessionInterruptState.get(input.sessionID)
      if (interruptStateBeforeHooks?.interrupted) {
        log("chat.message hooks skipped - interrupted during preparation", {
          sessionID: input.sessionID,
        })
        return
      }

      let parentSessionId: string | undefined
      try {
        const sessionInfo = await ctx.client.session.get({
          path: { id: input.sessionID },
        })
        parentSessionId = sessionInfo.data?.parentID
      } catch {
        parentSessionId = undefined
      }

      const isFirstMessage = !sessionFirstMessageProcessed.has(input.sessionID)
      sessionFirstMessageProcessed.add(input.sessionID)

      if (config.disabledHooks !== true) {
        const userPromptCtx: UserPromptSubmitContext = {
          sessionId: input.sessionID,
          parentSessionId,
          prompt,
          parts: messageParts,
          cwd: ctx.directory,
        }

        const result = await executeUserPromptSubmitHooks(
          userPromptCtx,
          claudeConfig,
          extendedConfig
        )

        if (result.block) {
          throw new Error(result.reason ?? "Hook blocked the prompt")
        }

        const interruptStateAfterHooks = sessionInterruptState.get(input.sessionID)
        if (interruptStateAfterHooks?.interrupted) {
          log("chat.message injection skipped - interrupted during hooks", {
            sessionID: input.sessionID,
          })
          return
        }

        if (result.messages.length > 0) {
          const hookContent = result.messages.join("\n\n")
          log("UserPromptSubmit hook messages injected", {
            sessionID: input.sessionID,
            contentLength: hookContent.length,
            isFirstMessage,
          })
        }
      }
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      const claudeConfig = await getCachedHooksConfig()
      const extendedConfig = await getCachedExtendedConfig()

      recordToolUse(input.sessionID, input.tool, output.args as Record<string, unknown>)

      cacheToolInput(input.sessionID, input.tool, input.callID, output.args as Record<string, unknown>)

      if (config.disabledHooks === true) {
        return
      }

      const preCtx: PreToolUseContext = {
        sessionId: input.sessionID,
        toolName: input.tool,
        toolInput: output.args as Record<string, unknown>,
        cwd: ctx.directory,
        toolUseId: input.callID,
      }

      const result = await executePreToolUseHooks(preCtx, claudeConfig, extendedConfig)

      if (result.decision === "deny") {
        throw new Error(result.reason ?? "Hook blocked the operation")
      }

      if (result.modifiedInput) {
        Object.assign(output.args as Record<string, unknown>, result.modifiedInput)
      }
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ): Promise<void> => {
      const claudeConfig = await getCachedHooksConfig()
      const extendedConfig = await getCachedExtendedConfig()

      const cachedInput = getToolInput(input.sessionID, input.tool, input.callID) || {}

      const metadata = output.metadata as Record<string, unknown> | undefined
      const hasMetadata = metadata && typeof metadata === "object" && Object.keys(metadata).length > 0
      const toolOutput = hasMetadata ? metadata : { output: output.output }
      recordToolResult(input.sessionID, input.tool, cachedInput, toolOutput)

      if (config.disabledHooks === true) {
        return
      }

      const postClient: PostToolUseClient = {
        session: {
          messages: (opts) => ctx.client.session.messages(opts),
        },
      }

      const postCtx: PostToolUseContext = {
        sessionId: input.sessionID,
        toolName: input.tool,
        toolInput: cachedInput,
        toolOutput: {
          title: input.tool,
          output: output.output,
          metadata: output.metadata as Record<string, unknown>,
        },
        cwd: ctx.directory,
        transcriptPath: getTranscriptPath(input.sessionID),
        toolUseId: input.callID,
        client: postClient,
        permissionMode: "bypassPermissions",
      }

      const result = await executePostToolUseHooks(postCtx, claudeConfig, extendedConfig)

      if (result.block) {
        throw new Error(result.reason ?? "Hook returned warning")
      }

      if (result.warnings && result.warnings.length > 0) {
        output.output = `${output.output}\n\n${result.warnings.join("\n")}`
      }

      if (result.message) {
        output.output = `${output.output}\n\n${result.message}`
      }
    },

    event: async (input: { event: { type: string; properties?: unknown } }) => {
      const { event } = input

      if (event.type === "session.error") {
        const props = event.properties as Record<string, unknown> | undefined
        const sessionID = props?.sessionID as string | undefined
        if (sessionID) {
          sessionErrorState.set(sessionID, {
            hasError: true,
            errorMessage: String(props?.error ?? "Unknown error"),
          })
        }
        return
      }

      if (event.type === "session.deleted") {
        const props = event.properties as Record<string, unknown> | undefined
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          sessionErrorState.delete(sessionInfo.id)
          sessionInterruptState.delete(sessionInfo.id)
          sessionFirstMessageProcessed.delete(sessionInfo.id)
          clearSessionCache(sessionInfo.id)
        }
        clearConfigCaches()
        return
      }

      if (event.type === "session.idle") {
        const props = event.properties as Record<string, unknown> | undefined
        const sessionID = props?.sessionID as string | undefined

        if (!sessionID) return

        const claudeConfig = await getCachedHooksConfig()
        const extendedConfig = await getCachedExtendedConfig()

        const errorStateBefore = sessionErrorState.get(sessionID)
        const endedWithErrorBefore = errorStateBefore?.hasError === true
        const interruptStateBefore = sessionInterruptState.get(sessionID)
        const interruptedBefore = interruptStateBefore?.interrupted === true

        let parentSessionId: string | undefined
        try {
          const sessionInfo = await ctx.client.session.get({
            path: { id: sessionID },
          })
          parentSessionId = sessionInfo.data?.parentID
        } catch {
          parentSessionId = undefined
        }

        if (config.disabledHooks !== true) {
          const stopCtx: StopContext = {
            sessionId: sessionID,
            parentSessionId,
            cwd: ctx.directory,
          }

          const stopResult = await executeStopHooks(stopCtx, claudeConfig, extendedConfig)

          const errorStateAfter = sessionErrorState.get(sessionID)
          const endedWithErrorAfter = errorStateAfter?.hasError === true
          const interruptStateAfter = sessionInterruptState.get(sessionID)
          const interruptedAfter = interruptStateAfter?.interrupted === true

          const shouldBypass =
            endedWithErrorBefore || endedWithErrorAfter || interruptedBefore || interruptedAfter

          if (shouldBypass && stopResult.block) {
            log("Stop hook block ignored", {
              sessionID,
              block: stopResult.block,
              interrupted: interruptedBefore || interruptedAfter,
              endedWithError: endedWithErrorBefore || endedWithErrorAfter,
            })
          } else if (stopResult.block && stopResult.injectPrompt) {
            log("Stop hook returned block with inject_prompt", { sessionID })
            ctx.client.session
              .prompt({
                path: { id: sessionID },
                body: { parts: [{ type: "text", text: stopResult.injectPrompt }] },
                query: { directory: ctx.directory },
              })
              .catch(() => {})
          } else if (stopResult.block) {
            log("Stop hook returned block", { sessionID, reason: stopResult.reason })
          }
        }

        sessionErrorState.delete(sessionID)
        sessionInterruptState.delete(sessionID)
      }
    },
  }
}
