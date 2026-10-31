# Ptolemy

Your daily tools, orbiting you. A macOS menu bar command center for software engineers.

Ptolemy is a menu bar app for macOS built with [Electrobun](https://electrobun.dev/) (Bun runtime) and React. It opens a global command palette (`⌘+Shift+Space`) that is extensible through plugins: each plugin is a provider that adds a new capability. It ships with 5 built-in plugins, including an embedded Claude chat window.

> Formerly **Ptolomeu**. Releases up to v0.10.x were published under that name; existing settings, sessions and Keychain entries keep working after the rename.

🇧🇷 [Leia em Português](README.pt-BR.md)

## Install

Requirements: macOS 13+ on Apple Silicon (arm64).

1. Download the latest `.zip` from [GitHub Releases](https://github.com/guichafy/ptolemy/releases) or the [project site](https://guichafy.github.io/ptolemy/).
2. Unzip it and drag the app into `/Applications`. On first launch, allow it in System Settings → Privacy & Security.
3. Press `⌘+Shift+Space`. The icon lives in the menu bar (there is no Dock icon).

The Claude plugin also needs the Claude Code CLI (`claude`) installed and signed in (the plugin settings can install it and open the login), or an AWS Bedrock profile configured there.

## Quick start (development)

```bash
# Prerequisites: macOS (arm64), Bun, Xcode Command Line Tools
bun install
bun run dev:hmr
```

## Built-in plugins

| Plugin | Description |
|--------|-------------|
| **Apps** | Launch macOS applications from the palette. |
| **GitHub** | Search repos, code, issues and users. Custom filters, qualifier builder, team repos. |
| **Calculator** | Evaluate math expressions inline. |
| **Web Search** | Quick access to Google, DuckDuckGo, Stack Overflow and YouTube. |
| **Claude Code** | Chat with Claude in a dedicated window: streaming responses, persistent sessions, model picker, tool approval and MCP servers. Each conversation runs in its own isolated workspace. |

## Plugin system

Every plugin implements the `SearchProvider` interface:

```typescript
interface SearchProvider {
  id: string;
  label: string;
  icon: IconComponent;
  placeholder: string;
  search(query: string, signal?: AbortSignal, context?: unknown): Promise<SearchResult[]>;
  useSearchContext?: () => unknown;   // optional reactive context
  configComponent?: ComponentType;    // optional settings UI
}
```

Results returned by `search()`:

```typescript
interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  badge?: string;
  onSelect: () => void;
}
```

### Creating a plugin

```typescript
// src/mainview/providers/npm-provider.ts
import { Package } from "lucide-react";
import type { SearchProvider } from "./types";

export const npmProvider: SearchProvider = {
  id: "npm",
  label: "npm",
  icon: Package,
  placeholder: "Search npm packages...",

  async search(query) {
    if (!query) return [];
    const res = await fetch(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=10`
    );
    const data = await res.json();
    return data.objects.map((obj: any) => ({
      id: obj.package.name,
      title: obj.package.name,
      subtitle: obj.package.description,
      badge: obj.package.version,
      onSelect: () => window.open(`https://npmjs.com/package/${obj.package.name}`),
    }));
  },
};
```

Register it in `src/mainview/providers/registry.ts`:

```typescript
import { npmProvider } from "./npm-provider";

export const PLUGIN_REGISTRY: Record<string, SearchProvider> = {
  // ... existing plugins
  npm: npmProvider,
};

export const PLUGIN_META: PluginMeta[] = [
  // ... existing entries
  { id: "npm", label: "npm", description: "Buscar pacotes npm", icon: Package },
];
```

UI labels and descriptions are in Portuguese (pt-BR), like the rest of the app.

### Plugin ideas

Looking for inspiration? Here are some plugins the community could build:

- **Jira / Linear**: issues, boards, sprint status
- **Slack**: channels, messages, people
- **AWS Console**: services, resources, CloudWatch
- **Docker**: containers, images, compose stacks
- **npm / PyPI**: package registry search
- **Homebrew**: formulae, casks
- **Kubernetes**: pods, deployments, services
- **CI/CD**: GitHub Actions, CircleCI run status
- **Bookmarks**: browser bookmarks search
- **Notes**: Apple Notes, Obsidian vault search

Don't see your tool? Build a plugin and open a PR.

## Architecture

| Process / view | Path | Role |
|----------------|------|------|
| **Main (Bun)** | `src/bun/` | System tray, windows, native FFI, global hotkey, Claude session manager, proxy-aware fetch. |
| **Palette renderer** | `src/mainview/` | React command palette in a hidden BrowserWindow toggled by `⌘+Shift+Space`. |
| **Chat renderer** | `src/chatview/` | Separate React app for the Claude chat window, created on first open. |

```
                       ┌───────────────────┐
                  RPC  │  Palette (React)  │
              ┌──────► │  cmdk, plugins    │
┌──────────────┐       └───────────────────┘
│  Main (Bun)   │
│  tray, FFI,   │       ┌───────────────────┐
│  Claude SDK   │  RPC  │  Chat (React)     │
│  proxy, RPC   ├─────► │  AI Elements      │
└──────────────┘       └───────────────────┘
```

Each window gets its own Electrobun RPC instance (one transport per window) but shares the same handler set. See [AGENTS.md](AGENTS.md) for the detailed architecture, RPC reference and conventions. It is also the instruction file for AI coding agents working on this repo.

## Development

**Dev with HMR (recommended)**

```bash
bun run dev:hmr            # Vite (mainview + chatview) + Electrobun, all watching
```

**Build**

```bash
bun run build:native       # Compile Objective-C → liboverlay.dylib
bun run build:vite         # Build mainview (dist/) and chatview (dist-chat/)
bun run build:dev-bundle   # Dev .app bundle (needed for E2E)
bun run build:canary       # Production build (canary channel)
bun run build:release      # Production build (stable channel)
```

**Test**

```bash
bun run test               # Vitest: node + jsdom projects
bun run test:watch         # Vitest in watch mode
bun run test:coverage      # Coverage report (HTML in ./coverage/)
bun run test:e2e           # E2E (Appium Mac2; requires the dev bundle)
bun run screenshots        # Build dev bundle + run E2E + regenerate docs/screenshots/
```

The E2E suite drives the real macOS app via Appium Mac2 and writes PNG screenshots to `docs/screenshots/`. Both the CI `e2e` job and the `screenshots` script build the dev bundle with `electrobun build --env=dev` before running.

Vitest runs two projects side by side:

- `node`: backend modules (`src/bun/**`, `src/chatview/lib/**`, `src/chatview/hooks/**`)
- `jsdom`: React UI (`src/mainview/**`, `src/chatview/components/**`, `src/lib/**`)

**Lint and types**

```bash
bun run lint               # Biome check
bun run lint:fix           # Biome auto-fix
bun run typecheck          # tsc --noEmit
```

**Git hooks (lefthook)**

Lefthook installs automatically via `bun install` (the `prepare` script runs `lefthook install`). Every commit runs Biome on the staged files and Vitest on the tests affected by the change. To skip once: `LEFTHOOK=0 git commit …`.

**Landing page**

The project site lives in `site/` (Astro). Run it with `bun run dev:site`; it is deployed to GitHub Pages by `.github/workflows/site.yml`.

## Releases

Releases are automated with semantic-release on `main`, driven by Conventional Commits. Each release publishes `ptolemy-<version>-macos-arm64.zip` to GitHub Releases, mirrors it on GitHub Pages and updates [`CHANGELOG.md`](CHANGELOG.md).

## Contributing

### Report bugs

Open an issue with reproduction steps. Include your macOS version, Bun version and steps to reproduce.

### Suggest a plugin

Open an issue tagged `plugin-idea`. Describe the tool or service and what searches it would enable.

### Build a plugin

1. Implement the `SearchProvider` interface (see [Plugin system](#plugin-system) above)
2. Add your provider to `PLUGIN_REGISTRY` in `src/mainview/providers/registry.ts`
3. Add a `PluginMeta` entry with icon, label and description
4. Open a PR

### Code standards

- **Linter/formatter:** Biome; run `bun run lint:fix` before committing
- **Commits:** Conventional Commits (`feat(scope):`, `fix(scope):`)
- **UI labels:** Portuguese (pt-BR), e.g. "Abrir", "Sair", "Buscar"
- **Package manager:** Bun only (`bun install`, `bun run`)
- **Path alias:** `@/*` maps to `src/*`

### PR process

1. Fork the repo
2. Create a feature branch (`feat/my-plugin`)
3. Run `bun run lint:fix && bun run typecheck && bun run test`
4. Open a PR with a description of your changes

## License

Apache 2.0, see [LICENSE](LICENSE) for details.

---

> Named after Claudius Ptolemy, who placed Earth at the center of the cosmos. Ptolemy places you at the center of your workflow.
