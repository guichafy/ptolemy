import type { SkillFile } from "./skills";

export interface ExtensionSource {
	id: string;
	name: string;
	url: string;
	builtin?: boolean;
}
export interface ExtensionDiagnostic {
	code: string;
	message: string;
	severity: "info" | "warning" | "error";
	path?: string;
	componentId?: string;
}
export type ExtensionComponentKind =
	| "skill"
	| "mcp"
	| "hook"
	| "command"
	| "agent"
	| "other";
export interface ExtensionComponentSource {
	manifest: string;
	harness: "claude" | "codex" | "portable" | "catalog" | "directory";
	declaration: string;
	configPath?: string;
	/** Original native selector, before a catalog override. */
	skillPaths?: string[];
	/** Explicit catalog selector applies to every native variant. */
	catalogSkillPaths?: string[];
	catalogStrict?: boolean;
	overriddenBy?: "@catalog";
	effective: boolean;
}
export interface ExtensionComponentBase {
	sources: ExtensionComponentSource[];
	id: string;
	name: string;
	path?: string;
	description?: string;
	diagnostics: ExtensionDiagnostic[];
}
export type ExtensionComponent = ExtensionComponentBase &
	(
		| { kind: "skill"; definition?: { metadata: Record<string, unknown> } }
		| { kind: "mcp"; definition?: { config: Record<string, unknown> } }
		| {
				kind: "hook";
				definition?: {
					event: string;
					matcher?: string;
					handler: Record<string, unknown>;
					group: Record<string, unknown>;
					order: number;
				};
		  }
		| {
				kind: "command" | "agent";
				definition?: { metadata: Record<string, unknown>; prompt: string };
		  }
		| { kind: "other"; definition?: { type: string; value: unknown } }
	);
/** Public responses contain review metadata, never raw component definitions. */
export interface ExtensionSummary {
	id: string;
	name: string;
	description: string;
	sourceId: string;
	url: string;
	revision: string;
	components: ExtensionComponent[];
	diagnostics: ExtensionDiagnostic[];
}
export interface ExtensionOrigin {
	repository: string;
	path: string;
	commit: string;
	catalogUrl: string;
	catalogRevision: string;
	itemId: string;
}
/** Backend-only immutable content, relative to the complete plugin root. */
export interface ExtensionPackage extends ExtensionSummary {
	origin: ExtensionOrigin;
	files: SkillFile[];
	manifests: Record<string, Record<string, unknown>>;
}
export interface ExtensionSelection {
	packageId: string;
	revision: string;
	componentIds: string[];
	trustedHookDigest?: string;
}
