import { describe, expect, it } from "vitest";
import { describeModel, formatModelId } from "./model-label";

describe("formatModelId", () => {
	it.each([
		["claude-opus-4-5-20251101", "Claude Opus 4.5"],
		["claude-sonnet-4-5", "Claude Sonnet 4.5"],
		["us.anthropic.claude-sonnet-4-5-20250929-v1:0", "Claude Sonnet 4.5"],
		["claude-3-5-haiku-20241022", "Claude 3.5 Haiku"],
		["claude-opus-4-6[1m]", "Claude Opus 4.6 (1M)"],
		["gpt-6.1-sol", "GPT-6.1 Sol"],
		["gpt-5-codex", "GPT-5 Codex"],
		["o3", "o3"],
	])("%s → %s", (id, label) => {
		expect(formatModelId(id)).toBe(label);
	});
});

describe("describeModel", () => {
	const codex = [
		{
			value: "default",
			displayName: "Padrão do Codex",
			description: "",
			resolvesTo: "gpt-6-astra",
		},
		{ value: "gpt-6-astra", displayName: "GPT-6 Astra", description: "" },
	];

	it("prefers the model the agent reported", () => {
		expect(describeModel("default", "gpt-6.1-sol", codex)).toEqual({
			primary: "GPT-6.1 Sol",
			resolvedId: "gpt-6.1-sol",
			isAlias: true,
		});
	});

	it("falls back to the catalog's resolvesTo for the default sentinel", () => {
		expect(describeModel("default", null, codex)?.primary).toBe("GPT-6 Astra");
	});

	it("uses the display name of a concrete configured model", () => {
		expect(describeModel("gpt-6-astra", null, codex)).toEqual({
			primary: "GPT-6 Astra",
			resolvedId: null,
			isAlias: false,
		});
	});

	it("returns null without any model", () => {
		expect(describeModel(null, null, codex)).toBeNull();
	});
});
