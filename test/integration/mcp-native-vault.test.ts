/** Opt-in real macOS Keychain check. Only a newly generated test account is
 * touched, and finally always removes it. Never use an existing credential. */
import { expect, test } from "bun:test";
import { KeychainSecretVault } from "../../src/bun/mcp/secrets";

const enabled =
	process.platform === "darwin" && process.env.PTOLEMY_IT_NATIVE_VAULT === "1";
test.skipIf(!enabled)(
	"native MCP vault atomically replaces fresh empty, Unicode, empty and nonempty values",
	async () => {
		const vault = new KeychainSecretVault();
		const account = `smoke:${crypto.randomUUID()}`;
		if ((await vault.get(account)) !== undefined)
			throw Error("Unexpected existing native vault test account");
		try {
			for (const value of [
				"",
				"Teste temporário de acentuação 🧪",
				"",
				"replacement after empty",
			]) {
				await vault.set(account, value);
				expect(await vault.get(account)).toBe(value);
			}
		} finally {
			await vault.delete(account);
			expect(await vault.get(account)).toBeUndefined();
		}
	},
);
