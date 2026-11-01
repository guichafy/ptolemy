import { createHash } from "node:crypto";
import type { McpServerDefinition, McpSnapshot } from "@/shared/mcp";
import { type McpRegistry, mcpRegistry } from "../mcp/registry";
import type { PreparedSessionExtensions } from "./activation";
export function extensionMcpId(
	packageId: string,
	componentId: string,
	revision: string,
): string {
	return `extension-mcp:${createHash("sha256").update(`${packageId}:${componentId}:${revision}`).digest("hex")}`;
}
/** Registration and credentials are owned exclusively by the shared registry. */
export async function snapshotExtensionMcp(
	prepared: PreparedSessionExtensions,
	registry: Pick<McpRegistry, "list" | "save" | "snapshot"> = mcpRegistry,
): Promise<McpSnapshot> {
	const existing = await registry.list();
	const ids: string[] = [];
	for (const component of prepared.mcpComponents) {
		const id = extensionMcpId(
			component.packageId,
			component.componentId,
			component.revision,
		);
		const found = existing.find(
			(s) => s.id === id && s.packageId === component.packageId,
		);
		if (!found) {
			const config = component.config;
			// Unresolved environment references require explicit credential configuration; never inherit CLI secrets.
			const { command: _command, args: _args, ...configuration } = config;
			if (
				/\$\{[^}]+\}/.test(JSON.stringify(configuration)) ||
				/\$\{(?!(?:CLAUDE_)?PLUGIN_(?:ROOT|DATA)\})[^}]+\}/.test(
					JSON.stringify([_command, _args]),
				)
			)
				throw Error(
					"MCP da extensão requer configuração no registro compartilhado.",
				);
			const base = {
				id,
				name: `${id.slice(0, 30)}-${component.name}`,
				packageId: component.packageId,
				defaults: { claude: false, codex: false },
			};
			const definition =
				typeof config.command === "string"
					? {
							...base,
							transport: "stdio",
							command: config.command,
							args: config.args,
							env: config.env,
						}
					: typeof config.url === "string"
						? {
								...base,
								transport: "http",
								url: config.url,
								headers: config.headers,
								...(config.oauth_resource
									? { auth: { type: "oauth", resource: config.oauth_resource } }
									: {}),
							}
						: null;
			if (!definition)
				throw Error(
					"MCP da extensão não possui comando ou endpoint utilizável.",
				);
			await registry.save(definition as McpServerDefinition);
		}
		ids.push(id);
	}
	const snapshot = await registry.snapshot(ids);
	for (const server of snapshot.servers) {
		const c = prepared.mcpComponents.find(
			(c) =>
				extensionMcpId(c.packageId, c.componentId, c.revision) === server.id,
		)!;
		const resolve = (value: string) =>
			value.replace(/\$\{(?:CLAUDE_)?PLUGIN_(ROOT|DATA)\}/g, (_token, kind) =>
				kind === "ROOT" ? c.root : c.data,
			);
		if (server.transport === "stdio") {
			server.command = resolve(server.command);
			server.args = server.args?.map(resolve);
		}
	}
	return snapshot;
}
