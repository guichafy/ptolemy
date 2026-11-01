import type { AgentKind } from "./agent-protocol";

export interface GithubSkillSource {
	kind: "github";
	url: string;
	/** Immutable revision, resolved before downloading any files. */
	commit: string;
}

export type SkillSource =
	| GithubSkillSource
	| { kind: "harness"; agent: AgentKind };

export interface SkillSummary {
	id: string;
	name: string;
	description: string;
	source: SkillSource;
	defaultFor: AgentKind[];
	/** Local CLI discovery origin, shown without conflating built-ins and user Skills. */
	origin?: "system" | "local";
	localPath?: string;
	/** A native package the isolated SDK cannot load; never blocks creation. */
	unavailableReason?: string;
}

export interface SkillFile {
	/** Relative to the Skill directory; never a symlink. */
	path: string;
	content: string;
	executable: boolean;
}

export interface SkillBundle {
	name: string;
	description: string;
	source: SkillSource;
	files: SkillFile[];
}

export interface SessionSkill {
	id: string;
	name: string;
	source: SkillSource;
}

/** Absence preserves legacy native discovery; an explicit empty selection disables it. */
export interface SessionSkillSelection {
	nativePaths: string[];
}
