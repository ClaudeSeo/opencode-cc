import { promises as fs } from "node:fs"
import { join } from "node:path"

const rootDir = new URL("..", import.meta.url).pathname
const rootPackagePath = join(rootDir, "package.json")
const distDir = join(rootDir, "dist")
const distPackagePath = join(distDir, "package.json")

async function main() {
  const rootPackageRaw = await fs.readFile(rootPackagePath, "utf-8")
  const rootPackage = JSON.parse(rootPackageRaw)

function stripDistPrefix(value) {
  if (typeof value !== "string") return value
  return value.replace(/^dist\//, "").replace(/^\.\/dist\//, "./")
}

function rewriteExports(exportsField) {
  if (!exportsField || typeof exportsField !== "object") return exportsField
  if (Array.isArray(exportsField)) return exportsField

  const rewritten = {}
  for (const [key, entry] of Object.entries(exportsField)) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const mapped = {}
      for (const [subKey, subValue] of Object.entries(entry)) {
        mapped[subKey] = stripDistPrefix(subValue)
      }
      rewritten[key] = mapped
    } else {
      rewritten[key] = stripDistPrefix(entry)
    }
  }
  return rewritten
}

const distPackage = {
  name: rootPackage.name,
  version: rootPackage.version,
  description: rootPackage.description,
  type: rootPackage.type,
  main: stripDistPrefix(rootPackage.main),
  types: stripDistPrefix(rootPackage.types),
  exports: rewriteExports(rootPackage.exports),
  dependencies: rootPackage.dependencies,
}

  await fs.mkdir(distDir, { recursive: true })
  await fs.writeFile(distPackagePath, JSON.stringify(distPackage, null, 2) + "\n")
}

main().catch((error) => {
  console.error("Failed to prepare dist package.json", error)
  process.exitCode = 1
})
