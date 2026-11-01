import { ChevronDownIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatTokens } from "@/components/ai-elements/context";
import { Button } from "@/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
	ContextBreakdown,
	ContextDetailSection,
	SessionStats,
} from "@/shared/agent-protocol";
import { formatModelId } from "../lib/model-label";
import { rpc } from "../rpc";

/** Distinct, theme-neutral slice colors (work on both light and dark). */
const SLICE_COLORS = [
	"bg-sky-500",
	"bg-violet-500",
	"bg-amber-500",
	"bg-emerald-500",
	"bg-rose-500",
	"bg-slate-300",
	"bg-fuchsia-500",
	"bg-lime-500",
	"bg-orange-500",
	"bg-teal-500",
];

const percent = new Intl.NumberFormat("pt-BR", {
	maximumFractionDigits: 1,
	style: "percent",
});

const usd = (v: number) =>
	new Intl.NumberFormat("pt-BR", {
		currency: "USD",
		style: "currency",
		maximumFractionDigits: v < 1 ? 4 : 2,
	}).format(v);

const dateTime = (iso: string) => {
	const d = new Date(iso);
	return Number.isNaN(d.getTime())
		? iso
		: d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

export function describeCompactions(stats: SessionStats | null): string {
	if (!stats || stats.compactions === 0) return "Nenhuma";
	const last = stats.lastCompaction;
	const parts = [
		stats.compactions === 1 ? "1 vez" : `${stats.compactions} vezes`,
	];
	if (last?.trigger)
		parts.push(last.trigger === "auto" ? "última automática" : "última manual");
	if (last?.preTokens) parts.push(`com ${formatTokens(last.preTokens)} tokens`);
	return parts.join(" · ");
}

type LoadState =
	| { status: "loading" }
	| { status: "ready"; breakdown: ContextBreakdown }
	| { status: "error"; reason: string };

function UsageBar({ breakdown }: { breakdown: ContextBreakdown }) {
	const max = breakdown.maxTokens ?? breakdown.usedTokens;
	const slices = breakdown.categories.filter((c) => !c.isDeferred);
	const threshold =
		breakdown.autoCompactThreshold && max
			? Math.min(1, breakdown.autoCompactThreshold / max)
			: null;
	return (
		<div className="relative">
			<div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
				{slices.map((c, i) => (
					<div
						key={c.name}
						className={cn("h-full", SLICE_COLORS[i % SLICE_COLORS.length])}
						style={{ width: `${(c.tokens / max) * 100}%` }}
						title={`${c.name}: ${formatTokens(c.tokens)}`}
					/>
				))}
			</div>
			{threshold !== null && (
				<div
					className="absolute -top-1 h-5 w-0.5 rounded bg-foreground/70"
					style={{ left: `${threshold * 100}%` }}
					title={`Autocompactação em ${formatTokens(breakdown.autoCompactThreshold ?? 0)} tokens`}
				/>
			)}
		</div>
	);
}

function DetailSection({ section }: { section: ContextDetailSection }) {
	const [open, setOpen] = useState(false);
	const total = section.items.reduce((a, i) => a + i.tokens, 0);
	return (
		<Collapsible open={open} onOpenChange={setOpen} className="group/sec">
			<CollapsibleTrigger className="flex w-full items-center gap-2 py-1.5 text-left text-xs hover:text-foreground">
				<ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]/sec:rotate-180" />
				<span className="font-medium">{section.title}</span>
				<span className="flex-1" />
				<span className="font-mono text-muted-foreground">
					{formatTokens(total)}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<ul className="mb-2 ml-5 space-y-1 border-l border-border pl-3">
					{section.items.map((item) => (
						<li
							key={`${item.name}:${item.hint ?? ""}`}
							className="flex items-baseline gap-2 text-[11px]"
						>
							<span className="min-w-0 truncate" title={item.name}>
								{item.name}
							</span>
							{item.hint && (
								<span className="shrink-0 truncate text-muted-foreground">
									{item.hint}
								</span>
							)}
							<span className="flex-1" />
							<span className="shrink-0 font-mono text-muted-foreground">
								{formatTokens(item.tokens)}
							</span>
						</li>
					))}
				</ul>
			</CollapsibleContent>
		</Collapsible>
	);
}

export interface ContextDetailsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	sessionId: string | null;
	stats: SessionStats | null;
	/** Whether the agent reports cost at all (Codex does not). */
	reportsCost: boolean;
}

/**
 * "What is filling the context window": the category split (the data behind
 * Claude Code's `/context`, or an estimate for Codex), the biggest items per
 * category, plus conversation totals (cost, compactions).
 */
export function ContextDetailsDialog({
	open,
	onOpenChange,
	sessionId,
	stats,
	reportsCost,
}: ContextDetailsDialogProps) {
	const [state, setState] = useState<LoadState>({ status: "loading" });

	const load = useCallback(async () => {
		if (!sessionId) return;
		setState({ status: "loading" });
		try {
			const res = await rpc.request.agentGetContextBreakdown({ sessionId });
			setState(
				res.ok
					? { status: "ready", breakdown: res.breakdown }
					: { status: "error", reason: res.reason },
			);
		} catch (err) {
			setState({
				status: "error",
				reason: err instanceof Error ? err.message : String(err),
			});
		}
	}, [sessionId]);

	useEffect(() => {
		if (open) void load();
	}, [open, load]);

	const breakdown = state.status === "ready" ? state.breakdown : null;
	const max = breakdown?.maxTokens;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
				<DialogHeader className="shrink-0 border-b px-5 pt-5 pb-4">
					<DialogTitle className="text-base">Janela de contexto</DialogTitle>
					<DialogDescription className="text-xs">
						{breakdown?.model
							? `${formatModelId(breakdown.model)} · ${breakdown.model}`
							: "O que está ocupando o contexto desta conversa"}
					</DialogDescription>
				</DialogHeader>

				<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
					{state.status === "loading" && (
						<div className="flex items-center gap-2 py-6 text-muted-foreground text-xs">
							<LoaderCircleIcon className="size-4 animate-spin" />
							Consultando o agente...
						</div>
					)}
					{state.status === "error" && (
						<p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-xs">
							{state.reason}
						</p>
					)}

					<section className="grid grid-cols-2 gap-2">
						<div className="rounded-lg border border-border/70 px-3 py-2">
							<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
								Custo total da conversa
							</p>
							<p className="mt-0.5 font-medium text-sm tabular-nums">
								{reportsCost
									? usd(stats?.totalCostUsd ?? 0)
									: "Não informado pelo Codex"}
							</p>
						</div>
						<div className="rounded-lg border border-border/70 px-3 py-2">
							<p className="text-[10px] text-muted-foreground uppercase tracking-wide">
								Compactações
							</p>
							<p className="mt-0.5 font-medium text-sm tabular-nums">
								{stats?.compactions ?? 0}
							</p>
							{stats?.lastCompaction && (
								<p className="text-[10px] text-muted-foreground">
									Última: {dateTime(stats.lastCompaction.at)}
									{stats.lastCompaction.trigger === "auto"
										? " (automática)"
										: stats.lastCompaction.trigger === "manual"
											? " (manual)"
											: ""}
									{stats.lastCompaction.preTokens
										? `, ${formatTokens(stats.lastCompaction.preTokens)} tokens`
										: ""}
								</p>
							)}
						</div>
					</section>

					{breakdown && (
						<section className="space-y-3">
							<div className="flex items-baseline justify-between gap-3">
								<p className="font-semibold text-2xl tabular-nums">
									{max
										? percent.format(Math.min(1, breakdown.usedTokens / max))
										: formatTokens(breakdown.usedTokens)}
								</p>
								<p className="font-mono text-muted-foreground text-xs">
									{formatTokens(breakdown.usedTokens)}
									{max ? ` / ${formatTokens(max)} tokens` : " tokens"}
								</p>
							</div>
							<UsageBar breakdown={breakdown} />
							<ul className="space-y-1.5">
								{breakdown.categories.map((c, i) => (
									<li key={c.name} className="flex items-center gap-2 text-xs">
										<span
											className={cn(
												"size-2.5 shrink-0 rounded-sm",
												c.isDeferred
													? "border border-dashed border-muted-foreground"
													: SLICE_COLORS[
															breakdown.categories
																.filter((x) => !x.isDeferred)
																.indexOf(c) % SLICE_COLORS.length
														],
											)}
											data-index={i}
										/>
										<span className="min-w-0 truncate">{c.name}</span>
										<span className="flex-1" />
										<span className="font-mono text-muted-foreground">
											{formatTokens(c.tokens)}
										</span>
										<span className="w-12 text-right font-mono text-muted-foreground">
											{percent.format(
												c.tokens / (max ?? breakdown.usedTokens ?? 1),
											)}
										</span>
									</li>
								))}
							</ul>
							{breakdown.autoCompactThreshold && (
								<p className="text-[11px] text-muted-foreground">
									A marca na barra indica a autocompactação, em{" "}
									{formatTokens(breakdown.autoCompactThreshold)} tokens.
								</p>
							)}
							{breakdown.note && (
								<p className="text-[11px] text-muted-foreground">
									{breakdown.note}
								</p>
							)}
						</section>
					)}

					{breakdown && breakdown.sections.length > 0 && (
						<section className="divide-y divide-border/60 border-t pt-2">
							{breakdown.sections.map((s) => (
								<DetailSection key={s.title} section={s} />
							))}
						</section>
					)}
				</div>

				<div className="flex shrink-0 justify-end border-t px-5 py-3">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => void load()}
						disabled={state.status === "loading" || !sessionId}
					>
						<RefreshCwIcon className="size-3.5" />
						Atualizar
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
