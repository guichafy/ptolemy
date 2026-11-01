import { describe, expect, it } from "vitest";
import {
	DEFAULT_CODEX_SETTINGS,
	DEFAULT_GITHUB_SETTINGS,
	validateSettings,
} from "./settings";

describe("validateSettings", () => {
	it("aceita settings válidas sem github (retro-compat)", () => {
		const result = validateSettings({
			version: 1,
			plugins: { enabledOrder: ["apps", "github"] },
		});
		expect(result.ok).toBe(true);
		expect(result.value?.github).toEqual(DEFAULT_GITHUB_SETTINGS);
	});

	it("aceita settings com github.customFilters vazio", () => {
		const result = validateSettings({
			version: 1,
			plugins: { enabledOrder: ["apps", "github", "calc", "web"] },
			github: { customFilters: [], hasToken: false },
		});
		expect(result.ok).toBe(true);
		expect(result.value?.github.customFilters).toEqual([]);
	});

	it("aceita filtro team-repos válido", () => {
		const result = validateSettings({
			version: 1,
			plugins: { enabledOrder: ["github"] },
			github: {
				hasToken: true,
				customFilters: [
					{
						id: "f1",
						kind: "team-repos",
						name: "Chafy · chafy",
						icon: "⭐",
						org: "Chafy-Studio",
						team: "chafy",
					},
				],
			},
		});
		expect(result.ok).toBe(true);
	});

	it("aceita filtro search válido", () => {
		const result = validateSettings({
			version: 1,
			plugins: { enabledOrder: ["github"] },
			github: {
				hasToken: false,
				customFilters: [
					{
						id: "f2",
						kind: "search",
						name: "Meus PRs",
						baseType: "issues",
						qualifiers: "is:pr is:open author:@me",
					},
				],
			},
		});
		expect(result.ok).toBe(true);
	});

	it("rejeita filtro team-repos sem org", () => {
		const result = validateSettings({
			version: 1,
			plugins: { enabledOrder: ["github"] },
			github: {
				hasToken: false,
				customFilters: [
					{ id: "f3", kind: "team-repos", name: "x", team: "chafy" },
				],
			},
		});
		expect(result.ok).toBe(false);
	});

	it("rejeita filtro com kind desconhecido", () => {
		const result = validateSettings({
			version: 1,
			plugins: { enabledOrder: ["github"] },
			github: {
				hasToken: false,
				customFilters: [{ id: "f4", kind: "mystery", name: "x" }],
			},
		});
		expect(result.ok).toBe(false);
	});

	it("rejeita filtros com ids duplicados", () => {
		const result = validateSettings({
			version: 1,
			plugins: { enabledOrder: ["github"] },
			github: {
				hasToken: false,
				customFilters: [
					{ id: "dup", kind: "team-repos", name: "a", org: "o", team: "t" },
					{
						id: "dup",
						kind: "search",
						name: "b",
						baseType: "repos",
						qualifiers: "",
					},
				],
			},
		});
		expect(result.ok).toBe(false);
	});
});

describe("validateSettings → proxy", () => {
	const base = {
		version: 1 as const,
		plugins: { enabledOrder: ["github"] },
		github: { hasToken: false, customFilters: [] },
	};

	it("aceita mode=manual com config válida", () => {
		const r = validateSettings({
			...base,
			proxy: {
				mode: "manual",
				manual: {
					protocol: "http",
					host: "proxy.corp",
					port: 8080,
					username: "alice",
					hasPassword: true,
					noProxy: ["*.local"],
				},
			},
		});
		expect(r.ok).toBe(true);
		expect(r.value?.proxy.mode).toBe("manual");
		expect(r.value?.proxy.manual?.host).toBe("proxy.corp");
	});

	it("degrada para mode=auto quando mode=manual sem config manual", () => {
		const r = validateSettings({ ...base, proxy: { mode: "manual" } });
		expect(r.ok).toBe(true);
		expect(r.value?.proxy.mode).toBe("auto");
		expect(r.value?.proxy.manual).toBeUndefined();
	});

	it("degrada para mode=auto quando manual é inválido", () => {
		const r = validateSettings({
			...base,
			proxy: {
				mode: "manual",
				manual: {
					protocol: "ftp",
					host: "x",
					port: 8080,
					hasPassword: false,
					noProxy: [],
				},
			},
		});
		expect(r.ok).toBe(true);
		expect(r.value?.proxy.mode).toBe("auto");
	});

	it("rejeita porta fora de range mesmo em modos diferentes", () => {
		const r = validateSettings({
			...base,
			proxy: {
				mode: "auto",
				manual: {
					protocol: "http",
					host: "x",
					port: 70000,
					hasPassword: false,
					noProxy: [],
				},
			},
		});
		// mode=auto não exige manual válido — o campo manual inválido é apenas descartado.
		expect(r.ok).toBe(true);
		expect(r.value?.proxy.mode).toBe("auto");
		expect(r.value?.proxy.manual).toBeUndefined();
	});

	it("rejeita host com espaço", () => {
		const r = validateSettings({
			...base,
			proxy: {
				mode: "manual",
				manual: {
					protocol: "http",
					host: "proxy corp",
					port: 8080,
					hasPassword: false,
					noProxy: [],
				},
			},
		});
		expect(r.ok).toBe(true);
		expect(r.value?.proxy.mode).toBe("auto");
	});

	it("settings.json legado sem campo proxy continua válido", () => {
		const r = validateSettings(base);
		expect(r.ok).toBe(true);
		expect(r.value?.proxy.mode).toBe("auto");
	});
});

describe("validateSettings: bloco codex", () => {
	const base = { version: 1, plugins: { enabledOrder: ["apps", "codex"] } };

	it("usa os padrões quando o bloco não existe (settings antigos)", () => {
		const result = validateSettings(base);
		expect(result.ok).toBe(true);
		expect(result.value?.codex).toEqual(DEFAULT_CODEX_SETTINGS);
		expect(result.value?.plugins.enabledOrder).toEqual(["apps", "codex"]);
	});

	it("preserva valores válidos", () => {
		const result = validateSettings({
			...base,
			codex: {
				model: "gpt-6-luna",
				sandboxMode: "read-only",
				reasoningEffort: "high",
			},
		});
		expect(result.value?.codex).toEqual({
			model: "gpt-6-luna",
			sandboxMode: "read-only",
			reasoningEffort: "high",
		});
	});

	it("reverte só o campo inválido, sem descartar o resto", () => {
		const result = validateSettings({
			...base,
			codex: {
				model: "gpt-6-luna",
				sandboxMode: "danger-full-access",
				reasoningEffort: "ultra",
			},
		});
		expect(result.ok).toBe(true);
		expect(result.value?.codex).toEqual({
			model: "gpt-6-luna",
			sandboxMode: DEFAULT_CODEX_SETTINGS.sandboxMode,
			reasoningEffort: DEFAULT_CODEX_SETTINGS.reasoningEffort,
		});
	});
});
