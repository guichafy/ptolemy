import { describe, expect, it } from "vitest";
import { KeychainSecretVault, MemorySecretVault } from "./secrets";

describe("MCP secret vault boundary", () => {
	it("round-trips UTF-8 without normalizing credential bytes and deletes idempotently", async () => {
		const vault = new MemorySecretVault();
		await vault.set("opaque", 'á\n"secret-probe"\0end');
		expect(await vault.get("opaque")).toBe('á\n"secret-probe"\0end');
		await vault.delete("opaque");
		await vault.delete("opaque");
		expect(await vault.get("opaque")).toBeUndefined();
	});
	it("loads native FFI lazily and sanitizes native failures in Node tests", async () => {
		const vault = new KeychainSecretVault();
		await expect(vault.get("opaque-secret-probe")).rejects.toThrow(
			"Não foi possível ler a credencial MCP.",
		);
		await expect(vault.set("opaque", "secret-probe")).rejects.toThrow(
			"Não foi possível salvar a credencial MCP.",
		);
		await expect(vault.delete("opaque")).rejects.toThrow(
			"Não foi possível remover a credencial MCP.",
		);
	});
});
