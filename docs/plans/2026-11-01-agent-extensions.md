# Agent extensions implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement each task with a task review. Continue through the approved delivery and PR checks without additional handoff approval.

**Goal:** Deliver controllable built-in/imported Skills, extensible GitHub plugin marketplaces, portable plugin components and shared MCP including browser OAuth for Claude/Codex; open a PR to main and verify all Actions gates.

**Architecture:** Preserve the existing Skill snapshot infrastructure. Add a provider-neutral extension library with versioned packages, normalized components and harness adapters. MCP authentication and HTTP forwarding belong to Ptolemy, with only session-scoped local credentials passed to harness processes.

**Tech Stack:** Bun, TypeScript, React 19, shadcn/Radix, existing Claude/Codex SDKs, official MCP TypeScript SDK, macOS Keychain.

**Spec:** `docs/specs/2026-11-01-agent-extensions-design.md` (approved in chat).

## Global Constraints

- UI labels in pt-BR; Bun package manager, Biome formatting, Conventional Commits.
- Preserve `~/.ptolomeu`, `com.ptolomeu.app`, existing Keychain services and legacy sessions.
- Settings apply to Ptolemy conversations/defaults; never modify global CLI installs or configuration.
- Keep conversation workspace isolation, Claude permission gate and Codex workspace-write/read-only sandbox. Never expose danger-full-access.
- No secrets in session JSON, logs, argv, frontend listing responses or package artifacts.
- Preserve package-relative scripts/assets; reject traversal, symlinks, submodules and incomplete downloads.
- No scripts/hooks execute during discovery or download. Hook activation is revision-specific.
- Unsupported components require a concrete capability diagnostic. Do not blanket-exclude hooks/commands/agents or silently pretend prompt instructions are equivalent to agents.
- Maintain all three RPC schemas and bilingual README parity.
- Only mark delivery complete after local checks, integration evidence, independent review and green PR Actions on the latest head.

## Review Focus

- Native/global rediscovery can defeat disabled toggles; tests must inspect effective runtime configuration and actual CLI behavior.
- Package components may reference shared files outside their individual Skill folder; preserve the plugin root and immutable session content.
- MCP secrets can leak through SDK argument serialization; inspect subprocess argv and use environment references/controlled launcher.
- OAuth callbacks/refresh and gateway routes must stay bound to the right server/session; test cross-session attempts and cancellation.
- Hooks must block before effects and remain confined to the workspace; compare equivalent events and assert no outside writes.

## Task 1: Effective native and imported Skill selection

**Files:** `src/shared/skills.ts`, `src/bun/skills/{store,workspace}.ts`, `src/bun/codex/session-runtime.ts`, `src/bun/claude/session-manager.ts`, `src/mainview/components/{skill-picker,agent-composer}.tsx`, their tests.

**Interfaces:** Preserve `SkillsStore.list`, `defaults`, `setDefaults`, `resolveForSession` signatures. Add explicit session selection metadata for native Skill paths and overrides, separate from file bundles; absent metadata preserves old sessions. `buildCodexSkillConfig` produces configuration consumed by the Codex runtime without global writes. Add `origin`/local path metadata only where needed; frontend must distinguish system built-ins and user-installed local Skills.

- [x] Write failing tests for selecting only one local Skill, disabling all, per-agent defaults, old catalog migration, snapshot after native deletion/update, unavailable Skill, name collision, UI toggles/chips and agent switching.
- [x] Run targeted tests and confirm failures describe missing selection behavior.
- [x] Implement complete inventory/selection and snapshot activation. Codex selected native Skills are copied into session workspace and original discovery paths disabled per invocation. Preserve unrelated pre-existing configuration semantics while preventing duplicate discovery of managed selections. Claude only receives selected copies.
- [x] Verify runtime configuration using SDK injection tests and add actual CLI selection scenario to integration fixtures where possible. Keep legacy snapshots readable.
- [x] Run targeted tests, typecheck and Biome; commit `feat(skills): control native skills per conversation`.

## Task 2: GitHub catalog sources and complete package installation

**Files:** new `src/shared/extensions.ts`, `src/bun/extensions/{github,catalog,manifests,store}.ts` and tests; refactor shared GitHub download helpers from `src/bun/skills/github.ts` only if needed.

**Interfaces:** `ExtensionSource { id, name, url, builtin? }`; `ExtensionSummary { id, name, description, sourceId, url, revision, components, diagnostics }`; `ExtensionComponent { id, kind, name, path?, ... }` with kinds skill/mcp/hook/command/agent/other and typed details. `ExtensionsStore` provides `sources()`, `addSource(url)`, `removeSource(id)`, `browse(sourceId)`, `installed()`, `inspect(sourceId,itemId)`, `install(sourceId,itemId)`, `remove(id)`, `getPackage(id)`. Export singleton `extensionsStore`. Package content uses relative path/base64/executable file records, stable origin identity, immutable revision and component diagnostics. Public listing responses never contain credentials.

- [x] Tests first: directory Skill catalogs, Claude marketplace inline skills, local/external GitHub sources including git-subdir/ref/sha, Codex marketplace local sources, portable plugin.json, `.mcp.json` direct/wrapped forms, unsupported source diagnostic, repeated install/update, atomic failure and source removal preserving packages.
- [x] Fail fixtures for traversal, symlink/submodule, nested references, truncated trees, limits and same-name/different-origin packages.
- [x] Implement bounded GitHub provider using proxy-aware fetch and immutable revisions. Default sources: anthropics/skills, anthropics/claude-plugins-official, openai/plugins; support user repository/folder URLs.
- [x] Normalize all component declarations including hooks/commands/agents/apps/LSP/styles. Preserve whole plugin files and explicit manifest paths; unknown components remain visible with specific diagnostics. Limits: manifest 1 MiB, catalog 8 MiB, package 32 MiB / 2048 files / 8 MiB per file; existing individual Skill limits remain unchanged.
- [x] Persist under Ptolemy extensions storage with queued atomic mutations. Do not execute installs. Tests, typecheck, Biome and commit `feat(extensions): add GitHub plugin catalogs and package library`.

## Task 3: Shared MCP registry, secret storage and OAuth

**Files:** new `src/shared/mcp.ts`, `src/bun/mcp/{registry,secrets,oauth}.ts` and tests; compatibility exports in `src/bun/claude/mcp-loader.ts`; package.json/bun.lock.

**Interfaces:** `McpServerDefinition` discriminates stdio (`command,args,env` nonsecret or secret references) and HTTP (`url,headers,auth`), with stable id/name, defaults per agent and optional package identity. `McpRegistry` provides `list()`, `save(server, secrets?)`, `remove(id)`, `setDefaults(agent,ids)`, `snapshot(ids)`, `resolve(snapshot)`; export singleton `mcpRegistry`. `McpOAuthService` provides `connect(serverId)`, `status(serverId)`, `disconnect(serverId)`, `getAccessToken(serverId)`, `cancel(serverId)` and dependency injection for browser opening/fetch/vault. Listing returns connection status and credential-presence only. Persistent snapshots reference secrets by opaque stable key.

- [x] Add direct official MCP SDK dependency using Bun. Tests first for migration of existing version-1 stdio entries, JSON args/env preservation, duplicate ids/names, validation, queued saves and redaction.
- [x] Implement Keychain-backed secret store with injectable memory store for tests. Migrate legacy env values without writing plaintext to new registry. Do not erase old data until new persistence succeeds.
- [x] Implement browser OAuth via official client helpers: metadata discovery, dynamic/pre-registered client, PKCE/state, loopback callback, timeout/cancel, issuer/resource binding, refresh serialization and disconnect/revocation. No secrets in error messages.
- [x] Test using a local HTTP OAuth server (not mocked helper calls): successful code exchange, wrong state, denied/cancelled login, expiry/refresh, concurrent callers, wrong resource and cleanup. HTTP loopback allowed; remote HTTPS required; proxy fetch used.
- [x] Tests, typecheck, Biome and commit `feat(mcp): add shared registry and browser OAuth`.

## Task 4: MCP gateway and harness execution wiring

**Files:** new `src/bun/mcp/{gateway,launcher,runtime}.ts` and tests; `src/bun/claude/{session-options,session-manager}.ts`, `src/bun/codex/session-runtime.ts`, `src/bun/index.ts`, `electrobun.config.ts` as required for bundled launcher.

**Interfaces:** `prepareSessionMcp(sessionId,cwd,snapshot,agent)` returns `{ servers, codexConfig, env, dispose }`; context owns route/process lifetime. `McpGateway` exposes selected server routes with ephemeral authorization and proxies JSON-RPC to validated registry entries. `servers` never contains plaintext external credentials. Session metadata uses `mcpSelection` snapshot; absence means legacy migration behavior, empty means none.

- [x] Tests first for selected-only routing, cross-session denial, unknown route, gateway cleanup, OAuth refresh mid-session, tools/resources/prompts/notifications, disabled inherited MCP and secret-free argv.
- [x] Implement loopback gateway using MCP transport libraries with credential injection at outbound transport, not arbitrary destination forwarding. Support HTTP sessions and cleanup; never log bodies containing tokens.
- [x] Implement packaged stdio launcher for native servers and/or gateway bridging when runtime cannot safely expand env references. Inject only needed environment values; commands and args remain structured. Verify launcher path works in built Electrobun bundle, not only Bun dev.
- [x] Connect Claude strict MCP configuration and Codex per-execution overrides; disable inherited unselected servers through the actual supported configuration shape. Preserve login PATH, proxy and sandbox.
- [x] Add real-CLI offline MCP call scenario for each harness, including selected-none and OAuth gateway. Run integration plus targeted tests, typecheck, Biome and commit `feat(mcp): connect selected servers to both agent runtimes`.

## Task 5: Portable plugin activation, hooks, commands and agents

**Files:** new `src/bun/extensions/{activation,capabilities,hooks,commands,agents}.ts` and tests; shared extension types, session manager/options/runtime, agent event protocol if necessary.

**Interfaces:** `prepareSessionExtensions(sessionId,cwd,selection,agent)` returns selected Skill bundles, MCP definitions, runtime plugin/config options, command definitions and diagnostics; materialized package roots under `.ptolemy/extensions`. `ExtensionSelection { packageId, revision, componentIds, trustedHookDigest? }`. `runExtensionHook` uses typed event/context and restricted executor; capabilities report native/adapted/requires-configuration/incompatible with specific reason. `resolveExtensionCommand` preserves named args/prompt behavior; agent adapter preserves native delegation when supported.

- [x] Tests first for package-relative assets/scripts, immutable resume, plugin disable, selecting one Skill without sibling hooks, collision and unknown metadata diagnostics.
- [x] Inventory CLI-provided built-in Skills/commands as well as installed/enabled global plugins (do not treat every cached plugin as active). Expose actual built-ins with toggle when the runtime supports it; use Claude skillOverrides off for native built-ins where verified. Test an empty complete selection against actual prompts, not merely empty file bundles.
- [x] Probe installed Codex/Claude CLI hook/plugin capabilities against offline mocks. Record evidence and version compatibility; do not infer capability solely from newer docs. Map common events and input/output semantics; unsupported event/handler is explicit.
- [x] Implement native/adapted component activation with namespaced package identities and roots. Preserve command names/args and agent tool/model configuration. Unknown proprietary connector IDs without usable endpoints are diagnosed, not treated as generic MCP.
- [x] Hook execution: explicit trust per definition revision; preserve ordering, matchers, deadlines, context and blocking responses. Apply workspace restrictions to executable handlers; verify a blocked PreToolUse prevents effects and a hook cannot write outside the project. A hook cannot grant broader permissions than Ptolemy's existing gate.
- [x] Test command dynamic expansion and agents in supported runtime, plus exact incompatibilities. Commit after targeted tests/integration, typecheck, Biome: `feat(extensions): activate portable plugin components`.

## Task 6: RPC, extension management UI and session controls

**Files:** all three RPC schemas, settings navigation, new `src/mainview/settings/extensions-*`, MCP form, composer/pickers, chat command UI and tests.

**Interfaces:** typed RPC methods mirror store/catalog/MCP operations, OAuth status/connect/cancel/disconnect and session extension selection. `claudeCreateSession` accepts optional extension/MCP selections; omitted vs empty distinct. Settings section `extensions`. The current API naming remains for compatibility but operations are harness neutral.

- [x] UI tests first for installed/source/catalog views, add/remove source, search, inspection before install, partial component compatibility, install failure/retry, component toggles, hook revision activation and agent-dependent diagnostics.
- [x] Implement Preferences → Extensões with Instaladas/Marketplace/MCP tabs following existing UI. Include skills.sh external discovery link and explain GitHub install flow. Keep palette search plugins separate.
- [x] Implement structured MCP editor with explicit save, transport/auth controls, masked credential presence, connect/cancel/disconnect/status and preservation of invalid drafts. Loading failures must be visible.
- [x] Add composer selection and save-defaults across Skills/plugins/MCP, freeze selections at session creation, show effective counts and unavailable reasons. Add installed command discovery/invocation in composer/chat while preserving Enter/Shift+Enter and existing navigation.
- [x] Test RPC validation and three-schema parity, keyboard/focus behavior, async stale responses and errors. Build renderer and inspect actual UI using browser or screenshot harness. Commit `feat(ui): manage agent extensions and MCP connections`.

## Task 7: End-to-end verification, documentation and PR gates

**Files:** `test/integration`, `test/e2e-chat`, relevant E2E tests, `README.md`, `README.pt-BR.md`, `docs/skills.md`, `AGENTS.md`; workflow changes only to cover real added integration tests.

- [x] Add/complete offline scenarios using actual CLIs and local catalog/MCP/OAuth servers. Prove native disable, package component activation, MCP calls, OAuth login/refresh, hooks before effects, snapshot resume and agent switching. User data untouched via PTOLEMY_HOME and test config dirs.
- [x] Update bilingual docs with actual supported behavior and precise runtime limitations. Update AGENTS architecture for new modules.
- [x] Run `bun run lint:fix`, `bun run typecheck`, `bun run test:coverage`, `bun run build:native`, `bun run build:vite`, `bun run test:integration` and relevant chat/UI E2E. Inspect outputs; do not lower coverage thresholds or disable tests to get green.
- [ ] Whole-branch independent review against approved spec; fix important findings and rerun covering verification.
- [ ] Commit, push branch, open PR to main with implementation/validation/limitations and verify latest-head Actions: Lint, Build & Test, E2E (Appium Mac2), plus any additional required checks. Investigate failures from logs and fix until green.
- [ ] Audit each spec requirement against current code/runtime/tests. Report PR link and verified checks. Leave PR open; do not merge unless separately instructed.
