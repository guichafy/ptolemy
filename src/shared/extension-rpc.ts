import type { AgentKind } from "./agent-protocol";
import type {
	ExtensionSelection,
	ExtensionSource,
	ExtensionSummary,
} from "./extensions";
import type {
	McpConnectionStatus,
	McpEditableServer,
	McpOAuthRegistration,
	McpServerSummary,
} from "./mcp";
export interface ExtensionCapability {
	packageId?: string;
	componentId: string;
	status: "native" | "adapted" | "requires-configuration" | "incompatible";
	reason: string;
}
export interface ExtensionInventory {
	/** Persisted Skill IDs only, independent of availability; absence is distinct from explicit []. */
	skillDefaults?: string[];
	installed: ExtensionSummary[];
	nativePlugins: {
		id: string;
		name: string;
		enabled: boolean;
		managed: boolean;
		canImport: boolean;
		importLimitation?: string;
	}[];
	builtins: {
		id: string;
		name: string;
		description: string;
		kind: "skill" | "command";
		origin: "builtin";
		limitation: string;
	}[];
	defaults?: {
		selections: ExtensionSelection[];
		builtinCommandNames?: string[];
	};
	verifiedRuntime: string;
	commandLimitation?: string;
}
export interface ExtensionChoices {
	skillIds: string[];
	extensionSelections: ExtensionSelection[];
	builtinCommandNames: string[];
	mcpServerIds: string[];
}
export interface ExtensionCommandSummary {
	name: string;
	description: string;
}
export type ExtensionRequests = {
	agentExtensionSources: { params: void; response: ExtensionSource[] };
	agentExtensionAddSource: {
		params: { url: string };
		response: ExtensionSource;
	};
	agentExtensionRemoveSource: { params: { id: string }; response: boolean };
	agentExtensionBrowse: {
		params: { sourceId: string };
		response: ExtensionSummary[];
	};
	agentExtensionInspect: {
		params: { sourceId: string; itemId: string; agent: AgentKind };
		response: {
			summary: ExtensionSummary;
			capabilities: ExtensionCapability[];
		};
	};
	agentExtensionInstall: {
		params: { sourceId: string; itemId: string };
		response: ExtensionSummary;
	};
	agentExtensionInstalled: { params: void; response: ExtensionSummary[] };
	agentExtensionRemove: { params: { id: string }; response: boolean };
	agentExtensionInventory: {
		params: { agent: AgentKind };
		response: ExtensionInventory;
	};
	agentExtensionImportNative: {
		params: { agent: AgentKind; id: string };
		response: ExtensionSummary;
	};
	agentExtensionReview: {
		params: {
			agent: AgentKind;
			packageId: string;
			revision: string;
			trustedHookDigest?: string;
		};
		response: ExtensionCapability[];
	};
	agentExtensionCapabilities: {
		params: { agent: AgentKind; selections: ExtensionSelection[] };
		response: ExtensionCapability[];
	};
	agentExtensionSetDefaults: {
		params: ExtensionChoices & { agent: AgentKind };
		response: boolean;
	};
	agentExtensionCommands: {
		params: { agent: AgentKind; selections: ExtensionSelection[] };
		response: ExtensionCommandSummary[];
	};
	agentSessionResources: {
		params: { sessionId: string };
		response: {
			legacy: boolean;
			skillCount: number;
			componentCount: number;
			mcpCount: number;
			builtinCount: number;
			unavailableReasons: string[];
		};
	};
	agentSessionCommands: {
		params: { sessionId: string };
		response: ExtensionCommandSummary[];
	};
	agentMcpList: { params: void; response: McpServerSummary[] };
	agentMcpGetEditable: { params: { id: string }; response: McpEditableServer };
	agentMcpSave: {
		params: {
			draft: McpEditableServer;
			binding?: { packageId: string; revision: string; componentId: string };
		};
		response: boolean;
	};
	agentMcpRemove: { params: { id: string }; response: boolean };
	agentMcpBindingDraft: {
		params: { packageId: string; revision: string; componentId: string };
		response: McpEditableServer;
	};
	agentMcpStatus: { params: { id: string }; response: McpConnectionStatus };
	agentMcpConnect: { params: { id: string }; response: McpConnectionStatus };
	agentMcpCancel: { params: { id: string }; response: boolean };
	agentMcpDisconnect: { params: { id: string }; response: boolean };
	agentMcpRegistration: {
		params: { id: string };
		response: McpOAuthRegistration;
	};
};
