import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A mutable home-dir pointer so each test can redirect settings I/O into its
// own tmpdir without tearing down the mock.
const fakeHome = vi.hoisted(() => ({ path: "" }));

vi.mock("node:os", async () => {
	const actual = await vi.importActual<typeof import("node:os")>("node:os");
	return { ...actual, homedir: () => fakeHome.path };
});

// Some bun-side modules still expect Bun.file/Bun.write in the vitest env.
function installBunFsShim() {
	(globalThis as unknown as { Bun: Record<string, unknown> }).Bun = {
		spawn: vi.fn(),
		file: (path: string) => ({
			exists: async () => {
				try {
					await readFile(path);
					return true;
				} catch {
					return false;
				}
			},
			text: async () => readFile(path, "utf8"),
		}),
		write: async (path: string, content: string | Uint8Array) => {
			await writeFile(path, content);
			return typeof content === "string" ? content.length : content.byteLength;
		},
	};
}

function settingsPath(): string {
	return join(
		fakeHome.path,
		"Library",
		"Application Support",
		"com.ptolomeu.app",
		"settings.json",
	);
}

describe("settings I/O", () => {
	beforeEach(async () => {
		installBunFsShim();
		fakeHome.path = await mkdtemp(join(tmpdir(), "ptolemy-settings-"));
		vi.resetModules();
	});

	afterEach(async () => {
		await rm(fakeHome.path, { recursive: true, force: true });
	});

	it("creates a defaults file when settings.json does not exist", async () => {
		const { loadSettings } = await import("./settings");
		const loaded = await loadSettings();

		expect(loaded.version).toBe(1);
		expect(loaded.plugins.enabledOrder).toEqual([
			"apps",
			"github",
			"calc",
			"web",
			"claude",
		]);

		const raw = await readFile(settingsPath(), "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed.version).toBe(1);
	});

	it("save → load round-trip preserves data", async () => {
		const { loadSettings, saveSettings } = await import("./settings");
		const initial = await loadSettings();

		const mutated = {
			...initial,
			plugins: { enabledOrder: ["github", "calc", "web"] },
			github: {
				...initial.github,
				customFilters: [
					{
						id: "f1",
						kind: "search" as const,
						name: "My issues",
						baseType: "issues" as const,
						qualifiers: "state:open",
					},
				],
			},
		};

		expect(await saveSettings(mutated)).toBe(true);

		const reloaded = await loadSettings();
		expect(reloaded.plugins.enabledOrder).toEqual(["github", "calc", "web"]);
		expect(reloaded.github.customFilters[0].name).toBe("My issues");
	});

	it("recovers from a corrupted settings.json by rewriting defaults", async () => {
		const p = settingsPath();
		await mkdir(join(p, ".."), { recursive: true });
		await writeFile(p, "{this is not json", "utf8");

		const { loadSettings } = await import("./settings");
		const loaded = await loadSettings();

		expect(loaded.version).toBe(1);
		expect(loaded.plugins.enabledOrder.length).toBeGreaterThanOrEqual(1);

		const raw = await readFile(p, "utf8");
		expect(() => JSON.parse(raw)).not.toThrow();
		const files = await readdir(join(p, ".."));
		expect(
			files.some((name) => name.startsWith("settings.json.corrupt-")),
		).toBe(true);
	});

	it("recovers from a valid-JSON but schema-invalid file", async () => {
		const p = settingsPath();
		await mkdir(join(p, ".."), { recursive: true });
		await writeFile(
			p,
			JSON.stringify({ version: 99, plugins: { enabledOrder: ["bogus"] } }),
			"utf8",
		);

		const { loadSettings } = await import("./settings");
		const loaded = await loadSettings();
		expect(loaded.version).toBe(1);
		expect(loaded.plugins.enabledOrder).toContain("github");
		const files = await readdir(join(p, ".."));
		expect(
			files.some((name) => name.startsWith("settings.json.corrupt-")),
		).toBe(true);
	});

	it("handles concurrent saves without leaving partial JSON", async () => {
		const { loadSettings, saveSettings } = await import("./settings");
		const initial = await loadSettings();

		await Promise.all([
			saveSettings({
				...initial,
				plugins: { enabledOrder: ["apps", "github"] },
			}),
			saveSettings({
				...initial,
				plugins: { enabledOrder: ["calc", "web"] },
			}),
		]);

		const raw = await readFile(settingsPath(), "utf8");
		expect(() => JSON.parse(raw)).not.toThrow();
		const reloaded = await loadSettings();
		expect(reloaded.plugins.enabledOrder.length).toBeGreaterThanOrEqual(1);
	});

	it("saveSettings rejects invalid input without touching the file", async () => {
		const { loadSettings, saveSettings } = await import("./settings");
		await loadSettings(); // creates defaults on disk
		const before = await readFile(settingsPath(), "utf8");

		const invalid = {
			version: 1,
			plugins: { enabledOrder: [] }, // below MIN_ACTIVE
			github: { customFilters: [], hasToken: false },
			analytics: { consentGiven: false, anonymousId: "a" },
			claude: {
				authMode: "anthropic",
				model: "m",
				permissionMode: "acceptEdits",
			},
			proxy: { mode: "auto" },
		} as unknown as Parameters<typeof saveSettings>[0];

		expect(await saveSettings(invalid)).toBe(false);

		const after = await readFile(settingsPath(), "utf8");
		expect(after).toBe(before);
	});

	it("drops unknown legacy claude fields on save → load round-trip", async () => {
		const { loadSettings, saveSettings } = await import("./settings");
		const initial = await loadSettings();

		// Settings files written before `useAiElements` was retired may still
		// carry the key. Confirm the loader silently ignores it without
		// invalidating the claude block.
		const mutated = {
			...initial,
			claude: {
				...initial.claude,
				useAiElements: true,
			} as unknown as typeof initial.claude,
		};
		expect(await saveSettings(mutated)).toBe(true);

		const reloaded = await loadSettings();
		expect(
			(reloaded.claude as unknown as Record<string, unknown>).useAiElements,
		).toBe(undefined);
		expect(reloaded.claude.permissionMode).toBe("acceptEdits");
	});

	it("does NOT persist password value to disk in manual proxy config", async () => {
		const { loadSettings, saveSettings } = await import("./settings");
		const initial = await loadSettings();

		const mutated = {
			...initial,
			proxy: {
				mode: "manual" as const,
				manual: {
					protocol: "http" as const,
					host: "proxy.local",
					port: 3128,
					username: "user",
					hasPassword: true,
					noProxy: ["localhost"],
				},
			},
		};
		expect(await saveSettings(mutated)).toBe(true);

		const reloaded = await loadSettings();
		expect(reloaded.proxy.mode).toBe("manual");
		expect(reloaded.proxy.manual?.host).toBe("proxy.local");
		expect(reloaded.proxy.manual?.hasPassword).toBe(true);

		const raw = await readFile(settingsPath(), "utf8");
		expect(raw).not.toMatch(/"password"/);
	});
});
