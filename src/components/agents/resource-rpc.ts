import type { ExtensionRequests } from "@/shared/extension-rpc";
/** Bind once per isolated webview to its own Electrobun transport. Importing
 * shared resource UI must never initialize the other renderer's RPC instance. */
export type ResourceRpc = {
	request: Pick<
		typeof import("@/mainview/providers/rpc").rpc.request,
		keyof ExtensionRequests | "agentListSkills" | "agentImportSkill" | "openUrl"
	>;
};
let client: ResourceRpc | undefined;
export function configureResourceRpc(value: ResourceRpc) {
	client = value;
}
export const resourceRpc: ResourceRpc = {
	get request() {
		if (!client) throw Error("Transporte de recursos ainda não configurado.");
		return client.request;
	},
};
