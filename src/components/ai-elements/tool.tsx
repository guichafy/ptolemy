/**
 * AI Elements `Tool`: one tool call, from input to output, as a collapsible
 * card with a status badge. Ported from https://github.com/vercel/ai-elements
 * (`tool.tsx`). Upstream keys off the AI SDK's `ToolUIPart`; here the state
 * union is declared locally and the header takes an optional `subtitle`
 * (the command, path or query) so a collapsed card still says what ran.
 */

import {
	CheckCircleIcon,
	ChevronDownIcon,
	CircleIcon,
	ClockIcon,
	LoaderCircleIcon,
	WrenchIcon,
	XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { isValidElement } from "react";
import { Badge } from "@/components/ui/badge";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type ToolState =
	| "input-streaming"
	| "input-available"
	| "approval-requested"
	| "output-available"
	| "output-error"
	| "output-denied";

export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
	<Collapsible
		data-slot="tool"
		className={cn(
			"group/tool not-prose w-full overflow-hidden rounded-lg border border-border/70 bg-card/40",
			className,
		)}
		{...props}
	/>
);

const statusLabels: Record<ToolState, string> = {
	"approval-requested": "Aguardando aprovação",
	"input-available": "Executando",
	"input-streaming": "Preparando",
	"output-available": "Concluído",
	"output-denied": "Negado",
	"output-error": "Erro",
};

const statusIcons: Record<ToolState, ReactNode> = {
	"approval-requested": <ClockIcon className="size-3 text-amber-500" />,
	"input-available": (
		<LoaderCircleIcon className="size-3 animate-spin text-sky-500" />
	),
	"input-streaming": <CircleIcon className="size-3" />,
	"output-available": <CheckCircleIcon className="size-3 text-emerald-500" />,
	"output-denied": <XCircleIcon className="size-3 text-orange-500" />,
	"output-error": <XCircleIcon className="size-3 text-red-500" />,
};

export const getStatusBadge = (status: ToolState) => (
	<Badge
		className="shrink-0 gap-1 rounded-full border-transparent px-2 py-0 font-normal text-[10px] shadow-none"
		variant="secondary"
	>
		{statusIcons[status]}
		{statusLabels[status]}
	</Badge>
);

export type ToolHeaderProps = Omit<
	ComponentProps<typeof CollapsibleTrigger>,
	"title"
> & {
	title: string;
	subtitle?: string;
	state: ToolState;
	icon?: ReactNode;
	/** Extra info on the right, e.g. elapsed time. */
	meta?: ReactNode;
};

export const ToolHeader = ({
	className,
	title,
	subtitle,
	state,
	icon,
	meta,
	...props
}: ToolHeaderProps) => (
	<CollapsibleTrigger
		className={cn(
			"flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40",
			className,
		)}
		{...props}
	>
		<span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">
			{icon ?? <WrenchIcon />}
		</span>
		<span className="shrink-0 font-medium text-xs">{title}</span>
		{subtitle && (
			<span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
				{subtitle}
			</span>
		)}
		{!subtitle && <span className="flex-1" />}
		{meta && (
			<span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
				{meta}
			</span>
		)}
		{getStatusBadge(state)}
		<ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/tool:rotate-180" />
	</CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
	<CollapsibleContent
		className={cn(
			"space-y-3 border-t border-border/60 p-3 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
			className,
		)}
		{...props}
	/>
);

const sectionTitle =
	"font-medium text-[10px] text-muted-foreground uppercase tracking-wide";

export type ToolInputProps = ComponentProps<"div"> & {
	input: unknown;
};

function stringify(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

const preClass =
	"max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md p-2.5 font-mono text-[11px] leading-relaxed";

export const ToolInput = ({ className, input, ...props }: ToolInputProps) => {
	const text = stringify(input);
	if (!text) return null;
	return (
		<div className={cn("space-y-1.5 overflow-hidden", className)} {...props}>
			<h4 className={sectionTitle}>Parâmetros</h4>
			<pre className={cn(preClass, "bg-muted/50 text-foreground/90")}>
				{text}
			</pre>
		</div>
	);
};

export type ToolOutputProps = ComponentProps<"div"> & {
	output: unknown;
	errorText?: string;
};

export const ToolOutput = ({
	className,
	output,
	errorText,
	...props
}: ToolOutputProps) => {
	if (!(output || errorText)) {
		return null;
	}

	let body: ReactNode = null;
	if (errorText) {
		body = (
			<pre className={cn(preClass, "bg-destructive/10 text-destructive")}>
				{errorText}
			</pre>
		);
	} else if (isValidElement(output)) {
		body = output;
	} else {
		body = (
			<pre className={cn(preClass, "bg-muted/50 text-foreground/90")}>
				{stringify(output)}
			</pre>
		);
	}

	return (
		<div className={cn("space-y-1.5", className)} {...props}>
			<h4 className={sectionTitle}>{errorText ? "Erro" : "Resultado"}</h4>
			{body}
		</div>
	);
};
