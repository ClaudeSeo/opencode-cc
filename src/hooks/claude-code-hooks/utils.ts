import type { HookMatcher, ClaudeHooksConfig, HookResult } from "./types"
export { transformToolName } from "../../shared/tool-name"

// Intentionally different prefix from shared/logger.ts "[opencode-cc]" — sub-scoped to "[opencode-cc][claude-hooks]"
export function log(message: string, data?: unknown): void {
  if (data) {
    console.log(`[opencode-cc][claude-hooks] ${message}`, data)
    return
  }
  console.log(`[opencode-cc][claude-hooks] ${message}`)
}

const MAX_PATTERN_LENGTH = 200
const BACKTRACKING_RE = /(\+\+|\*\+|\{\d+,\}\+|(\(.*[\+\*].*\))[\+\*])/

function matchPattern(pattern: string, toolName?: string): boolean {
  if (!toolName) return true
  if (pattern === "*" || pattern === "") return true
  if (pattern.toLowerCase() === toolName.toLowerCase()) return true

  if (pattern.length > MAX_PATTERN_LENGTH || BACKTRACKING_RE.test(pattern)) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(escaped, "i").test(toolName)
  }

  try {
    const regex = new RegExp(pattern, "i")
    return regex.test(toolName)
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(escaped, "i").test(toolName)
  }
}

export function findMatchingHooks(
  config: ClaudeHooksConfig,
  event: keyof ClaudeHooksConfig,
  toolName?: string
): HookMatcher[] {
  const matchers = config[event] || []
  if (!toolName) return matchers

  return matchers.filter((matcher) => {
    const pattern = matcher.matcher || "*"
    return matchPattern(pattern, toolName)
  })
}

export function objectToSnakeCase(
  value: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value)) {
    const snakeKey = key
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[-\s]+/g, "_")
      .toLowerCase()
    result[snakeKey] = val
  }
  return result
}

export async function executeHookCommand(
  command: string,
  input: string,
  cwd: string,
  options: { forceZsh: boolean; zshPath: string }
): Promise<HookResult> {
  const shell = options.forceZsh ? options.zshPath : "/bin/sh"

  const proc = Bun.spawn({
    cmd: [shell, "-lc", command],
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  if (proc.stdin) {
    const writer = proc.stdin.getWriter()
    await writer.write(new TextEncoder().encode(input))
    await writer.close()
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return {
    exitCode,
    stdout: stdout || undefined,
    stderr: stderr || undefined,
  }
}
