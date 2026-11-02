import { mcpRegistry } from "./registry";

let pending: Promise<void> | undefined;
/** v1 writers are retired. Preserve plaintext and retry on any collision/vault failure. */
export function ensureMcpCutover(): Promise<void> {
	if (pending) return pending;
	pending = (async () => {
		try {
			await mcpRegistry.reconcileLegacyMigration();
			await mcpRegistry.finalizeLegacyMigration();
		} catch {
			pending = undefined;
			throw Error(
				"Não foi possível migrar o MCP. Os dados antigos foram preservados. Verifique o acesso ao cofre e nomes/IDs duplicados em ~/.ptolomeu/mcp-servers.json e tente novamente. Não apague o arquivo antigo.",
			);
		}
	})();
	return pending;
}
