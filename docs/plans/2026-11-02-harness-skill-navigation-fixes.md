# Harness isolation and Skill navigation corrections

User confirmed: reuse one portable Skill/package library; keep activation, drafts and saved defaults isolated by harness. Preserve external CLI installations and frozen conversation snapshots.

Observed: the screenshot's Skills come from Codex/.agents roots, not Claude; generic origin labels hide that distinction. useResourceLibrary exposes the previous harness inventory while a new request loads. Marketplace details have scrolling navigation, no installed state and no uninstall action. Portable manual Skill imports have no removal API.

Implementation:

1. Add failing regressions for inventory visibility during harness switches, foreign native Skills, independent defaults, origin labels, catalog detail/back navigation and install/uninstall state.
2. Hide stale harness data immediately and reset harness-owned UI state. Show precise local/system/shared origins. Shared imports remain reusable; no CLI folders/configs are rewritten.
3. Provide a shared detail view with persistent Back and actions, return focus/scroll to the listing, explicit installed status and shared-library uninstall confirmation. Native Skills explain CLI ownership and provide activation controls. Add removal for Ptolemy-managed manual imports only; preserve conversation snapshots and the other harness's unrelated defaults.
4. Verify focused RED→GREEN, full units, lint/types/build and affected integration/UI flows. Update the existing draft PR and inspect CI. A fresh scoped review may be used under the code-review skill; no implementer delegation is needed.

No additional design approval requested: these corrections are authorized by the user's review and clarify the approved shared-library/per-harness activation model.

Additional reported runtime error: Codex failed before the first turn with `invalid transport in mcp_servers.codex_app`. `mcp list` can report derived stdio/HTTP servers absent from config.toml. Disabled name-only overrides create transport-less tables. Keep the inventory's transport kind and generate valid inert disabled transports, retaining quoted names and reserved selected aliases. Regression uses the real CLI, with a derived metadata-only entry injected into inventory, while actual exec and MCP calls are unchanged. RED observed at /tmp/ptolemy-codex-derived-mcp-red.log; GREEN at /tmp/ptolemy-codex-derived-mcp-green.log. Real user inventory also parsed with all inherited servers disabled under deny-network/deny-write policy, without model calls or global edits.
