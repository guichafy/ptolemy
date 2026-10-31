<wizard-report>
# PostHog post-wizard report

The wizard has completed a PostHog integration for Ptolemy. Since this is a TypeScript/Bun/Electrobun project with no prior Python code, the integration introduces a new Python release analytics CLI (`scripts/release_analytics.py`) alongside the existing `scripts/sync-versions.ts`. This script is designed to be called during the release pipeline (CI/CD or manually) to track build and release lifecycle events. A `requirements.txt` was added at the project root, and PostHog credentials are loaded from environment variables via `.env` (covered by `.gitignore`).

| Event | Description | File |
|---|---|---|
| `release_published` | Fired when a new release version is published (stable or canary). Tracks `version`, `channel`, `platform`. | `scripts/release_analytics.py` |
| `canary_release_started` | Fired when a canary build pipeline is started, before the build runs. Tracks `version`, `platform`. | `scripts/release_analytics.py` |
| `build_completed` | Fired when a build completes successfully. Tracks `version`, `channel`, `platform`, `duration_seconds`. | `scripts/release_analytics.py` |
| `build_failed` | Fired when a build fails. Tracks `version`, `channel`, `platform`, `error_type`. | `scripts/release_analytics.py` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on release health, based on the events we just instrumented:

- **Dashboard** — [Analytics basics](https://us.posthog.com/project/379196/dashboard/1458555)
- **Releases over time** — [Insight](https://us.posthog.com/project/379196/insights/0coBVIiM)
- **Build success vs failure** — [Insight](https://us.posthog.com/project/379196/insights/XSgjmuKB)
- **Release pipeline funnel** (canary → build → publish) — [Insight](https://us.posthog.com/project/379196/insights/Z5T2uOdm)
- **Releases by channel** (stable vs canary) — [Insight](https://us.posthog.com/project/379196/insights/pXE52ztO)
- **Build failures by error type** — [Insight](https://us.posthog.com/project/379196/insights/Q8WKrFba)

To start sending events, call the script during your release workflow:

```bash
# At the start of a canary build
python scripts/release_analytics.py canary_release_started --version 1.3.0-canary.1

# After a successful build
python scripts/release_analytics.py build_completed --version 1.3.0 --channel stable --duration 60

# When a release is published
python scripts/release_analytics.py release_published --version 1.3.0 --channel stable
```

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
