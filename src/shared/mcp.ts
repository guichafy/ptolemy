/** Secret values only cross the backend vault boundary; snapshots contain references. */
export interface McpSecretReference {
	secretRef: string;
}
export type McpConfigValue = string | McpSecretReference;
export interface McpOAuthConfig {
	type: "oauth";
	issuer?: string;
	resource?: string;
	clientId?: string;
	clientSecret?: McpSecretReference;
	scopes?: string[];
}
interface McpServerBase {
	id: string;
	name: string;
	defaults: { claude: boolean; codex: boolean };
	packageId?: string;
}
export type McpServerDefinition = McpServerBase &
	(
		| {
				transport: "stdio";
				command: string;
				args?: string[];
				env?: Record<string, McpConfigValue>;
		  }
		| {
				transport: "http";
				url: string;
				headers?: Record<string, McpConfigValue>;
				auth?: McpOAuthConfig;
		  }
	);
export interface McpSnapshot {
	version: 1;
	servers: McpServerDefinition[];
}
export type McpConnectionState =
	| "disconnected"
	| "connecting"
	| "waiting"
	| "connected"
	| "expired"
	| "cancelled"
	| "error";
export interface McpConnectionStatus {
	state: McpConnectionState;
	message?: string;
}
/** Safe for RPC: never return a definition or a resolved snapshot as a listing. */
export interface McpServerSummary {
	id: string;
	name: string;
	transport: "stdio" | "http";
	defaults: { claude: boolean; codex: boolean };
	packageId?: string;
	credentials: { env: string[]; headers: string[]; oauthClientSecret: boolean };
	connection: McpConnectionStatus;
}
export type ResolvedMcpServer = McpServerBase &
	(
		| {
				transport: "stdio";
				command: string;
				args?: string[];
				env?: Record<string, string>;
		  }
		| {
				transport: "http";
				url: string;
				headers?: Record<string, string>;
				auth?: McpOAuthConfig;
		  }
	);

/** RPC-safe editing: absence removes a field; preserve keeps its current credential;
 * value replaces it through the backend vault. Never include secretRef in a draft. */
export type McpCredentialEdit = { preserve: true } | { value: string };
export type McpEditableServer = McpServerBase &
	(
		| {
				transport: "stdio";
				command: string;
				args?: string[];
				env?: Record<string, McpCredentialEdit>;
		  }
		| {
				transport: "http";
				url: string;
				headers?: Record<string, McpCredentialEdit>;
				auth?: Omit<McpOAuthConfig, "clientSecret"> & {
					clientSecret?: McpCredentialEdit;
				};
		  }
	);

/** Safe registration metadata for the UI; obtained by validated discovery only. */
export interface McpOAuthRegistration {
	issuer: string;
	resource: string;
	redirectUri: string;
}
