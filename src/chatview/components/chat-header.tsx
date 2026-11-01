import { Bot, ChartPieIcon, SquareTerminal } from "lucide-react";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
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
	SessionStats,
} from "@/shared/agent-protocol";
import { describeModel } from "../lib/model-label";
import { ContextDetailsDialog, describeCompactions } from "./context-details";

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
	stats?: SessionStats | null;
	models: ProtocolModelInfo[];
}

const usd = (v: number) =>
	new Intl.NumberFormat("pt-BR", {
		currency: "USD",
		style: "currency",
		maximumFractionDigits: v < 1 ? 4 : 2,
	}).format(v);

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
	stats = null,
	models,
}: ChatHeaderProps) {
	const [detailsOpen, setDetailsOpen] = useState(false);
	const reportsCost = agent === "claude";
	const { color, pulse, label: stateLabel } = stateConfig[sessionState];
	const { title, icon: AgentIcon } = agentConfig[agent];
	const model = describeModel(sessionModel, resolvedModel, models);

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
					<ContextTrigger onClick={() => setDetailsOpen(true)} />
					<ContextContent align="end">
						<ContextContentHeader />
						<ContextContentBody>
							<p className="pb-0.5 text-[10px] text-muted-foreground uppercase tracking-wide">
								Última requisição
							</p>
							<ContextInputUsage />
							<ContextCacheUsage />
							<ContextOutputUsage />
							<ContextReasoningUsage />
						</ContextContentBody>
						<ContextContentBody>
							<div className="flex items-start justify-between gap-3 text-xs">
								<span className="shrink-0 text-muted-foreground">
									Compactações
								</span>
								<span className="text-right">{describeCompactions(stats)}</span>
							</div>
						</ContextContentBody>
						<ContextContentFooter>
							<div className="flex w-full flex-col gap-1">
								{reportsCost && (
									<>
										<div className="flex justify-between gap-3">
											<span className="text-muted-foreground">
												Custo do último turno
											</span>
											<span className="font-mono">
												{usd(contextUsage.lastTurnCostUsd ?? 0)}
											</span>
										</div>
										<div className="flex justify-between gap-3 font-medium">
											<span>Custo total da conversa</span>
											<span className="font-mono">
												{usd(stats?.totalCostUsd ?? 0)}
											</span>
										</div>
									</>
								)}
								{!reportsCost && (
									<span className="text-muted-foreground">
										O Codex não informa custo.
									</span>
								)}
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="mt-1.5 h-7 w-full text-xs"
									onClick={() => setDetailsOpen(true)}
								>
									<ChartPieIcon className="size-3.5" />
									Ver o que ocupa o contexto
								</Button>
							</div>
						</ContextContentFooter>
					</ContextContent>
				</Context>
			)}
			<ContextDetailsDialog
				open={detailsOpen}
				onOpenChange={setDetailsOpen}
				sessionId={sessionId}
				stats={stats}
				reportsCost={reportsCost}
			/>
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
