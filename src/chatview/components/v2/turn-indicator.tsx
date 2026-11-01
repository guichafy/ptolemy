import type { AgentKind } from "@/shared/agent-protocol";
import type { TurnStatus } from "../../hooks/agent-state";

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

export function TurnIndicator({ status, toolName, agent }: TurnIndicatorProps) {
	const label = turnIndicatorLabel(status, toolName, agent);
	if (label === null) return null;
	return (
		<div
			className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground"
			aria-live="polite"
		>
			<BouncingDots />
			<span>{label}</span>
		</div>
	);
}

function BouncingDots() {
	return (
		<div className="flex items-center gap-1">
			<span
				className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
				style={{ animationDelay: "0ms" }}
			/>
			<span
				className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
				style={{ animationDelay: "150ms" }}
			/>
			<span
				className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce"
				style={{ animationDelay: "300ms" }}
			/>
		</div>
	);
}
