# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor and others) working in this repository. This is the single source of project instructions; there is no `CLAUDE.md`.

## Project overview

**Ptolemy** is a macOS menu bar app: a global command palette (`⌘+Shift+Space`) with a plugin-based search architecture and an embedded agent chat window backed by Claude Code or OpenAI Codex. Built with Electrobun (Bun runtime, not Electron), React 19, Tailwind CSS 4 and Vite. Native Objective-C handles the window overlay, the global hotkey and tray sizing.

The project was called **Ptolomeu** until v0.10.x. See [Naming and data identifiers](#naming-and-data-identifiers) before touching anything that still carries the old name.

## Commands

```bash
bun install                # Install dependencies (also runs `lefthook install` via `prepare`)
bun run dev:hmr            # Recommended dev: Vite (mainview + chatview) + Electrobun, all watching
bun run dev                # Dev without HMR (build once, watch for native/asset changes)
bun run start              # Build native + Vite (both views) + launch
bun run build:native       # Compile Objective-C → liboverlay.dylib (arm64 only)
bun run build:vite         # Build mainview (dist/) + chatview (dist-chat/)
bun run build:dev-bundle   # Full dev .app bundle (required for E2E)
bun run build:canary       # Production build, canary channel
bun run build:release      # Production build, stable channel
```

```bash
bun run test               # Vitest: two projects (node + jsdom), runs both
bun run test:watch         # Vitest in watch mode
bun run test:coverage      # Coverage via @vitest/coverage-v8 (thresholds enforced in vitest.config.ts)
bun run test:e2e           # E2E: Appium Mac2 (requires Xcode + the dev bundle from build:dev-bundle)
bun run test:integration   # Agent integration (bun test, test/integration/): Codex offline via a local Responses API mock; Claude uses the real `claude` CLI and API (skip with PTOLEMY_IT_SKIP_CLAUDE=1)
bun run screenshots        # Build dev bundle + run E2E + regenerate docs/screenshots/
bun run typecheck          # tsc --noEmit
bun run lint               # Biome check
bun run lint:fix           # Biome auto-fix
bun run devtools           # Launch React DevTools standalone (port 8097)
```

```bash
bun run dev:site           # Landing page (Astro, in site/) dev server
bun run build:site         # Build the landing page to site/dist/
```

## Architecture

### Process model

1. **Main process** (`src/bun/index.ts`): runs in Bun. Hides the dock icon (`Utils.setDockIconVisible(false)`) so the app lives in the menu bar only. Owns the system tray, two `BrowserWindow`s (palette + chat), the native FFI bridge, the agent session manager (Claude and Codex) and the proxy-aware fetch layer. The palette window is created hidden and toggled by the global hotkey; the chat window is lazy and created on first open.
2. **Palette renderer** (`src/mainview/`): React command palette. Vite root is `src/mainview/`, output `dist/`, copied to `views/mainview/` per `electrobun.config.ts`.
3. **Chat renderer** (`src/chatview/`): separate React app for the Claude chat surface. Vite config is `vite.chat.config.ts`, root `src/chatview/`, output `dist-chat/`, copied to `views/chatview/`. Both webviews run in the same Bun process with isolated transports.

### Provider system

Plugin-based search in `src/mainview/providers/`. Each plugin implements `SearchProvider` (`id`, `label`, `icon`, `placeholder`, `search`, optional `useSearchContext`, optional `configComponent`). Six built-ins:

- `apps`: macOS application launcher (`scanApps` over `/Applications`, `/System/Applications`, `~/Applications`)
- `github`: repos / code / issues / users with custom filters, qualifier builder and team repos
- `calc`: math expression evaluator
- `web`: Google / DuckDuckGo / Stack Overflow / YouTube
- `claude`: Claude session list + create-new (opens the chat window)
- `codex`: same for Codex sessions; opt-in (not in the default `enabledOrder`)

`claude` and `codex` are thin instances of `createAgentSessionProvider` (`agent-sessions.ts`). Both read the same session list and filter by `SessionMeta.agent`; `App.tsx` treats any id from `agentForProviderId` as an agent plugin (recent sessions on empty query, `claudeSessionsUpdate` push).

Registry in `registry.ts` (`PLUGIN_REGISTRY`, `PLUGIN_META`); the active plugin is managed by `ProviderContextProvider`.

### Settings

`src/mainview/settings/` is a dialog with three sections: **Plugins** (per-plugin enable, with per-plugin config nested as sub-items, e.g. GitHub token, Claude auth and model, MCP servers), **Rede** (proxy mode + manual proxy with a Keychain-backed password) and **Geral** (analytics consent, etc.). State lives in `SettingsContext` with debounced RPC persistence to `~/Library/Application Support/com.ptolomeu.app/settings.json`. Plugin reordering and custom GitHub filters use `@dnd-kit` drag-drop. Main-process IO lives in `src/bun/settings.ts` + `settings-io.ts`.

### State management

Pure React Context, no external state library. Three nested providers: `SettingsProvider` (outermost, persistence) → `ProviderContextProvider` (active plugin) → `GitHubProvider` (GitHub-specific state). Local `useState` in `App.tsx` for query/results/loading. The chat window has its own context tree under `src/chatview/`.

### IPC/RPC

Electrobun's `defineElectrobunRPC` with the typed `PtolemyRPCSchema` in `src/bun/rpc.ts`. Both windows share the same `requestHandlers`, but each gets its **own** `rpc` instance (`mainRpc`, `chatRpc`). Electrobun keeps a single transport per `rpc` object, so a shared instance would silently re-route pushes after the second window opens. Renderer-side RPC for the palette is in `src/mainview/providers/rpc.ts`; for the chat in `src/chatview/rpc.ts`. The schema is duplicated in those two files, so keep all three in sync.

Request handler families (renderer → bun):

- App launcher: `listApps`, `openApp`, `openUrl`, `getAppIcon`
- Window: `resizeWindow`
- Settings: `loadSettings`, `saveSettings`
- GitHub: `githubGetTokenStatus`, `githubSetToken`, `githubDeleteToken`, `githubFetchSearch`, `githubInvalidateCache`
- Agent session (named `claude*` for history, they serve both agents; `claudeCreateSession` takes `agent?: "claude" | "codex"`): `claudeListSessions`, `claudeCreateSession`, `claudeResumeSession`, `claudeSendMessage`, `claudeStopGeneration`, `claudeDeleteSession`, `claudeGetSessionMessages`, `claudeOpenChat`
- Claude auth and models: `claudeGetAuthStatus`, `claudeOpenLogin`, `claudeInstallCli`, `claudeSetBedrock`, `claudeGetBedrock`, `claudeListSupportedModels`, `claudeSetSessionModel`
- Codex auth and models: `codexGetAuthStatus`, `codexOpenLogin`, `codexInstallCli`, `codexListModels`
- Agent HITL and MCP: `agentApproveTool`, `agentRejectTool`, `agentListMcpServers`, `agentSaveMcpServers`
- Proxy: `getProxyStatus`, `reloadProxyFromSystem`, `saveManualProxy`, `clearManualProxy`, `testProxyConnection`
- Analytics: `trackAnalyticsEvent`, `setAnalyticsConsent`

Webview-bound messages (bun → renderer): `openPreferences`, `claudeOpenSession`, `claudeSessionsUpdate`, `windowShown` (palette became visible) and `agentEvent`. `agentEvent` is the typed event channel for the AI Elements chat UI and the only chat stream; text completion and errors ride on it as `finish` / `error` events.

### Native layer

`src/bun/native/overlay.m` is an Objective-C dylib loaded via `bun:ffi`. Exported symbols:

- `makeWindowOverlay(NSWindow*)`: fullscreen overlay with a custom `NSWindowDelegate` that hides instead of closing
- `registerHotkey(NSWindow*)` / `unregisterHotkey()`: global `⌘+Shift+Space` via Carbon `RegisterEventHotKey`; registration failure is surfaced as a disabled tray menu item
- `setWindowShowCallback(JSCallback)`: direct callback when the hotkey transitions the window from hidden to visible (bypasses the unreliable delegate chain so the bun side can refresh the Claude session list)
- `isMainWindowVisible()`: visibility probe used by the show/hide toggle
- `setTrayLength(trayPtr, double)`: sets the menu bar slot width of the Electrobun tray (walks to its `NSStatusItem`)
- `quitApp()`: clean shutdown

Compiled with `clang -dynamiclib -framework AppKit -framework Carbon -fobjc-arc -arch arm64`. Recompile after `.m` changes (`bun run build:native`).

### HMR flow

`bun run dev:hmr` runs three watchers concurrently via `concurrently`:

1. `vite build --watch --mode development` (mainview → `dist/`)
2. `vite build --config vite.chat.config.ts --watch --mode development` (chatview → `dist-chat/`)
3. `electrobun dev --watch`

Build mode (rather than `vite dev`) keeps Electrobun's bundle copy rules working. The dev React DevTools script is injected by the `injectReactDevtools` Vite plugin (loads `http://localhost:8097` in dev); run `bun run devtools` separately to start the standalone DevTools.

### Claude integration (`src/bun/claude/`)

Built on `@anthropic-ai/claude-agent-sdk` using the stable `query()` API. Authentication is delegated to the Claude Code CLI (`claude`), which must be installed; `claude-cli.ts` locates it.

- **Session manager** (`session-manager.ts`): owns the active SDK session, persists messages and exposes `create`/`resume`/`send`/`stop`/`delete`/`list`/`getMessages`. User turns are pushed through a `MessageInbox` (`message-inbox.ts`), an async iterable used as the prompt stream. `query()` is deferred until the chat window resumes the session, so early events do not race the renderer transport. Each conversation gets its own project directory (`persistence/project-store.ts`, under `~/.ptolomeu/projects/<id>/`) that is the agent's `cwd`; workspace isolation is part of the safety model, not just an organizational detail.
- **Session options** (`session-options.ts`): builds the `query()` options (model, permission mode, CLI path, `canUseTool`, MCP servers, `cwd`, resume id).
- **Models** (`models-cache.ts`): discovers and caches the supported models per auth mode; backs the model picker in `src/components/claude/`.
- **Streaming** (`streaming.ts`): pushes typed `AgentEvent`s (mapped by `event-mapper.ts` from raw `SDKMessage`s) to the chat window via `chatRpc`. The renderer consumes this single channel.
- **Chat renderer entrypoint**: `src/chatview/App.tsx` renders `src/chatview/components/v2/chat-pane.tsx` (`ChatPaneV2`). The `v2/` folder name is historical (there is no v1 anymore); new chat UI work goes inside it. The state machine lives in `src/chatview/hooks/agent-state.ts`; the hook that wires it to the `agentEvent` stream is `hooks/use-agent-chat.ts`.
- **agentEvent buffer** (`src/chatview/lib/agent-event-buffer.ts`): the streaming loop can start before the chat window's React tree mounts, and early `text-start`/`text-delta` events would be lost without this buffer, so every new subscriber first drains pending events. Change carefully; it has a dedicated suite in `agent-event-buffer.test.ts`.
- **Permission gate** (`permission-gate.ts`) + **risk classifier** (`risk-classifier.ts`): every `canUseTool` call creates a pending request; the renderer approves/rejects via `agentApproveTool`/`agentRejectTool`. Low-risk tools are auto-whitelisted, there is a per-session whitelist, and decisions are audited via `persistence/tool-decisions.ts`.
- **Workspace jail** (`workspace-jail.ts`): hard pre-check that rejects Write/Edit/NotebookEdit/Bash invocations whose target path escapes the project workspace, *before* the permission gate sees them. `cwd` alone is not sufficient because the SDK accepts absolute paths.
- **MCP loader** (`mcp-loader.ts`): runtime registry of user-declared stdio MCP servers, persisted in `~/.ptolomeu/mcp-servers.json` and editable in **Plugins → Claude → MCP Servers**. Distinct from the repo's `.mcp.json`, which is for agents working on this codebase.
- **Auth** (`auth.ts`): reports CLI status (`not-installed` / `not-authenticated` / `authenticated`), opens the CLI login flow, and stores Bedrock config (endpoint, profile, region) in `~/.ptolomeu/auth/bedrock.json`.

### Codex integration (`src/bun/codex/`)

Built on `@openai/codex-sdk`, which spawns the user's Codex CLI (`codex exec --experimental-json`) and streams JSONL `ThreadEvent`s. Authentication is delegated to the CLI (`codex login`, ChatGPT or API key). Sessions share the Claude store: same `~/.ptolomeu/sessions/index.json` (entries carry `agent: "codex"`; absent means Claude), same `messages.json` format, same per-conversation project directory. The session manager keeps at most one live agent session: `active` (Claude) and `activeCodex` are mutually exclusive.

- **CLI lookup** (`codex-cli.ts`): resolves `codex` and the login-shell `PATH` through `zsh -lc`, because a menu bar app inherits launchd's minimal `PATH` and the npm-installed `codex` is a `node` script. `buildCodexEnv()` is rebuilt per turn from the live `process.env`, so proxy changes apply on the next turn.
- **Session runtime** (`session-runtime.ts`): each turn is a separate CLI run (new thread on the first turn, `resume <threadId>` after). Turns are serialized through a promise chain; `stop()` aborts the running turn. Thread options are rebuilt per turn from settings + session model, which is how model changes and per-turn overrides apply. The thread id is stored in `SessionMeta.sdkSessionId` (empty until `thread.started`).
- **Event mapper** (`event-mapper.ts`) + **runner** (`runner.ts`): translate Codex items into the shared `AgentEvent` protocol (agent message → `text-*`, reasoning → `reasoning-*`, command → `Shell` tool, file change → `ApplyPatch`, MCP call → `mcp__server__tool`, web search → `WebSearch`, to-do list → `TodoWrite`) and accumulate the persisted blocks. Item ids restart at `item_0` on every CLI run, so they are namespaced per turn. Top-level `error` events are transient notices (e.g. "Reconnecting... 2/5"), not terminal; only `turn.completed` / `turn.failed` (or a CLI exit) end a turn. The runner persists before sending `finish`, same invariant as the Claude streaming loop.
- **Safety**: there is no per-tool HITL (the SDK runs `codex exec` with `approvalPolicy: "never"`). Workspace isolation comes from the Codex sandbox: `workingDirectory` is always the conversation's project and the sandbox is `workspace-write` or `read-only`. `danger-full-access` is intentionally not exposed; keep it that way.
- **Models** (`models.ts`): static catalog (the SDK has no listing API). The `"default"` sentinel (`constants.ts`) means "use the CLI's configured model".
- **Settings**: `settings.codex` (`model`, `sandboxMode`, `reasoningEffort`), validated field by field in `src/bun/settings.ts`; edited in **Plugins → Codex** through `updateCodexSettings` in `SettingsContext`.

### Network / proxy (`src/bun/net/`)

`proxy.ts` resolves outbound HTTP routing with five user-selectable modes: `auto` (env → `scutil --proxy` → none), `system` (force `scutil`), `env` (env vars only), `none` (forcibly clear env vars so subprocesses and SDKs also bypass) and `manual` (host/port/auth, password kept in the Keychain under `PROXY_KEYCHAIN_SERVICE`). Bun's `fetch` accepts a `proxy` option but does not honor env vars automatically, so `fetchWithProxy` is the wrapper used throughout. `initProxy` runs at startup *before* any fetch, so PostHog, the GitHub fetcher and the Claude CLI subprocess all inherit the right configuration.

### Analytics

`src/bun/analytics.ts` uses the PostHog Node SDK, gated by `settings.analytics.consentGiven`. The distinct ID is an anonymous UUID stored in settings. The renderer side (`src/mainview/analytics.ts`) uses `posthog-js` with the same consent gate. No PII is collected. `scripts/release_analytics.py` tracks release pipeline events (see `posthog-setup-report.md`).

### UI stack

- shadcn/ui (New York style), components in `src/components/ui/`
- AI Elements primitives in `src/components/ai-elements/` (Conversation, Message, PromptInput, Reasoning, Sources, Artifact, CodeBlock, Confirmation, Attachments) power the chat surface entirely
- Radix UI primitives (Dialog, Popover, ScrollArea, Select, Separator, Slot, Switch, Tooltip, Collapsible)
- cmdk for the command palette
- Tailwind CSS 4 with **CSS-first** config in `src/mainview/index.css` and `src/chatview/index.css` (`@import "tailwindcss" source(...)`, `@theme inline`, `@custom-variant dark`); there is no `tailwind.config.js`
- `src/lib/utils.ts` exports `cn()` (clsx + tailwind-merge)
- lucide-react for icons
- @dnd-kit for drag-drop (plugin reordering, custom GitHub filters)
- react-markdown + remark-gfm + react-syntax-highlighter render the assistant's markdown. Primitives live in `src/chatview/components/markdown/` (`content.tsx` + `code-block.tsx`) and are consumed by `ChatPaneV2` via `components/v2/message-parts.tsx`

### Release and distribution

semantic-release (`.releaserc.json`) runs on `main`: it bumps versions via `scripts/sync-versions.ts`, builds the stable bundle, zips it as `ptolemy-<version>-macos-arm64.zip` and publishes a GitHub Release. `.github/workflows/release.yml` then mirrors the zip to GitHub Pages (`scripts/build-pages-mirror.ts`, which also writes `latest.json`) and triggers a rebuild of the landing page in `site/` (Astro, deployed by `.github/workflows/site.yml` to `https://guichafy.github.io/ptolemy/`). Releases up to v0.10.x were published as `ptolomeu-*.zip`; the mirror script recognizes both prefixes.

The Pages path is never hardcoded in CI: `site/astro.config.mjs` sets `base` from `GITHUB_REPOSITORY`, the site reads URLs from `import.meta.env.SITE`/`BASE_URL`, and `build-pages-mirror.ts` derives the same base (override with `PAGES_BASE`). Every site deploy runs `build-pages-mirror.ts --latest-only`, so `latest.json` always points at the current path; renaming the repo only requires a redeploy (`gh workflow run site.yml`). The fallback `/ptolemy` in those files matters only for local builds.

### Key config files

- `electrobun.config.ts`: app name (`ptolemy`) and identity (`com.ptolomeu.app`), `exitOnLastWindowClosed: false`, copy rules (`dist/` → `views/mainview/`, `dist-chat/` → `views/chatview/`, dylib + tray icon → `native/`), icon set `ptolemy.iconset`
- `vite.config.ts`: root `src/mainview/`, output `dist/`, manual chunks (vendor-react, vendor-radix, vendor-dnd, vendor-cmdk, vendor-posthog), DevTools injection in dev
- `vite.chat.config.ts`: root `src/chatview/`, output `dist-chat/`, port `5174`, separate vendor chunks for syntax-highlighter and markdown
- `vitest.config.ts`: two projects (`node` for `src/bun/**` + chatview lib/hooks; `jsdom` for mainview + chatview components + `src/lib`), coverage thresholds enforced
- `vitest.config.e2e.ts`: Appium Mac2 driver
- `components.json`: shadcn/ui config with the `@/` path alias resolving to `src/`
- `lefthook.yml`: pre-commit hook running Biome on staged JS/TS/JSON and `vitest --changed` on staged sources
- `biome.json`: linter/formatter config
- `tsconfig.json`: `@/*` → `src/*` path alias
- `.mcp.json`: MCP servers for agents working on this repo (not used by the app at runtime)
- `llms.txt`: Electrobun quick reference; Electrobun is **not** Electron, do not use Electron APIs or patterns

## Naming and data identifiers

The product name is **Ptolemy** everywhere a person reads it (UI, window titles, docs, site, package, release artifacts, User-Agent) and in code identifiers (`PtolemyRPCSchema`, temp file prefixes).

These identifiers intentionally keep the old **ptolomeu** spelling because existing installs store data under them. Renaming any of them silently orphans user settings, sessions or Keychain secrets, so do not change them without shipping a migration:

| Identifier | Where | Holds |
|------------|-------|-------|
| `com.ptolomeu.app` | `electrobun.config.ts`, `src/bun/settings.ts`, `test/e2e/helpers/constants.ts` | Bundle id and `~/Library/Application Support/com.ptolomeu.app/settings.json` |
| `com.ptolomeu.app.github.pat` | `src/bun/github-token.ts` | GitHub token (Keychain service) |
| `com.ptolomeu.app.proxy` | `src/bun/net/proxy.ts` | Manual proxy password (Keychain service) |
| `"ptolomeu"` (account fallback) | `src/bun/github-token.ts` | Keychain account when `$USER` is unset |
| `~/.ptolomeu/` | `src/bun/claude/*` | Sessions (Claude and Codex), projects, tool decisions, auth, `mcp-servers.json` |
| `~/.ptolomeu_install_id` | `scripts/release_analytics.py` | Anonymous install id for release analytics |

`CHANGELOG.md` and the dated files under `docs/` are historical records and keep the old name.

## Conventions

- UI labels are in Portuguese (pt-BR): "Abrir", "Sair", "Buscar", etc.
- Package manager is Bun (`bun install`, `bun run`, `bunx`). Do not introduce npm/yarn/pnpm scripts.
- Path alias `@/*` maps to `src/*` (configured in tsconfig and components.json).
- Linter/formatter is Biome: run `bun run lint:fix` before committing (lefthook also runs it on staged files).
- Commit messages follow Conventional Commits, `type(scope): description`; semantic-release uses them to generate `CHANGELOG.md` and pick the next version.
- Skip lefthook once with `LEFTHOOK=0 git commit ...` if needed; do not commit with hooks bypassed by default.
- Workspace isolation is a security boundary, not a hint. When adding tools to the Claude integration, make sure paths stay inside the conversation's project directory. For Codex, never widen the sandbox beyond the project directory.
- The settings schema tolerates unknown keys in the `claude` block: the validator in `src/bun/settings.ts` reads only known fields and re-serializes without extras. Retiring a setting is safe; users on older `settings.json` files won't hit validation errors, and their obsolete keys drop on the next save.
- Keep `README.md` and `README.pt-BR.md` in sync: same sections, same facts, one per language.
