# SyzerCLI

[Türkçe](README.md) · **English**

A terminal AI coding agent for **OpenRouter** and **NVIDIA** models. It reads and edits files, runs commands, spawns parallel subagents and reports back. Built so free models stay usable: a **multi-key pool** with automatic **key and model failover**.

## Why

- **Key pool:** add several OpenRouter/NVIDIA keys; when one hits its limit (402/403/429) the next one takes over.
- **Automatic fallback model:** on server overload (5xx) it retries once, then switches to a backup model.
- **Safe by default:** per-tool permission modes (`ask` / `auto` / `readonly`), allow/deny rules, hooks, git checkpoints and `/undo`.
- **Subagents:** independent tasks run in parallel, with live status rows.
- **Integrations:** MCP client and server, OpenAI-compatible local proxy, local web UI, and a native [Orca](https://github.com/stablyai/orca) integration.

Requirements: Node.js 18+ (not needed for the exe) and at least one OpenRouter (`sk-or-v1-…`) or NVIDIA (`nvapi-…`) API key.

## Install

| Platform | Command |
|---|---|
| Windows | `irm https://raw.githubusercontent.com/yasinbalcik/SyzerCLI/main/install.ps1 \| iex` |
| macOS / Linux | `curl -fsSL https://raw.githubusercontent.com/yasinbalcik/SyzerCLI/main/install.sh \| sh` |
| Any (Node 18+) | `npm install -g github:yasinbalcik/SyzerCLI` |
| Windows exe | download `syzer.exe` from [Releases](https://github.com/yasinbalcik/SyzerCLI/releases/latest) (self-updating). Verify it against `SHA256SUMS.txt` in the same release. |

The exe is not code-signed, so Windows SmartScreen may warn on first launch ("More info" → "Run anyway"). If in doubt, install with npm.

## Quick start

```
syzer key add sk-or-v1-... nvapi-...   # add keys (provider is detected from the format)
syzer usage                            # remaining quota per key
syzer                                  # interactive chat (first run starts a setup wizard)
syzer -y "list the TODOs under src/"   # one-shot, auto-approve (scripts)
syzer -c                               # continue the last session  (or: --resume <id>)
syzer web                              # local web UI
syzer doctor                           # check install, keys, network, Orca patch
syzer export last --out chat.md        # save a session as Markdown
```

In chat, `/help` lists every command. `/plan` produces a read-only plan first, `/go` executes it.

## Main commands

| Command | What it does |
|---|---|
| `syzer provider [openrouter\|nvidia]` | switch provider (each has its own keys, model, effort, fallbacks) |
| `syzer key add/list/use/remove` | manage the key pool |
| `syzer model`, `effort`, `fallback` | default model, thinking effort, backup models |
| `syzer serve --port 8787 --token t` | OpenAI-compatible local proxy backed by your key pool |
| `syzer mcp serve` | expose SyzerCLI as an MCP server (`ask`, `agent`, `usage` tools) |
| `syzer rules`, `allow`, `deny` | permission rules |
| `syzer orca install --shortcut` | Orca integration (Windows) |

Project instructions are read from `SYZER.md` (also `CLAUDE.md` / `AGENTS.md`); skills, commands and agents live in `.syzer/`.

## Orca integration (Windows)

Makes Syzer a first-class agent inside [Orca](https://github.com/stablyai/orca): agent-menu entry, live status and subagent list, session history with Resume, usage in the status bar, a key manager in Settings, and **tab restore after restarting Orca**.

1. Close Orca completely.
2. `syzer orca install --shortcut`
3. Start Orca from the new **Orca (Syzer)** desktop shortcut; it re-checks the patch on every launch.

**Closing Orca also closes its shells.** Orca deliberately keeps terminals alive in a background daemon, so `pwsh`/`claude` processes pile up after you quit. The patch closes every open terminal session when Orca quits normally (window **X** or tray icon → **Quit**). It cannot help if Orca is force-killed from Task Manager. Turn it off with `syzer orca config killShellsOnQuit off`; what it did is logged to `~/.syzercli/orca/quit.log`.

`syzer orca status` shows whether the patch is current and which patch groups were skipped (a group is skipped, never half-applied, if a new Orca version changes the code it targets). `syzer orca restore` goes back to stock Orca. This is a community patch, unaffiliated with the Orca team; tested on Orca 1.4.x.

## More

The Turkish [README](README.md) has the full reference: configuration files, permission rules and hooks, MCP, proxy, subagents, web UI.

## Development

```
npm test          # node:test, no dependencies
npm run build:exe # dist/syzer.exe + tarball
```

Pushing a `v*` tag builds and publishes the release (exe, tarball, `SHA256SUMS.txt`) via GitHub Actions.

License: MIT
