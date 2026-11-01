import {
	BotIcon,
	CheckCircle2Icon,
	CircleIcon,
	FilePenIcon,
	FileTextIcon,
	GlobeIcon,
	ListTodoIcon,
	LoaderCircleIcon,
	PlugIcon,
	SearchIcon,
	SquareTerminalIcon,
	WrenchIcon,
} from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import { Source, Sources } from "@/components/ai-elements/sources";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
	type ToolState,
} from "@/components/ai-elements/tool";
import { cn } from "@/lib/utils";
import type { AgentToolPart } from "../../hooks/agent-state";
import { describeTool, type ToolIconKind } from "../../lib/tool-display";

const ICONS: Record<ToolIconKind, ReactNode> = {
	terminal: <SquareTerminalIcon />,
	"file-read": <FileTextIcon />,
	"file-edit": <FilePenIcon />,
	search: <SearchIcon />,
	web: <GlobeIcon />,
	todo: <ListTodoIcon />,
	agent: <BotIcon />,
	mcp: <PlugIcon />,
	generic: <WrenchIcon />,
};

export function toolState(
	status: AgentToolPart["status"],
	awaitingApproval = false,
): ToolState {
	if (awaitingApproval) return "approval-requested";
	switch (status) {
		case "pending":
			return "input-streaming";
		case "running":
			return "input-available";
		case "completed":
			return "output-available";
		case "error":
			return "output-error";
	}
}

function isUrlList(
	value: unknown,
): value is Array<{ url: string; title?: string }> {
	if (!Array.isArray(value)) return false;
	return value.every(
		(item) =>
			item &&
			typeof item === "object" &&
			typeof (item as { url?: unknown }).url === "string",
	);
}

function extractSources(
	part: AgentToolPart,
): Array<{ url: string; title?: string }> | null {
	if (part.toolName !== "WebSearch" && part.toolName !== "WebFetch")
		return null;
	const result = part.result;
	if (!result) return null;
	if (isUrlList(result)) return result;
	if (typeof result === "object" && result !== null) {
		const maybe = (result as { results?: unknown }).results;
		if (isUrlList(maybe)) return maybe;
	}
	return null;
}

interface TodoItem {
	content: string;
	status?: string;
}

function extractTodos(part: AgentToolPart): TodoItem[] | null {
	if (part.toolName !== "TodoWrite") return null;
	const todos = (part.args as { todos?: unknown } | undefined)?.todos;
	if (!Array.isArray(todos)) return null;
	return todos
		.map((t) => ({
			content: String(
				(t as { content?: unknown; text?: unknown }).content ??
					(t as { text?: unknown }).text ??
					"",
			),
			status: (t as { status?: string }).status,
		}))
		.filter((t) => t.content);
}

function TodoList({ items }: { items: TodoItem[] }) {
	return (
		<ul className="space-y-1.5 text-xs">
			{items.map((item, i) => (
				<li
					// biome-ignore lint/suspicious/noArrayIndexKey: plan items have no id
					key={i}
					className={cn(
						"flex items-start gap-2",
						item.status === "completed" && "text-muted-foreground line-through",
					)}
				>
					{item.status === "completed" ? (
						<CheckCircle2Icon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
					) : item.status === "in_progress" ? (
						<LoaderCircleIcon className="mt-0.5 size-3.5 shrink-0 animate-spin text-sky-500" />
					) : (
						<CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
					)}
					<span>{item.content}</span>
				</li>
			))}
		</ul>
	);
}

function ToolBody({ part }: { part: AgentToolPart }) {
	const todos = extractTodos(part);
	if (todos) return <TodoList items={todos} />;

	const input = part.args !== undefined ? part.args : part.argsStreaming;
	const sources = extractSources(part);
	const output =
		part.status === "error" ? undefined : sources ? (
			<Sources>
				{sources.map((s) => (
					<Source key={s.url} href={s.url} title={s.title}>
						{s.title ?? undefined}
					</Source>
				))}
			</Sources>
		) : (
			part.result
		);

	return (
		<>
			<ToolInput input={input} />
			<ToolOutput
				output={output}
				errorText={
					part.status === "error"
						? (part.error?.message ?? "Falha na ferramenta")
						: undefined
				}
			/>
		</>
	);
}

export const ToolBlock = memo(function ToolBlock({
	part,
	awaitingApproval,
}: {
	part: AgentToolPart;
	awaitingApproval?: boolean;
}) {
	// Errors start open; plans start open so the checklist is visible.
	const [open, setOpen] = useState(
		part.status === "error" || part.toolName === "TodoWrite",
	);
	const display = describeTool(part.toolName, part.args);
	const elapsed =
		typeof part.elapsedSeconds === "number" && part.elapsedSeconds > 0
			? `${part.elapsedSeconds.toFixed(1)}s`
			: undefined;

	return (
		<Tool open={open} onOpenChange={setOpen}>
			<ToolHeader
				title={display.title}
				subtitle={display.subtitle}
				icon={ICONS[display.icon]}
				state={toolState(part.status, awaitingApproval)}
				meta={elapsed}
			/>
			{/* Mount the body only when open: tool outputs can be huge. */}
			{open && (
				<ToolContent>
					<ToolBody part={part} />
				</ToolContent>
			)}
		</Tool>
	);
});
