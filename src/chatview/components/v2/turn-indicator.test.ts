import { describe, expect, it } from "vitest";
import { turnIndicatorLabel } from "./turn-indicator";

describe("turnIndicatorLabel", () => {
	it("returns null for idle (no indicator should be rendered)", () => {
		expect(turnIndicatorLabel("idle")).toBeNull();
	});

	it("labels waiting as 'Aguardando resposta do Claude...'", () => {
		expect(turnIndicatorLabel("waiting")).toBe(
			"Aguardando resposta do Claude...",
		);
	});

	it("names Codex when the session is backed by Codex", () => {
		expect(turnIndicatorLabel("waiting", undefined, "codex")).toBe(
			"Aguardando resposta do Codex...",
		);
	});

	it("labels receiving as 'Recebendo resposta...'", () => {
		expect(turnIndicatorLabel("receiving")).toBe("Recebendo resposta...");
	});

	it("labels tool_running with the tool name when provided", () => {
		expect(turnIndicatorLabel("tool_running", "Bash")).toBe(
			"Executando Bash...",
		);
	});

	it("falls back to a generic label when the tool name is missing", () => {
		expect(turnIndicatorLabel("tool_running")).toBe("Executando ferramenta...");
	});
});
