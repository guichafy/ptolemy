import { useEffect, useState } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import type { AgentKind } from "@/shared/agent-protocol";
import type { TurnStatus } from "../../hooks/agent-state";
import { describeTool } from "../../lib/tool-display";

const AGENT_NAMES: Record<AgentKind, string> = {
	claude: "Claude",
	codex: "Codex",
};

export function turnIndicatorLabel(
	status: TurnStatus,
	toolName?: string,
	agent: AgentKind = "claude",
): string | null {
	switch (status) {
		case "idle":
			return null;
		case "waiting":
			return `Aguardando resposta do ${AGENT_NAMES[agent]}...`;
		case "receiving":
			return "Recebendo resposta...";
		case "tool_running":
			return toolName
				? `Executando ${toolName}...`
				: "Executando ferramenta...";
	}
}

export interface TurnIndicatorProps {
	status: TurnStatus;
	toolName?: string;
	agent?: AgentKind;
}

/** Seconds since `active` last became true; 0 while inactive. */
function useElapsedSeconds(active: boolean): number {
	const [elapsed, setElapsed] = useState(0);
	useEffect(() => {
		if (!active) {
			setElapsed(0);
			return;
		}
		const startedAt = Date.now();
		const id = setInterval(() => {
			setElapsed(Math.floor((Date.now() - startedAt) / 1000));
		}, 1000);
		return () => clearInterval(id);
	}, [active]);
	return elapsed;
}

/**
 * Live status under the conversation while a turn runs. Hidden while text
 * streams (the reply itself shows progress); otherwise a shimmering label
 * with the elapsed time, so a slow first token never looks like a freeze.
 */
export function TurnIndicator({ status, toolName, agent }: TurnIndicatorProps) {
	const visible = status === "waiting" || status === "tool_running";
	const elapsed = useElapsedSeconds(status !== "idle");
	if (!visible) return null;
	const label = turnIndicatorLabel(
		status,
		toolName ? describeTool(toolName, undefined).title : undefined,
		agent,
	);
	if (!label) return null;
	return (
		<div
			className="flex items-center gap-2 text-muted-foreground text-xs"
			aria-live="polite"
			data-slot="turn-indicator"
		>
			<Shimmer as="span" duration={1.6}>
				{label}
			</Shimmer>
			{elapsed >= 2 && (
				<span className="tabular-nums text-muted-foreground/70">
					{elapsed}s
				</span>
			)}
		</div>
	);
}
