# Resource Settings and Liquid Glass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Separate agent resource settings, replace overflowing composer pickers with a shared configuration modal, allow existing-session changes, and adopt native glass with system appearance.

**Architecture:** Keep shared package and MCP registries and per-agent defaults. Build a reusable controlled resource workspace for preferences and conversation drafts, and a session revision API that preserves archived resources and rebuilds idle runtimes. Put desktop materials in AppKit and synchronize both React surfaces with OS appearance.

**Tech Stack:** Bun, Electrobun 1.16, React 19, Radix, Tailwind 4, Objective-C AppKit, Vitest and local real-CLI integration.

**Spec:** docs/specs/2026-11-01-resource-settings-liquid-glass-design.md

## Global Constraints

- UI pt-BR; Bun; no Electron APIs or framework upgrade.
- Skills, Plugins and MCP inside Claude and Codex, each with dedicated discovery.
- Defaults per agent, choices per conversation; external CLI settings unchanged.
- Existing-session changes apply between turns; history/project/model/harness identity preserved.
- Preserve archived Skill/package/MCP revisions and explicit empty selections.
- Preserve project jail, Codex sandbox, Keychain secrets and hook revision authorization.
- Native glass on macOS 26+, native vibrancy fallback; both renderers follow system appearance.
- A single primary scrolling body per configuration page; keyboard/modal focus isolation.

## Review Focus

- A removed registry entry is still selected in an archived conversation: preserve exact snapshot unless explicitly replaced (Task 1).
- Apply races with a new message, switch or deletion: no mixed turn, silent interruption or partial commit (Task 1).
- A canceled selection draft installed a package or connected OAuth: retain library action, discard only selection (Tasks 2–3).
- Many resources and long descriptions in short windows: fixed actions and single scroll, no composer growth (Tasks 2–3).
- Theme changes while hidden, transparent accessibility or repeated native show/resize: coherent readable material and no duplicate layers (Task 4).

---

### Task 1: Editable session resource revisions

**Files:** Modify shared/extension-rpc.ts; bun/extensions/ui-service.ts; bun/claude/session-manager.ts; bun/rpc.ts; bun/skills/workspace.ts; bun/extensions/activation.ts. Create bun/claude/session-resources.ts and session-resources.test.ts as focused preparation/coordination helpers. Extend integration tests.

**Interfaces:** `SessionResourceConfiguration` contains agent, revision, legacy, choices, archived Skill summaries, package summaries and safe MCP summaries. `agentSessionConfiguration({sessionId})` reads it; `agentSessionSetConfiguration({sessionId, expectedRevision, choices})` returns it after validated application. Private snapshots never cross RPC. Session manager owns serialized lifecycle and idle-runtime rebuild.

- [x] Write failing tests for snapshot retention, empty selections, stale revision, busy/reentrant apply, preparation failure and restoration; add integration scenario retaining memory after an edit.
- [x] Run focused tests and record RED.
- [x] Implement shared types and preparation helper, resolve retained IDs from frozen snapshots and new IDs from registries; validate hooks, native restrictions and duplicates.
- [x] Implement lifecycle serialization and explicit busy detection (a waiting Claude stream is not a busy turn), staged snapshot publication/rollback, idle runtime teardown/recreation and safe stale-materialization cleanup.
- [x] Run focused unit tests and local integration for both agents. Expected: new resources next turn, removed resources absent, transcript and cold-resume memory preserved.
- [x] Commit `feat(agents): edit conversation resources between turns`.

### Task 2: Shared resource workspace and scoped preferences

**Files:** Create mainview/settings/agent-resources/{workspace,skills,plugins,mcp,marketplace,use-resource-library}.tsx (split hooks as .ts); modify settings-dialog.tsx, extensions-section.tsx and settings context; update SettingsSection in the three RPC files. Reuse extensions-common and McpEditor.

**Interfaces:** `ResourcePage = "skills" | "plugins" | "mcp"`; `ResourceWorkspace({agent,page,choices,onChange,onLibraryChange,archived?,mode})` is controlled and never implicitly persists choices. Preferences wrapper loads/saves per-agent defaults with `agentExtensionSetDefaults`. Marketplace accepts resource page and uses shared install/source APIs.

- [x] Write failing UI tests for nested Claude/Codex navigation, absence of top-level Extensões, dedicated skill library/marketplace, defaults isolated per agent and shared mixed-package installation.
- [x] Run focused UI tests. Expected: RED on new navigation/workspace.
- [x] Extract focused reusable controls with search, concise rows, expandable details and one scrolling owner. Skills includes local/system/builtin/package Skills; Plugins includes native import, all component types and hook trust; MCP reuses editor/OAuth with explicit activation.
- [x] Scope marketplace views to matching packages/components in existing GitHub catalogs; preserve custom sources and skills.sh external discovery, distinguish unresolved catalog entries from confirmed nonmatching packages.
- [x] Replace central preferences navigation and route old internal extension destinations to the appropriate agent resource page.
- [x] Run preferences/resource UI tests and typecheck. Expected: PASS with per-agent persistence and errors/retry visible.
- [x] Commit `feat(settings): organize Skills plugins and MCP by agent`.

### Task 3: Compact conversation controls in palette and chat

**Files:** Create components/agents/{conversation-configuration,resource-summary}.tsx and shared resource count helpers/tests; modify mainview/components/agent-composer.tsx, mainview/App.tsx, chatview/components/v2/chat-pane.tsx and their tests.

**Interfaces:** `ConversationConfiguration` wraps Task 2 workspace in a controlled modal, edits a cloned `ExtensionChoices`, commits via callback and offers explicit save-defaults. Palette passes draft choices; chat loads/applies Task 1 revision API. Modal visibility contributes to native window sizing.

- [x] Write failing tests: no selected Skill chips, one configuration button, constant summary size with many selections, cancel/apply separation, defaults action explicit, correct counts and archived choices retained.
- [x] Run tests. Expected: RED on new compact controls.
- [x] Replace old picker UI while preserving discovery/review hooks and command suggestions; share loading/error/capability state, block sending invalid selections and allow opening configuration to repair them.
- [x] Add same control to existing chat, refresh commands/summary after apply, block applying during generation and display errors without losing draft.
- [x] Wire modal resize/restore and focus handling; test Escape/Enter cannot submit behind modal and short viewport has one primary scroll region.
- [x] Run composer, chat and resource UI tests. Expected: PASS.
- [x] Commit `feat(chat): configure conversation resources in a shared modal`.

### Task 4: Native glass and live system appearance

**Files:** Create lib/system-appearance.ts and tests; modify both renderer HTML/entry/CSS files, bun/native/overlay.m and bun/index.ts; add native material test harness under test/native where useful.

**Interfaces:** `subscribeSystemAppearance()` installs initial OS color scheme and live listeners on document root and returns cleanup. `configureWindowMaterial(void*, int)` configures a background sibling once, retaining the original Electrobun content-view identity and immediate webview parents and resize behavior; overlay show does not reinstall it.

- [x] Write failing appearance tests for initial light/dark, live change and cleanup; cover repeated native material setup and accessibility fallback in native harness.
- [x] Run focused tests. Expected: RED on missing appearance module/material.
- [x] Implement native NSGlassEffectView on macOS 26 and NSVisualEffectView fallback, transparency, corner geometry, shadow, system appearance/accessibility and idempotent installation.
- [x] Make web surfaces transparent where material should show, use system font and readable system-adaptive tokens, remove hardcoded dark. Preserve code/transcript readability and reduced-motion rules.
- [x] Run appearance tests, build:native, typecheck and build:vite. Expected: PASS.
- [x] Commit `feat(ui): adopt native glass and follow system appearance`.

### Task 5: End-to-end proof, docs and whole-branch review

**Files:** Extend test/e2e-chat and integration scenarios, docs/skills.md, docs/architecture/agent-extension-decisions.md, README.md and README.pt-BR.md as necessary.

**Interfaces:** All previous public interfaces, unchanged external CLI configs and native window lifecycle.

- [x] Extend integration/E2E coverage for create/edit/send/cold-resume, archived selection, failed apply, modal navigation/focus/resize and long inventories.
- [x] Run full tests, lint, typecheck, local integration, native and Vite builds; diagnose real failures before changes. Expected: all gates green.
- [ ] Capture light/dark UI screenshots and inspect real native glass over the desktop, including hotkey show/hide and accessibility behavior; retain evidence paths.
- [x] Update bilingual feature documentation and implementation decisions.
- [x] Commit docs/E2E, obtain a fresh whole-branch review, fix material findings with RED→GREEN verification and run affected gates.
- [x] Deliver branch and visual/test evidence; do not merge or publish without instruction.


Native validation note: the AppKit smoke passed for glass and forced vibrancy and the development bundle started successfully with a registered hotkey. Full native desktop visual inspection is pending: local Mac2 WebDriverAgent startup failed before app launch, and CUA timed out / returned cgWindowNotFound. Chat Chromium screenshots (light/dark, 80 Skills, one scroll region) were inspected and do not replace that desktop proof.

Delivery: draft [PR #33](https://github.com/guichafy/ptolemy/pull/33), with a complete [validation report](../testing/resource-settings-glass-validation.md) and committed web screenshots. Automated implementation/review gates are complete; the native desktop visual acceptance item above remains pending explicitly.

Native CI correction: replacing Electrobun’s content view crashed its resize callback. The regression now models `abstractViews` and direct-parent callbacks; glass/vibrancy are background siblings and the original framework hierarchy stays intact. This regression is enforced in CI.
