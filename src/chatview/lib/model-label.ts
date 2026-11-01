import type { ProtocolModelInfo } from "@/shared/agent-protocol";

/**
 * Turns a raw model id into a readable label:
 * `claude-opus-4-5-20251101` → `Claude Opus 4.5`,
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `Claude Sonnet 4.5`,
 * `gpt-6.1-sol` → `GPT-6.1 Sol`. Unknown shapes come back unchanged.
 */
export function formatModelId(id: string): string {
	let raw = id.trim();
	if (!raw) return raw;

	// Bedrock: region/vendor prefix and `-v1:0` suffix.
	const claudeAt = raw.indexOf("claude-");
	if (claudeAt > 0) raw = raw.slice(claudeAt);
	raw = raw.replace(/-v\d+(:\d+)?$/, "");
	// Snapshot date suffix (`-20250929`, `@20250929`).
	raw = raw.replace(/[-@]\d{8}$/, "");
	// Context-size tag (`[1m]`).
	const sizeTag = /\[(\d+[km])\]$/i.exec(raw);
	raw = raw.replace(/\[\d+[km]\]$/i, "");

	let label: string | null = null;
	const modern = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?$/.exec(raw);
	const legacy = /^claude-(\d+)(?:-(\d+))?-(opus|sonnet|haiku)$/.exec(raw);
	if (modern) {
		const version = modern[3] ? `${modern[2]}.${modern[3]}` : modern[2];
		label = `Claude ${capitalize(modern[1])} ${version}`;
	} else if (legacy) {
		const version = legacy[2] ? `${legacy[1]}.${legacy[2]}` : legacy[1];
		label = `Claude ${version} ${capitalize(legacy[3])}`;
	} else if (/^gpt-/i.test(raw)) {
		const [, rest] = /^gpt-(.*)$/i.exec(raw) ?? [];
		const [version, ...words] = (rest ?? "").split("-");
		label = [`GPT-${version}`, ...words.map(capitalize)].join(" ");
	}

	if (!label) return id;
	return sizeTag ? `${label} (${sizeTag[1].toUpperCase()})` : label;
}

function capitalize(word: string): string {
	return word ? word[0].toUpperCase() + word.slice(1) : word;
}

export interface ModelLabel {
	/** What to show: the concrete model when known, else the configured one. */
	primary: string;
	/** Raw id of the concrete model, for tooltips. */
	resolvedId: string | null;
	/** True when the configured value is an alias (e.g. `default`). */
	isAlias: boolean;
}

/**
 * Label for the model a session runs. `configured` is the stored session model
 * (may be an alias like `default`/`sonnet`); `resolved` is the concrete id the
 * agent reported; `models` is the agent's catalog (display names).
 */
export function describeModel(
	configured: string | null,
	resolved: string | null,
	models: ProtocolModelInfo[],
): ModelLabel | null {
	const entry = configured
		? models.find((m) => m.value === configured)
		: undefined;
	const concrete = resolved ?? entry?.resolvesTo ?? null;
	if (concrete) {
		const known = models.find((m) => m.value === concrete);
		return {
			primary: known?.displayName ?? formatModelId(concrete),
			resolvedId: concrete,
			isAlias: Boolean(configured && configured !== concrete),
		};
	}
	if (!configured) return null;
	return {
		primary: entry?.displayName ?? formatModelId(configured),
		resolvedId: null,
		isAlias: false,
	};
}
