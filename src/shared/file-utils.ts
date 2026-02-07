import type { Dirent } from "node:fs"
import { lstatSync, realpathSync } from "node:fs"

export function isMarkdownFile(entry: Dirent): boolean {
  return entry.isFile() && entry.name.toLowerCase().endsWith(".md")
}

export function resolveSymlink(path: string): string {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      return realpathSync(path)
    }
  } catch {
    return path
  }
  return path
}
