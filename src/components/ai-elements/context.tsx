/**
 * AI Elements `Context`: how much of the model's context window the
 * conversation occupies, as a ring + percentage trigger with a hover card
 * breaking the tokens down. Ported from https://github.com/vercel/ai-elements
 * (`context.tsx`). Upstream prices tokens with `tokenlens`; here the cost
 * comes from the agent itself (Claude reports it, Codex does not), so the
 * footer shows it only when known. Labels are pt-BR.
 */

import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const ICON_RADIUS = 10;
const ICON_VIEWBOX = 24;
const ICON_CENTER = 12;
const ICON_STROKE_WIDTH = 2.5;
/** Above this share of the window the gauge turns amber, then red. */
const WARN_AT = 0.7;
const DANGER_AT = 0.9;

export interface ContextUsageBreakdown {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheCreationTokens?: number;
	reasoningTokens?: number;
}

interface ContextSchema {
	usedTokens: number;
	/** Unknown for some models: the gauge then shows absolute tokens only. */
	maxTokens?: number;
	usage?: ContextUsageBreakdown;
	/** Human label of the model the numbers belong to. */
	modelLabel?: string;
	costUsd?: number;
}

const ContextContext = createContext<ContextSchema | null>(null);

const useContextValue = () => {
	const context = useContext(ContextContext);
	if (!context) {
		throw new Error("Context components must be used within Context");
	}
	return context;
};

const compact = new Intl.NumberFormat("pt-BR", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const percent = new Intl.NumberFormat("pt-BR", {
	maximumFractionDigits: 1,
	style: "percent",
});
const usd = new Intl.NumberFormat("pt-BR", {
	currency: "USD",
	style: "currency",
	maximumFractionDigits: 4,
});

export const formatTokens = (tokens: number) => compact.format(tokens);

function ratio(used: number, max?: number): number | null {
	if (!max || max <= 0) return null;
	return Math.min(1, Math.max(0, used / max));
}

function levelClass(r: number | null): string {
	if (r === null) return "text-muted-foreground";
	if (r >= DANGER_AT) return "text-red-500";
	if (r >= WARN_AT) return "text-amber-500";
	return "text-muted-foreground";
}

export type ContextProps = ComponentProps<typeof HoverCard> & ContextSchema;

export const Context = ({
	usedTokens,
	maxTokens,
	usage,
	modelLabel,
	costUsd,
	...props
}: ContextProps) => {
	const contextValue = useMemo(
		() => ({ costUsd, maxTokens, modelLabel, usage, usedTokens }),
		[costUsd, maxTokens, modelLabel, usage, usedTokens],
	);

	return (
		<ContextContext.Provider value={contextValue}>
			<HoverCard closeDelay={0} openDelay={0} {...props} />
		</ContextContext.Provider>
	);
};

export const ContextIcon = ({ className }: { className?: string }) => {
	const { usedTokens, maxTokens } = useContextValue();
	const circumference = 2 * Math.PI * ICON_RADIUS;
	const used = ratio(usedTokens, maxTokens) ?? 0;
	const dashOffset = circumference * (1 - used);

	return (
		<svg
			aria-label="Uso da janela de contexto"
			className={className}
			height="16"
			role="img"
			style={{ color: "currentcolor" }}
			viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
			width="16"
		>
			<circle
				cx={ICON_CENTER}
				cy={ICON_CENTER}
				fill="none"
				opacity="0.25"
				r={ICON_RADIUS}
				stroke="currentColor"
				strokeWidth={ICON_STROKE_WIDTH}
			/>
			<circle
				cx={ICON_CENTER}
				cy={ICON_CENTER}
				fill="none"
				opacity="0.9"
				r={ICON_RADIUS}
				stroke="currentColor"
				strokeDasharray={`${circumference} ${circumference}`}
				strokeDashoffset={dashOffset}
				strokeLinecap="round"
				strokeWidth={ICON_STROKE_WIDTH}
				style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
			/>
		</svg>
	);
};

export type ContextTriggerProps = ComponentProps<typeof Button>;

export const ContextTrigger = ({
	children,
	className,
	...props
}: ContextTriggerProps) => {
	const { usedTokens, maxTokens } = useContextValue();
	const r = ratio(usedTokens, maxTokens);
	const label = r === null ? formatTokens(usedTokens) : percent.format(r);

	return (
		<HoverCardTrigger asChild>
			{children ?? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className={cn(
						"h-7 gap-1.5 px-2 font-medium tabular-nums",
						levelClass(r),
						className,
					)}
					aria-label={`Contexto usado: ${label}`}
					{...props}
				>
					<span className="text-xs">{label}</span>
					<ContextIcon />
				</Button>
			)}
		</HoverCardTrigger>
	);
};

export type ContextContentProps = ComponentProps<typeof HoverCardContent>;

export const ContextContent = ({
	className,
	...props
}: ContextContentProps) => (
	<HoverCardContent
		className={cn("w-72 divide-y overflow-hidden p-0", className)}
		{...props}
	/>
);

export type ContextContentHeaderProps = ComponentProps<"div">;

export const ContextContentHeader = ({
	children,
	className,
	...props
}: ContextContentHeaderProps) => {
	const { usedTokens, maxTokens, modelLabel } = useContextValue();
	const r = ratio(usedTokens, maxTokens);

	return (
		<div className={cn("w-full space-y-2 p-3", className)} {...props}>
			{children ?? (
				<>
					<div className="flex items-center justify-between gap-3 text-xs">
						<p className="whitespace-nowrap font-medium">
							{r === null ? "Contexto" : `${percent.format(r)} do contexto`}
						</p>
						<p className="whitespace-nowrap font-mono text-muted-foreground">
							{formatTokens(usedTokens)}
							{maxTokens ? ` / ${formatTokens(maxTokens)}` : " tokens"}
						</p>
					</div>
					{r !== null && (
						<Progress
							className="h-1.5 bg-muted"
							indicatorClassName={cn(
								r >= DANGER_AT
									? "bg-red-500"
									: r >= WARN_AT
										? "bg-amber-500"
										: "bg-foreground/70",
							)}
							value={r * 100}
						/>
					)}
					{modelLabel && (
						<p className="truncate text-[11px] text-muted-foreground">
							{modelLabel}
						</p>
					)}
				</>
			)}
		</div>
	);
};

export type ContextContentBodyProps = ComponentProps<"div">;

export const ContextContentBody = ({
	children,
	className,
	...props
}: ContextContentBodyProps) => (
	<div className={cn("w-full space-y-1.5 p-3", className)} {...props}>
		{children}
	</div>
);

function UsageRow({
	label,
	tokens,
	className,
	children,
	...props
}: ComponentProps<"div"> & { label: string; tokens?: number }) {
	if (children) return <>{children}</>;
	if (!tokens) return null;
	return (
		<div
			className={cn("flex items-center justify-between text-xs", className)}
			{...props}
		>
			<span className="text-muted-foreground">{label}</span>
			<span className="font-mono">{formatTokens(tokens)}</span>
		</div>
	);
}

type UsageRowProps = ComponentProps<"div">;

export const ContextInputUsage = (props: UsageRowProps) => {
	const { usage } = useContextValue();
	return <UsageRow label="Entrada" tokens={usage?.inputTokens} {...props} />;
};

export const ContextOutputUsage = (props: UsageRowProps) => {
	const { usage } = useContextValue();
	return <UsageRow label="Saída" tokens={usage?.outputTokens} {...props} />;
};

export const ContextReasoningUsage = (props: UsageRowProps) => {
	const { usage } = useContextValue();
	return (
		<UsageRow label="Raciocínio" tokens={usage?.reasoningTokens} {...props} />
	);
};

export const ContextCacheUsage = (props: UsageRowProps) => {
	const { usage } = useContextValue();
	const cache =
		(usage?.cacheReadTokens ?? 0) + (usage?.cacheCreationTokens ?? 0);
	return <UsageRow label="Cache" tokens={cache} {...props} />;
};

export type ContextContentFooterProps = ComponentProps<"div"> & {
	label?: ReactNode;
};

export const ContextContentFooter = ({
	children,
	className,
	label = "Custo do último turno",
	...props
}: ContextContentFooterProps) => {
	const { costUsd } = useContextValue();
	if (!children && costUsd === undefined) return null;

	return (
		<div
			className={cn(
				"flex w-full items-center justify-between gap-3 bg-secondary p-3 text-xs",
				className,
			)}
			{...props}
		>
			{children ?? (
				<>
					<span className="text-muted-foreground">{label}</span>
					<span className="font-mono">{usd.format(costUsd ?? 0)}</span>
				</>
			)}
		</div>
	);
};
