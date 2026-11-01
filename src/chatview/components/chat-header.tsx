import { Bot, SquareTerminal } from "lucide-react";
import {
	Context,
	ContextCacheUsage,
	ContextContent,
	ContextContentBody,
	ContextContentFooter,
	ContextContentHeader,
	ContextInputUsage,
	ContextOutputUsage,
	ContextReasoningUsage,
	ContextTrigger,
} from "@/components/ai-elements/context";
import { ModelPicker } from "@/components/claude/model-picker";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
	AgentKind,
	ContextUsageInfo,
	ProtocolModelInfo,
} from "@/shared/agent-protocol";
import { describeModel } from "../lib/model-label";
import { rpc } from "../rpc";

type SessionState = "idle" | "streaming" | "tool_running" | "error";

interface ChatHeaderProps {
	/** Defaults to Claude, the agent of every pre-Codex session. */
	agent?: AgentKind;
	sessionId: string | null;
	sessionState: SessionState;
	sessionModel: string | null;
	/** Concrete model behind `sessionModel`, once the agent reported it. */
	resolvedModel?: string | null;
	contextUsage?: ContextUsageInfo | null;
	models: ProtocolModelInfo[];
}

const stateConfig: Record<
	SessionState,
	{ color: string; pulse: boolean; label: string }
> = {
	idle: { color: "bg-emerald-500", pulse: false, label: "Pronto" },
	streaming: { color: "bg-emerald-500", pulse: true, label: "Respondendo" },
	tool_running: {
		color: "bg-amber-500",
		pulse: true,
		label: "Aguardando aprovação",
	},
	error: { color: "bg-red-500", pulse: false, label: "Erro" },
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
	resolvedModel = null,
	contextUsage = null,
	models,
}: ChatHeaderProps) {
	const { color, pulse, label: stateLabel } = stateConfig[sessionState];
	const { title, icon: AgentIcon } = agentConfig[agent];
	const model = describeModel(sessionModel, resolvedModel, models);
	const handleChange = async (next: string) => {
		if (!sessionId) return;
		try {
			await rpc.request.claudeSetSessionModel({ sessionId, model: next });
		} catch (err) {
			console.error("[chat-header] setSessionModel failed:", err);
		}
	};

	return (
		<header className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
			<div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
				<AgentIcon className="size-3.5 text-foreground/80" />
			</div>
			<h1 className="shrink-0 font-semibold text-sm">{title}</h1>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<span
							role="status"
							aria-label={stateLabel}
							className={cn(
								"inline-block size-2 shrink-0 rounded-full",
								color,
								pulse && "animate-pulse",
							)}
						/>
					</TooltipTrigger>
					<TooltipContent>{stateLabel}</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<span className="h-4 w-px shrink-0 bg-border" />
			<div className="min-w-0">
				<ModelPicker
					variant="session"
					value={sessionModel}
					models={models}
					onChange={handleChange}
					disabled={sessionState !== "idle" || !sessionId}
					placeholder="Selecionar modelo"
					resolvedLabel={model?.isAlias ? model.primary : null}
				/>
			</div>
			<span className="flex-1" />
			{contextUsage && contextUsage.usedTokens > 0 && (
				<Context
					usedTokens={contextUsage.usedTokens}
					maxTokens={contextUsage.maxTokens}
					usage={contextUsage}
					modelLabel={
						model?.resolvedId
							? `${model.primary} · ${model.resolvedId}`
							: model?.primary
					}
					costUsd={contextUsage.lastTurnCostUsd}
				>
					<ContextTrigger />
					<ContextContent align="end">
						<ContextContentHeader />
						<ContextContentBody>
							<ContextInputUsage />
							<ContextCacheUsage />
							<ContextOutputUsage />
							<ContextReasoningUsage />
						</ContextContentBody>
						<ContextContentFooter />
					</ContextContent>
				</Context>
			)}
			{sessionId && (
				<span
					className="shrink-0 font-mono text-[10px] text-muted-foreground/60"
					title={sessionId}
				>
					{sessionId.slice(0, 8)}
				</span>
			)}
		</header>
	);
}
