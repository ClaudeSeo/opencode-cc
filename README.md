# opencode-cc

Claude Code compatibility plugin for OpenCode. Loads your existing Claude Code MCP servers, hooks, skills, agents, and installed plugins so they work inside OpenCode without reconfiguration.

## Install

1) Clone and build:

```bash
git clone https://github.com/anthropics/opencode-cc.git
cd opencode-cc
bun install
```

2) Add the absolute path to `dist` in your OpenCode config (Bun does not expand `~`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-cc/dist"]
}
```

## Supported Claude Code Compatibility

### MCP Servers

Loads MCP server definitions from three scopes (later scopes override earlier ones):

| Scope | Path |
|-------|------|
| User | `~/.claude/.mcp.json` |
| Project | `.mcp.json` |
| Local | `.claude/.mcp.json` |

A server entry with `"disabled": true` in a later scope removes that server entirely.

### Hooks

Loads hook definitions from Claude Code's `settings.json`. Supported hook events:

- `UserPromptSubmit` -- runs before a user prompt is processed
- `PreToolUse` / `PostToolUse` -- runs before and after tool execution
- `Stop` -- runs when a session becomes idle
- `PreCompact` -- injects context during session compaction

Hooks can block operations, inject messages, or modify tool inputs. Hook configs are cached with a 30-second TTL.

### Instructions

Appends Claude Code rule globs into OpenCode's `instructions` config so Claude-style rule files are loaded without manually listing them:

- `~/.claude/rules/**/*.md`
- `.claude/rules/**/*.md`

The plugin preserves existing `instructions` values and deduplicates entries.

### Skills

Loads Claude Code skills (slash commands defined in Markdown files with optional frontmatter). Searched in order:

1. `~/.claude/skills` (user)
2. `.claude/skills` (project)
3. `~/.config/opencode/skills` (OpenCode global)
4. `.opencode/skills` (OpenCode project)

Each skill directory can contain a `SKILL.md` or `{name}.md` file and an optional `mcp.json` for skill-scoped MCP servers.

### Agents

Loads agent definitions from Markdown files with YAML frontmatter:

- `~/.claude/agents` (user)
- `.claude/agents` (project)

### Claude Code Plugins

Discovers plugins listed in `~/.claude/plugins/installed_plugins.json` and loads their components (commands, skills, agents, MCP servers, hooks). Plugin-provided components are namespaced as `{plugin-name}:{component}`.

### Tools

Provides a `list_claude_plugins` tool that lists all discovered Claude Code plugins and their scopes.

## Plugin Config (optional)

Configuration controls which features are enabled. All features default to `true`.

```json
{
  "claude_code": {
    "plugins": true,
    "plugins_override": {
      "my-plugin@claude-marketplace": true
    },
    "commands": true,
    "skills": true,
    "agents": true,
    "mcp": true,
    "hooks": true,
    "instructions": true
  }
}
```

### Config Loading Order

Configs are merged in order, with later values overriding earlier ones:

1. **Defaults** -- all features enabled
2. **User config** -- `~/.config/opencode/opencode-cc.json`
3. **Project config** -- `.opencode/opencode-cc.json`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `plugins` | `boolean` | `true` | Load installed Claude Code plugins |
| `plugins_override` | `Record<string, boolean>` | `undefined` | Enable/disable specific plugins by name |
| `commands` | `boolean` | `true` | Load Claude Code commands |
| `skills` | `boolean` | `true` | Load Claude Code skills |
| `agents` | `boolean` | `true` | Load Claude Code agents |
| `mcp` | `boolean` | `true` | Load Claude Code MCP server configs |
| `hooks` | `boolean` | `true` | Execute Claude Code hooks |
| `instructions` | `boolean` | `true` | Append `~/.claude/rules/**/*.md` and `.claude/rules/**/*.md` to OpenCode `instructions` |

## Architecture

```
src/
├── index.ts                  # Plugin entry point
├── plugin-config.ts          # Config schema and loader
├── features/                 # Feature loaders
│   ├── claude-code-mcp-loader/
│   ├── claude-code-command-loader/
│   ├── opencode-skill-loader/
│   ├── claude-code-agent-loader/
│   └── claude-code-plugin-loader/
├── hooks/                    # Hook event handlers
│   └── claude-code-hooks/
├── plugin-handlers/          # OpenCode config handler
└── tools/                    # list_claude_plugins tool
```

The plugin registers a `config` handler that merges Claude Code resources into the OpenCode config at startup. It also registers hook handlers (`chat.message`, `tool.execute.before`, `tool.execute.after`, `experimental.session.compacting`, `event`) that delegate to the corresponding Claude Code hook definitions.

Missing files or invalid configs are silently skipped so the plugin never blocks startup.

## Development

```bash
# Install dependencies
bun install

# Type check
bun run typecheck

# Build (compiles TypeScript and prepares dist/)
bun run build
```

The build output goes to `dist/` and is what OpenCode loads as a plugin.

## Notes

- Claude Code plugins are resolved from `~/.claude/plugins/installed_plugins.json` and loaded from their install paths.
- Plugin-provided commands/skills/agents are namespaced as `plugin-name:command`.
- Session transcripts are recorded during hook execution for debugging.
