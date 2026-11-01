import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Base directory for Ptolemy's own data: settings, sessions, projects, auth
 * and MCP config. Defaults to the user's home; `PTOLEMY_HOME` relocates it
 * (used by the integration tests, so they never touch real data while the
 * agent CLIs keep using the real `$HOME` and its sign-ins).
 *
 * Read lazily: modules that resolve paths at import time pick up the value
 * set before they are first imported.
 */
export function ptolemyHome(): string {
	return process.env.PTOLEMY_HOME || homedir();
}

/** `~/.ptolomeu` (legacy spelling kept on purpose, see AGENTS.md). */
export function ptolemyDataDir(): string {
	return join(ptolemyHome(), ".ptolomeu");
}
