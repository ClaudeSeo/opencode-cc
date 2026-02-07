import { join, basename } from "node:path"
import { mkdirSync, appendFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import type { TranscriptEntry } from "./types"
import { transformToolName } from "../../shared"
import { getClaudeConfigDir } from "../../shared"

const TRANSCRIPT_DIR = join(getClaudeConfigDir(), "transcripts")

export function getTranscriptPath(sessionId: string): string {
  const sanitizedSessionId = basename(sessionId)
  return join(TRANSCRIPT_DIR, `${sanitizedSessionId}.jsonl`)
}

function ensureTranscriptDir(): void {
  if (!existsSync(TRANSCRIPT_DIR)) {
    mkdirSync(TRANSCRIPT_DIR, { recursive: true })
  }
}

export function appendTranscriptEntry(
  sessionId: string,
  entry: TranscriptEntry
): void {
  ensureTranscriptDir()
  const path = getTranscriptPath(sessionId)
  const line = JSON.stringify(entry) + "\n"
  appendFileSync(path, line)
}

export function recordToolUse(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): void {
  appendTranscriptEntry(sessionId, {
    type: "tool_use",
    timestamp: new Date().toISOString(),
    tool_name: toolName,
    tool_input: toolInput,
  })
}

export function recordToolResult(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  toolOutput: Record<string, unknown>
): void {
  appendTranscriptEntry(sessionId, {
    type: "tool_result",
    timestamp: new Date().toISOString(),
    tool_name: toolName,
    tool_input: toolInput,
    tool_output: toolOutput,
  })
}

export function recordUserMessage(
  sessionId: string,
  content: string
): void {
  appendTranscriptEntry(sessionId, {
    type: "user",
    timestamp: new Date().toISOString(),
    content,
  })
}

export function recordAssistantMessage(
  sessionId: string,
  content: string
): void {
  appendTranscriptEntry(sessionId, {
    type: "assistant",
    timestamp: new Date().toISOString(),
    content,
  })
}

interface OpenCodeMessagePart {
  type: string
  tool?: string
  state?: {
    status?: string
    input?: Record<string, unknown>
  }
}

interface OpenCodeMessage {
  info?: {
    role?: string
  }
  parts?: OpenCodeMessagePart[]
}

interface DisabledTranscriptEntry {
  type: "assistant"
  message: {
    role: "assistant"
    content: Array<{
      type: "tool_use"
      name: string
      input: Record<string, unknown>
    }>
  }
}

export async function buildTranscriptFromSession(
  client: {
    session: {
      messages: (opts: { path: { id: string }; query?: { directory: string } }) => Promise<unknown>
    }
  },
  sessionId: string,
  directory: string,
  currentToolName: string,
  currentToolInput: Record<string, unknown>
): Promise<string | null> {
  try {
    const response = await client.session.messages({
      path: { id: sessionId },
      query: { directory },
    })

    const messages = (response as { "200"?: unknown[]; data?: unknown[] })["200"]
      ?? (response as { data?: unknown[] }).data
      ?? (Array.isArray(response) ? response : [])

    const entries: string[] = []

    if (Array.isArray(messages)) {
      for (const msg of messages as OpenCodeMessage[]) {
        if (msg.info?.role !== "assistant") continue

        for (const part of msg.parts || []) {
          if (part.type !== "tool") continue
          if (part.state?.status !== "completed") continue
          if (!part.state?.input) continue

          const rawToolName = part.tool as string
          const toolName = transformToolName(rawToolName)

          const entry: DisabledTranscriptEntry = {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  name: toolName,
                  input: part.state.input,
                },
              ],
            },
          }
          entries.push(JSON.stringify(entry))
        }
      }
    }

    const currentEntry: DisabledTranscriptEntry = {
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            name: transformToolName(currentToolName),
            input: currentToolInput,
          },
        ],
      },
    }
    entries.push(JSON.stringify(currentEntry))

    const tempPath = join(
      tmpdir(),
      `opencode-cc-transcript-${sessionId}-${randomUUID()}.jsonl`
    )
    writeFileSync(tempPath, entries.join("\n") + "\n")

    return tempPath
  } catch {
    try {
      const currentEntry: DisabledTranscriptEntry = {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: transformToolName(currentToolName),
              input: currentToolInput,
            },
          ],
        },
      }
      const tempPath = join(
        tmpdir(),
        `opencode-cc-transcript-${sessionId}-${randomUUID()}.jsonl`
      )
      writeFileSync(tempPath, JSON.stringify(currentEntry) + "\n")
      return tempPath
    } catch {
      return null
    }
  }
}

export function deleteTempTranscript(path: string | null): void {
  if (!path) return
  try {
    unlinkSync(path)
  } catch {
    return
  }
}
