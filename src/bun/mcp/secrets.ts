/** All failures are source-free: Keychain errors and credential bytes never reach RPC. */
export interface SecretVault {
	get(key: string): Promise<string | undefined>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
}
export class MemorySecretVault implements SecretVault {
	private readonly values = new Map<string, string>();
	async get(key: string): Promise<string | undefined> {
		return this.values.get(key);
	}
	async set(key: string, value: string): Promise<void> {
		this.values.set(key, value);
	}
	async delete(key: string): Promise<void> {
		this.values.delete(key);
	}
}
export class KeychainSecretVault implements SecretVault {
	private async native() {
		return import("./native-keychain");
	}
	async get(key: string): Promise<string | undefined> {
		try {
			return (await this.native()).readSecret(key);
		} catch {
			throw Error("Não foi possível ler a credencial MCP.");
		}
	}
	async set(key: string, value: string): Promise<void> {
		try {
			(await this.native()).writeSecret(key, value);
		} catch {
			throw Error("Não foi possível salvar a credencial MCP.");
		}
	}
	async delete(key: string): Promise<void> {
		try {
			(await this.native()).deleteSecret(key);
		} catch {
			throw Error("Não foi possível remover a credencial MCP.");
		}
	}
}
export const mcpSecretVault: SecretVault = new KeychainSecretVault();
