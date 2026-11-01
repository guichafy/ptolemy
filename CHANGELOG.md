# [0.13.0](https://github.com/guichafy/ptolemy/compare/v0.12.0...v0.13.0) (2026-11-01)


### Bug Fixes

* **chat:** show the model once, in the composer's picker ([3ab991c](https://github.com/guichafy/ptolemy/commit/3ab991c967e33e74f599b070041d4367c92c07b3))


### Features

* **chat:** context details, conversation cost and compactions ([8490314](https://github.com/guichafy/ptolemy/commit/84903144fb054eb8ecf4fa426e5040457e0bc596))
* **chat:** rebuild the agent chat on AI Elements with model and context info ([623a20d](https://github.com/guichafy/ptolemy/commit/623a20d2cebc45f7d670ed021836ce1b69fff156))

# [0.12.0](https://github.com/guichafy/ptolemy/compare/v0.11.0...v0.12.0) (2026-11-01)


### Features

* **codex:** add OpenAI Codex as a second chat agent ([c12fed4](https://github.com/guichafy/ptolemy/commit/c12fed43ecdefacd9dd7c745ebff8c6b2dd0c13b))

# [0.11.0](https://github.com/guichafy/ptolemy/compare/v0.10.4...v0.11.0) (2026-11-01)


### Features

* **site:** reposition landing for any Mac user, not only developers ([95a41d5](https://github.com/guichafy/ptolemy/commit/95a41d5b11dbb95ccae9c731aee7ce2238f72369))

## [0.10.4](https://github.com/guichafy/ptolemy/compare/v0.10.3...v0.10.4) (2026-10-31)


### Bug Fixes

* **pages:** follow the renamed repository path on GitHub Pages ([8b29894](https://github.com/guichafy/ptolemy/commit/8b29894aec3e19683657292d11c391327c3c72fa)), closes [#pages](https://github.com/guichafy/ptolemy/issues/pages) [#pages](https://github.com/guichafy/ptolemy/issues/pages)

## [0.10.3](https://github.com/guichafy/ptolomeu/compare/v0.10.2...v0.10.3) (2026-05-12)


### Bug Fixes

* **palette:** harden ⌘⇧Space show/hide against WebKit edge cases ([742b1b1](https://github.com/guichafy/ptolomeu/commit/742b1b1bc6c598bab8517b971c6344ea4979c030))

## [0.10.2](https://github.com/guichafy/ptolomeu/compare/v0.10.1...v0.10.2) (2026-04-26)


### Bug Fixes

* apply PR [#23](https://github.com/guichafy/ptolomeu/issues/23) review follow-ups ([e95a03c](https://github.com/guichafy/ptolomeu/commit/e95a03c40ae0fbd2937e7f28a8bbc0b875719240))
* **core:** harden session safety and persistence ([b76eec2](https://github.com/guichafy/ptolomeu/commit/b76eec2c01e0d05a81377cf64566b1105e0a221f))
* **native:** clean up hotkey lifecycle ([678b2b0](https://github.com/guichafy/ptolomeu/commit/678b2b069c09b65af2fe2631cd3fa74edb242121))

## [0.10.1](https://github.com/guichafy/ptolomeu/compare/v0.10.0...v0.10.1) (2026-04-25)


### Bug Fixes

* **ci:** install Node 22 in site workflow ([9721beb](https://github.com/guichafy/ptolomeu/commit/9721beb79b643aff13befd745d8de45b99f56478))

# [0.10.0](https://github.com/guichafy/ptolomeu/compare/v0.9.0...v0.10.0) (2026-04-25)


### Bug Fixes

* **icons:** strip residual halo from new icon background ([5d57bf7](https://github.com/guichafy/ptolomeu/commit/5d57bf76b7cfbfe0f5a1955c65d4f5417df4c62f))


### Features

* **site:** add Astro landing page and rebrand app icon ([7558828](https://github.com/guichafy/ptolomeu/commit/75588283668ea4845a87afe6c9bb5d37c54fb0ca)), closes [#pages](https://github.com/guichafy/ptolomeu/issues/pages) [#f97316](https://github.com/guichafy/ptolomeu/issues/f97316) [#pages-publish](https://github.com/guichafy/ptolomeu/issues/pages-publish)

# [0.9.0](https://github.com/guichafy/ptolomeu/compare/v0.8.0...v0.9.0) (2026-04-25)


### Bug Fixes

* **claude:** capture SDK session id from first message in streaming loop ([11e0705](https://github.com/guichafy/ptolomeu/commit/11e0705c59042c2a248f0f48e1cb7b5c0ea69665))
* **claude:** clarify session options JSDoc and lock omit-when-absent contract ([161d897](https://github.com/guichafy/ptolomeu/commit/161d897a3bc92fd55e19a7efca4dd1e44aba7f51))
* **claude:** close prior session resources and snapshot active in sendMessage ([93a9e5f](https://github.com/guichafy/ptolomeu/commit/93a9e5fef1702058957025da8ec11c64b8c71d17))
* **claude:** dedup thinking blocks across stream deltas and assistant chunks ([f3f3405](https://github.com/guichafy/ptolomeu/commit/f3f340552a59615c0b89c99370fb2a09b49716da))
* **claude:** drain restore callbacks on stopGeneration; tighten resume + toolbar guards ([4183593](https://github.com/guichafy/ptolomeu/commit/4183593f2c1e08eb86fbb6932edc69001d9bdd4e))
* **claude:** guard models-cache against stale invalidations and authMode drift ([6375967](https://github.com/guichafy/ptolomeu/commit/63759677573e3e37e0412c3a467490e6a246ea44))
* **claude:** inbox iterator return() does not seal shared state ([65ece53](https://github.com/guichafy/ptolomeu/commit/65ece53810ea0484bf2142f30adf2595d9ebf6b5))
* **claude:** isolate onTurnComplete hook errors and document streaming hooks ([6ffa740](https://github.com/guichafy/ptolomeu/commit/6ffa7406eb0398d9d9feb17451172d3628815ef4))
* **claude:** latch sdkSessionId flag before firing hook ([d27691d](https://github.com/guichafy/ptolomeu/commit/d27691d5d15a40cc1958da93c2460b4719a3b515))
* **rpc:** full models-cache flush on auth changes and broadcast-id sentinel ([7a7503e](https://github.com/guichafy/ptolomeu/commit/7a7503ebe7c528de269f1ee942046689f4240b49))
* **rpc:** sync ClaudeAuthStatus mirror types with backend cliStatus shape ([e1a40a0](https://github.com/guichafy/ptolomeu/commit/e1a40a09a8566acf8b67ab770b638a04d01f0fa7))
* **rpc:** use relative import for value import to satisfy Bun bundler ([0a353ef](https://github.com/guichafy/ptolomeu/commit/0a353ef5a3ab227407d70ea81c0e9e5949c7a56e))
* **settings:** clear pendingMessage on action click and test install error path ([81d5494](https://github.com/guichafy/ptolomeu/commit/81d5494f23feb48daa25f0ca38a4010d0aacb752))


### Features

* **chat:** per-turn model override in prompt toolbar ([6760471](https://github.com/guichafy/ptolomeu/commit/67604714a796a055574cd8f5c604737f9a1212af))
* **chat:** persist and surface per-turn model override on user messages ([4b38b4f](https://github.com/guichafy/ptolomeu/commit/4b38b4f10eaa552bb826845eaf559b6005d97b6c))
* **chat:** session-level model picker in ChatHeader ([258b55f](https://github.com/guichafy/ptolomeu/commit/258b55fb20006ae5d1c172623dea7080254d8772))
* **claude/auth:** add Claude CLI and Keychain detection helpers ([2cf6c68](https://github.com/guichafy/ptolomeu/commit/2cf6c685225c7d36e500b1bb30fd73b0f95edf2d))
* **claude/auth:** delegate install and login to Terminal via osascript ([549f33f](https://github.com/guichafy/ptolomeu/commit/549f33f62abaf864d6f1fe90e5cfbb278d869093))
* **claude:** add push-able message inbox helper for stable query() ([ca90154](https://github.com/guichafy/ptolomeu/commit/ca9015484c3b75feb01828e7c1616f4e73337afc))
* **claude:** models cache with single-flight discovery via stable query() ([f7aa67e](https://github.com/guichafy/ptolomeu/commit/f7aa67e6691f84316c5790df5cc74612418b7855))
* enhance PaletteContent for improved window resizing and loading state management ([c9f185f](https://github.com/guichafy/ptolomeu/commit/c9f185f842e5600a87b5a1df2f855bc66e1597f7))
* **mainview:** subscribe settings to models-cache-invalidated events ([6a32bdb](https://github.com/guichafy/ptolomeu/commit/6a32bdb4a9cd1e24d0b7f6afe2a70ff19012a136))
* **rpc:** expose model selector RPCs and cache invalidation events ([5887057](https://github.com/guichafy/ptolomeu/commit/5887057f18a5bed0f20eed3f948402da3820b6c3))
* **rpc:** rename claudeLoginSSO to claudeOpenLogin and add claudeInstallCli ([77872bc](https://github.com/guichafy/ptolomeu/commit/77872bc4023242283d62cc58a1cec5d540539521))
* **settings:** drive Claude model dropdown from SDK-supplied list ([95d4c36](https://github.com/guichafy/ptolomeu/commit/95d4c369d7db229b5c43889bd8c49ff563d84ff8))
* **settings:** poll Claude auth status after action and refresh on dialog open ([d9b9aa4](https://github.com/guichafy/ptolomeu/commit/d9b9aa4a7eaac3f2b40a90c3f54515756672f266))
* **settings:** show three-state Claude auth panel driven by CLI status ([8dc8860](https://github.com/guichafy/ptolomeu/commit/8dc8860e9a81b5acb0ab4be952f14030acf5c3c6))
* **tray:** rebrand icons and tighten menu bar slot ([a4cea65](https://github.com/guichafy/ptolomeu/commit/a4cea65a8bbb7dcd9b563f8b6db1e84340750df3))
* **ui:** ModelPicker wrapper around ai-elements/model-selector ([d9bff8e](https://github.com/guichafy/ptolomeu/commit/d9bff8ee753944a802f3ae9615bfe1ed6a177157))
* update UI components for improved styling and accessibility ([dd7aa91](https://github.com/guichafy/ptolomeu/commit/dd7aa9184b2260edc37a6743f67c5e77be024c8b))

# [0.8.0](https://github.com/guichafy/ptolomeu/compare/v0.7.0...v0.8.0) (2026-04-24)


### Bug Fixes

* **claude-agent:** defer streaming loop until chat window is ready ([876cb3b](https://github.com/guichafy/ptolomeu/commit/876cb3b91f1048edb9dee746470e872aec204295))
* **claude-agent:** let MarkdownContent inherit text color from the bubble ([78b2a71](https://github.com/guichafy/ptolomeu/commit/78b2a7145c70016524d81a3cb234ae2a852ea339))
* **claude-agent:** stop auto-allowing write tools so the workspace jail actually runs ([f093fe3](https://github.com/guichafy/ptolomeu/commit/f093fe3041c3400deb8eeff3f0ca6f77b65d094e))


### Features

* **claude-agent:** isolate each conversation in its own project directory ([0cdde1c](https://github.com/guichafy/ptolomeu/commit/0cdde1ca2c27304f313b8cf964b7a464f1a331ef))
* **claude-agent:** render assistant text as Markdown with GFM tables ([cffefaf](https://github.com/guichafy/ptolomeu/commit/cffefafbb37afb281f28d6b1cb122f7b96693f91))

# [0.7.0](https://github.com/guichafy/ptolomeu/compare/v0.6.0...v0.7.0) (2026-04-24)


### Features

* **claude-agent:** add AI Elements chat UI behind useAiElements flag ([943cebb](https://github.com/guichafy/ptolomeu/commit/943cebb0506a3023b4c718770b0fa2b5e4e9ad5d))
* **claude-agent:** add Artifact / CodeBlock / Sources AI Elements + use them in ToolBlock ([7dcc79b](https://github.com/guichafy/ptolomeu/commit/7dcc79b0cf7b46a55894be44587051bac235a765))
* **claude-agent:** add PermissionGate for HITL tool approval ([2ed333e](https://github.com/guichafy/ptolomeu/commit/2ed333e912f6acb8eb3c0244c1bed601204eeed1))
* **claude-agent:** add risk classifier, session whitelist, audit log ([7d7316b](https://github.com/guichafy/ptolomeu/commit/7d7316bb4d2415ebf8f2849db1f3de824236f947))
* **claude-agent:** add RPC protocol and integration plan ([2c257aa](https://github.com/guichafy/ptolomeu/commit/2c257aa25aecf2a42d3a01c08b78a6199aeb6a3a))
* **claude-agent:** Attachments primitive + image picker + plan mode banner ([b530963](https://github.com/guichafy/ptolomeu/commit/b5309634df304bc1e9b8df5b6ce547e90020f782))
* **claude-agent:** extract pure event mapper SDKMessage → AgentEvent ([f8f01f7](https://github.com/guichafy/ptolomeu/commit/f8f01f7950bdd7e0c35067c2170c10a4e87caf27))
* **claude-agent:** fix V2 chat rendering + add turn indicator ([483cda2](https://github.com/guichafy/ptolomeu/commit/483cda20a21af04225b6f7a29e0c3b6cd924a135))
* **claude-agent:** render ConfirmationQueue and wire real approve/reject RPCs ([a5b4d64](https://github.com/guichafy/ptolomeu/commit/a5b4d6425974eb525e8e47d871a203416f4fe67c))
* **claude-agent:** runtime MCP server registry + settings UI ([29ac33c](https://github.com/guichafy/ptolomeu/commit/29ac33c9a6a1501c795ec42b66e4ac85819a4948))
* **claude-agent:** wire canUseTool into session-manager + approve/reject RPC ([95c1a2b](https://github.com/guichafy/ptolomeu/commit/95c1a2b35b8f061c596934cdf7165236ca634877))
* **claude-agent:** wire typed agentEvent RPC channel and useAgentChat ([0f189ae](https://github.com/guichafy/ptolomeu/commit/0f189aefd1568e4b3ee98e75ae3bc429b1c092a0))
* **settings:** expand settings dialog size and support width resize ([bb74e11](https://github.com/guichafy/ptolomeu/commit/bb74e1138f108a7ea04e6a2fa1fc213a8062f247))

# [0.6.0](https://github.com/guichafy/ptolomeu/compare/v0.5.0...v0.6.0) (2026-04-24)


### Features

* **devtools:** integrate react-devtools standalone and upgrade to React 19 ([1ec89b0](https://github.com/guichafy/ptolomeu/commit/1ec89b0b0ccfcb97a6eeef0d43fde4844e796388))


### Performance Improvements

* **build:** split vendor chunks and lazy-load syntax highlighter ([a4e84cf](https://github.com/guichafy/ptolomeu/commit/a4e84cfba45e97cc0e70cc7c97b9d2923a640f9b))

# [0.5.0](https://github.com/guichafy/ptolomeu/compare/v0.4.0...v0.5.0) (2026-04-15)


### Bug Fixes

* **apps:** cache app list and filter synchronously to stop result flicker ([e8c1c7d](https://github.com/guichafy/ptolomeu/commit/e8c1c7d258673231e6840b047898b93b3b573f74))


### Features

* **net:** add manual proxy mode with Keychain-backed credentials ([72a7407](https://github.com/guichafy/ptolomeu/commit/72a74077bb238af34d01b5846882e48a08f4d1d3))

# [0.4.0](https://github.com/guichafy/ptolomeu/compare/v0.3.1...v0.4.0) (2026-04-15)


### Bug Fixes

* **github:** hide stale results when query no longer matches last search ([e4972ae](https://github.com/guichafy/ptolomeu/commit/e4972aee4dadffe9e7d80b66ae99115fc3c9ad08))


### Features

* **net:** add proxy mode configuration UI in preferences ([07c6eb9](https://github.com/guichafy/ptolomeu/commit/07c6eb91dcd21d21083211c6f8e201ffcdb5af6d))

## [0.3.1](https://github.com/guichafy/ptolomeu/compare/v0.3.0...v0.3.1) (2026-04-15)


### Bug Fixes

* **net:** honor system proxy configuration for outbound fetch ([318724e](https://github.com/guichafy/ptolomeu/commit/318724ed7aea337f64868918cbc35ce396fd6f90))

# [0.3.0](https://github.com/guichafy/ptolomeu/compare/v0.2.0...v0.3.0) (2026-04-14)


### Bug Fixes

* **chat:** instrument claude session flow and resolve multi-session bugs ([542ec82](https://github.com/guichafy/ptolomeu/commit/542ec82e6e7acaea8dc54c4a7f8f811772840b21))
* **chat:** persist structured blocks, unify tool display, fix multi-turn streaming ([a4d8d02](https://github.com/guichafy/ptolomeu/commit/a4d8d02dd1327bd4763385714510917ca8f5145e))
* **claude:** split rpc per window and push session list from bun ([b7dda6a](https://github.com/guichafy/ptolomeu/commit/b7dda6a7e26ddad6d17a55832d40d64937f156bf))
* **dev:** replace Vite dev server with build --watch to fix blank screen on first launch ([8f1a195](https://github.com/guichafy/ptolomeu/commit/8f1a1950a18fd00c7ee96ab8856ff426c5e63fd1))
* **settings:** add frontend-design plugin to enabled plugins ([fe29478](https://github.com/guichafy/ptolomeu/commit/fe29478ffbcf569f17d4695c1fc03eecc38a9251))
* **ui:** fix Tailwind v4 source detection and refine settings design ([4537794](https://github.com/guichafy/ptolomeu/commit/4537794703ed7cd9d8ac1d806ce59de5ab62484e))
* **ui:** scroll acompanhar seleção ao navegar resultados com setas ([06d1672](https://github.com/guichafy/ptolomeu/commit/06d16724aeb93cfccb9e08350bc69ac72b0eb6bc))
* **ui:** use native titlebar for chat window dragging and close ([682ff45](https://github.com/guichafy/ptolomeu/commit/682ff45c05753321498303817cb701382d62b7e2))


### Features

* **analytics:** integrate PostHog for anonymous usage analytics ([8a9610f](https://github.com/guichafy/ptolomeu/commit/8a9610f902aae7ed60a6611a9f4b81917370174d))
* **chat:** load message history and resume SDK session from URL params ([10eb3c3](https://github.com/guichafy/ptolomeu/commit/10eb3c3c3af12e501e586edde75828894fbac9e0))
* **claude:** add Claude chat integration with streaming, auth, and dedicated chat window ([c18710f](https://github.com/guichafy/ptolomeu/commit/c18710f162e3adb942aa4b8c03f565e3679c5fff))
* **claude:** add SDK dependency and register claude plugin ([163212a](https://github.com/guichafy/ptolomeu/commit/163212a0acf528fe9a34b1cc0bb04d5a99edf8ed))

# [0.2.0](https://github.com/guichafy/ptolomeu/compare/v0.1.0...v0.2.0) (2026-04-12)


### Features

* **icons:** use ptolomeu.icns as official app and tray icon ([5e6a0e2](https://github.com/guichafy/ptolomeu/commit/5e6a0e2436552e3661d06a1b2ab277372534251b))
* **ui:** migrate Tailwind CSS v3 to v4 with CSS-first config ([4a9a384](https://github.com/guichafy/ptolomeu/commit/4a9a384faaa99d2a443ad61028af4d245fde0a4c))

# [0.1.0](https://github.com/guichafy/ptolomeu/compare/v0.0.1...v0.1.0) (2026-04-12)


### Bug Fixes

* **github:** expand window when combobox popover opens to prevent clipping ([3f16fd3](https://github.com/guichafy/ptolomeu/commit/3f16fd3e0549fb18090aa910c648145e251a09f6))
* **github:** raise RPC timeout to 30s and log search lifecycle ([7454cd6](https://github.com/guichafy/ptolomeu/commit/7454cd6e009864e43769af69849f43ebf9fe6107))
* **github:** re-run search on Enter when query changed since last results ([32fe9ea](https://github.com/guichafy/ptolomeu/commit/32fe9ea94b86b5c45384ca503ded256331ef17d8))
* import defineConfig from vitest/config for type safety ([bcb708c](https://github.com/guichafy/ptolomeu/commit/bcb708c39f4056d7198cfcc300ad8c0ac75cc735))
* **macos:** install Edit menu to enable Cmd+A/C/V/X/Z in inputs ([53d0e39](https://github.com/guichafy/ptolomeu/commit/53d0e39e3c37dc5d393a67818d00b1d5bb08b670)), closes [#6](https://github.com/guichafy/ptolomeu/issues/6)
* **providers:** drop generic from SearchProvider to fix registry variance ([f3775cf](https://github.com/guichafy/ptolomeu/commit/f3775cf787424992a8d2a60402ded41d36673e6f))
* **settings:** use GitBranch icon instead of missing Github ([17d75d5](https://github.com/guichafy/ptolomeu/commit/17d75d574d4feef7a16c8b0d844f1147554c3cb2))
* **test:** cast fetch mock through unknown for strict typecheck ([6f79a7b](https://github.com/guichafy/ptolomeu/commit/6f79a7bee654aa0711072835cb14acc0d95f439e))
* **ui:** keep window centered when resizing by using setFrame instead of setSize ([5bf05c4](https://github.com/guichafy/ptolomeu/commit/5bf05c4c69e216cecb88388084aa5cd9069c6987))
* **ui:** move search type combobox outside input and add Lucide icons ([edba904](https://github.com/guichafy/ptolomeu/commit/edba90441e9f2e558f96eb9132efc87e5d27d00e))
* **ui:** prevent search results flickering by keeping previous results visible during loading ([8b3377b](https://github.com/guichafy/ptolomeu/commit/8b3377b6f3eed4eee128daf6d71337666e5e8659))


### Features

* add preferences dialog to configure active plugins ([f5339e5](https://github.com/guichafy/ptolomeu/commit/f5339e5d61fab5e24f8f0606496f705bf2ba1b09))
* **app:** wire GitHubProvider and pass subType into search ([6260db8](https://github.com/guichafy/ptolomeu/commit/6260db82e8d2f3b87fb24c5aa6407b5aa205cea8))
* **bun:** add github fetch handler with subType routing ([2f527c5](https://github.com/guichafy/ptolomeu/commit/2f527c556e7e6df9190ba324e97a434cd478bbc0))
* **bun:** add github token storage via macos keychain ([e9daaf2](https://github.com/guichafy/ptolomeu/commit/e9daaf2766c54fe43af320e9769ec423d5b1356d))
* **bun:** add team-repos cache with 5min TTL and pagination ([db29739](https://github.com/guichafy/ptolomeu/commit/db297391d947bdd97aca7a4c734aef67d232256e))
* **github:** add api wrapper using githubFetchSearch rpc ([ed2e042](https://github.com/guichafy/ptolomeu/commit/ed2e04210bf02ca73f89ef0baaf942586ec25163))
* **github:** add react context for subType, filters and token status ([375e6d9](https://github.com/guichafy/ptolomeu/commit/375e6d9297123c91712996295ef6ec88edd1864b))
* **github:** add renderers mapping GitHubItem to SearchResult ([664472d](https://github.com/guichafy/ptolomeu/commit/664472d972e67cf7eaaf41f8b0506ac488335f1e))
* **github:** add search type combobox component ([8375e17](https://github.com/guichafy/ptolomeu/commit/8375e179e0385e482e38fa95736b7b3dfaa47bac))
* **github:** add visual query builder for custom search filters ([965df3b](https://github.com/guichafy/ptolomeu/commit/965df3b6d43a48217e3bea75492f59ca63c03f70))
* **github:** wire combobox and cmd+1..4/cmd+f shortcuts into palette ([0baf0e8](https://github.com/guichafy/ptolomeu/commit/0baf0e85046d6389495ed8b32386a19ce763d1f4))
* **rpc:** add openUrl RPC and use native open instead of window.open ([3a4da4f](https://github.com/guichafy/ptolomeu/commit/3a4da4f5f56640abf5efc46c0ac707dc40025cdf))
* **rpc:** expose github token + fetch handlers on main process ([ef665b1](https://github.com/guichafy/ptolomeu/commit/ef665b1eaf6ff6869a06b9bef72057bfa9a455ce))
* **rpc:** mirror github rpc schema and types in renderer ([b87f77e](https://github.com/guichafy/ptolomeu/commit/b87f77e75898950d8a05b8aa4ca126f6cd233746))
* **search-input:** accept optional leftSlot for inline widgets ([f37aafc](https://github.com/guichafy/ptolomeu/commit/f37aafc10f6452ac5752d5be6941604bc29a345e))
* **settings:** add custom filters list with create/edit/reorder ([7b583a3](https://github.com/guichafy/ptolomeu/commit/7b583a33e04c3a029e3fd16b6aee698df181a873))
* **settings:** add custom filters state and section-aware openDialog ([422a7f5](https://github.com/guichafy/ptolomeu/commit/422a7f53b6100a297f8d7598a46c03e368822088))
* **settings:** add github schema with custom filters validation ([8f39594](https://github.com/guichafy/ptolomeu/commit/8f39594735c781dc4dec270d85a645a0d2d9c4f8))
* **settings:** add github tab and section-aware dialog ([a545de8](https://github.com/guichafy/ptolomeu/commit/a545de8fa1c97a98333c560384c45e3cd8066552))
* **settings:** add token field with keychain validation flow ([0670de7](https://github.com/guichafy/ptolomeu/commit/0670de7fec04c47b77100d101920dfbc63aea405))
* **settings:** move plugin config to hierarchical sidebar with per-provider configComponent ([2445ec3](https://github.com/guichafy/ptolomeu/commit/2445ec351fb941334ae6798ce6c7944b2d1a6c86))
* **ui:** make mode bar tabs clickable to switch providers ([942e424](https://github.com/guichafy/ptolomeu/commit/942e424d91e0650478228cdd33f8d55dadd98ef9))

# 0.0.1 (2026-04-11)


### Bug Fixes

* correct Github icon and type issues in providers ([86f6599](https://github.com/guichafy/ptolomeu/commit/86f65993dadea22fa05e7e5b37600580550688e3))
* instantiate Electroview to establish RPC WebSocket connection ([54d5a45](https://github.com/guichafy/ptolomeu/commit/54d5a45d45fdc6809add971dfd5df46c725289b4))
* prevent double Enter handler and improve keyboard navigation ([cbe897b](https://github.com/guichafy/ptolomeu/commit/cbe897b6367631bbb9a533de36fe1149e048b414))


### Features

* add apps provider with RPC-based macOS app search ([6433922](https://github.com/guichafy/ptolomeu/commit/643392256dbddb3b0852d014c7c0d6bc6b21e93f))
* add automated release workflow and PR validation ([bb56f44](https://github.com/guichafy/ptolomeu/commit/bb56f448d2708c934b9e7d9d916ac86c5f26e273))
* add calculator provider with safe math parser ([035e6a6](https://github.com/guichafy/ptolomeu/commit/035e6a67cc2edb1265d44d1cf063d0698ddfd581))
* add CI pipeline with GitHub Actions, Biome linting, and Vitest ([94e19c2](https://github.com/guichafy/ptolomeu/commit/94e19c27889c0d602e78c460e8cff412bc5f283c))
* add click-outside dismiss via windowDidResignKey ([446f630](https://github.com/guichafy/ptolomeu/commit/446f630c33bbc3da75840fc3521e524e494f4b6c))
* add E2E test infrastructure with Appium Mac2 and remove splash screen ([7a62f24](https://github.com/guichafy/ptolomeu/commit/7a62f24b283ed3d8d1e116b4d57ffd8a32c84cad))
* add ModeBar component with Tab-switching pills ([5d161ff](https://github.com/guichafy/ptolomeu/commit/5d161ff5d01584994aba55677f4bdce818eb72c9))
* add ProviderContext for managing active search provider ([301139d](https://github.com/guichafy/ptolomeu/commit/301139d50c771eff1a0249e84a46f992c73ad8f2))
* add real macOS app icons via sips conversion ([2f0d2aa](https://github.com/guichafy/ptolomeu/commit/2f0d2aa15eeb136f6fe4128b89cbb0703fa20b51))
* add ResultItem and CalculatorResult components ([87a0f12](https://github.com/guichafy/ptolomeu/commit/87a0f12c514de217ce5aaa01c3b38b7eee2b82a8))
* add SearchProvider and SearchResult interfaces ([d7179f8](https://github.com/guichafy/ptolomeu/commit/d7179f8e0963e42dd80f71f9027c89dbbc7a73be))
* add splash screen, recursive app scan, and rewrite README in pt-BR ([64a6ae5](https://github.com/guichafy/ptolomeu/commit/64a6ae50cd6839a2474020982e05150af3ddb502))
* add web search provider with Google, DuckDuckGo, SO, YouTube ([fbd5525](https://github.com/guichafy/ptolomeu/commit/fbd55254ed37f8d370b7bbc3f5e8b2885c4e4533))
* extract GitHub search into provider module ([47818de](https://github.com/guichafy/ptolomeu/commit/47818dece16029534acebfacca3c1d1f1dc00481))
* make search window frameless Alfred/Spotlight style ([40fab17](https://github.com/guichafy/ptolomeu/commit/40fab17bb63af167bc3763ce943aed0257317ecf))
* set up Electrobun RPC for app listing and launching ([2763e3b](https://github.com/guichafy/ptolomeu/commit/2763e3b0d6ed55bceb81ab7a4f4d6372208e174d))
* wire App.tsx with provider system and keyboard navigation ([a350db1](https://github.com/guichafy/ptolomeu/commit/a350db19e74da6a42c1f559cc40371c79efde3b8))
