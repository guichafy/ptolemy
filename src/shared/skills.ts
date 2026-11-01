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
