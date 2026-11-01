import { Bot, SquareTerminal } from "lucide-react";
import { ModelPicker } from "@/components/claude/model-picker";
import { cn } from "@/lib/utils";
import type { AgentKind, ProtocolModelInfo } from "@/shared/agent-protocol";
import { rpc } from "../rpc";

type SessionState = "idle" | "streaming" | "tool_running" | "error";

interface ChatHeaderProps {
	/** Defaults to Claude, the agent of every pre-Codex session. */
	agent?: AgentKind;
	sessionId: string | null;
	sessionState: SessionState;
	sessionModel: string | null;
	models: ProtocolModelInfo[];
}

const stateConfig: Record<SessionState, { color: string; pulse: boolean }> = {
	idle: { color: "bg-green-500", pulse: false },
	streaming: { color: "bg-green-500", pulse: true },
	tool_running: { color: "bg-yellow-500", pulse: true },
	error: { color: "bg-red-500", pulse: false },
};

const agentConfig: Record<AgentKind, { title: string; icon: typeof Bot }> = {
	claude: { title: "Claude Code", icon: Bot },
	codex: { title: "Codex", icon: SquareTerminal },
};

export function ChatHeader({
	agent = "claude",
	sessionId,
	sessionState,
	sessionModel,
	models,
}: ChatHeaderProps) {
	const { color, pulse } = stateConfig[sessionState];
	const { title, icon: AgentIcon } = agentConfig[agent];
	const handleChange = async (model: string) => {
		if (!sessionId) return;
		try {
			await rpc.request.claudeSetSessionModel({ sessionId, model });
		} catch (err) {
			console.error("[chat-header] setSessionModel failed:", err);
		}
	};

	return (
		<div className="flex items-center gap-3 border-b border-border/40 px-4 py-2.5">
			<AgentIcon className="h-4 w-4 text-muted-foreground" />
			<h1 className="text-sm font-semibold">{title}</h1>
			<span
				className={cn(
					"inline-block h-2 w-2 rounded-full",
					color,
					pulse && "animate-pulse",
				)}
			/>
			<ModelPicker
				variant="session"
				value={sessionModel}
				models={models}
				onChange={handleChange}
				disabled={sessionState !== "idle" || !sessionId}
				placeholder="Selecionar modelo"
			/>
			{sessionId && (
				<span className="ml-auto text-xs text-muted-foreground/60 truncate">
					{sessionId.slice(0, 8)}
				</span>
			)}
		</div>
	);
}
