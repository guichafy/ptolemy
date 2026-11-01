import { CheckIcon, CopyIcon } from "lucide-react";
import { memo, useCallback, useState } from "react";
import {
	Message,
	MessageAction,
	MessageActions,
	MessageContent,
} from "@/components/ai-elements/message";
import type { ProtocolModelInfo } from "@/shared/agent-protocol";
import type {
	AgentMessage,
	AgentMessageMeta,
	AgentPart,
} from "../../hooks/agent-state";
import { describeModel } from "../../lib/model-label";
import { MessagePart } from "./message-parts";

function partKey(message: AgentMessage, part: AgentPart, index: number) {
	switch (part.kind) {
		case "text":
		case "reasoning":
			// Stored messages reuse the message id for every part; the index
			// keeps sibling keys unique.
			return `${message.id}:${part.kind}:${part.messageId}:${index}`;
		case "tool":
			return `${message.id}:tool:${part.toolCallId}`;
	}
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
	const seconds = ms / 1000;
	if (seconds < 60) {
		return `${seconds.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s`;
	}
	const minutes = Math.floor(seconds / 60);
	const rest = Math.round(seconds % 60);
	return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

export function formatCost(usd: number): string {
	return new Intl.NumberFormat("pt-BR", {
		currency: "USD",
		style: "currency",
		maximumFractionDigits: usd < 0.01 ? 4 : 2,
	}).format(usd);
}

function metaParts(
	meta: AgentMessageMeta | undefined,
	models: ProtocolModelInfo[],
): { text: string; title?: string }[] {
	if (!meta) return [];
	const out: { text: string; title?: string }[] = [];
	if (meta.model) {
		const label = describeModel(meta.model, meta.model, models);
		out.push({ text: label?.primary ?? meta.model, title: meta.model });
	}
	if (typeof meta.durationMs === "number" && meta.durationMs > 0) {
		out.push({ text: formatDuration(meta.durationMs) });
	}
	if (typeof meta.costUsd === "number" && meta.costUsd > 0) {
		out.push({ text: formatCost(meta.costUsd) });
	}
	return out;
}

function messageText(message: AgentMessage): string {
	return message.parts
		.filter(
			(p): p is Extract<AgentPart, { kind: "text" }> =>
				p.kind === "text" && p.parentToolCallId === null,
		)
		.map((p) => p.text)
		.join("\n\n")
		.trim();
}

function CopyAction({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const onCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch (err) {
			console.warn("[chat] copy failed:", err);
		}
	}, [text]);
	return (
		<MessageAction
			tooltip={copied ? "Copiado" : "Copiar resposta"}
			onClick={onCopy}
		>
			{copied ? <CheckIcon /> : <CopyIcon />}
		</MessageAction>
	);
}

export interface AgentMessageViewProps {
	message: AgentMessage;
	models: ProtocolModelInfo[];
	/** True for the in-flight message: hides the actions row. */
	isStreaming?: boolean;
	/** Tool calls blocked on a permission prompt. */
	awaitingToolIds?: ReadonlySet<string>;
}

/**
 * One turn of the conversation. Memoized on the message object: the reducer
 * only replaces the object of the message that changed, so a streaming delta
 * re-renders the in-flight reply and nothing else.
 */
export const AgentMessageView = memo(function AgentMessageView({
	message,
	models,
	isStreaming = false,
	awaitingToolIds,
}: AgentMessageViewProps) {
	if (message.role === "user") {
		const override = message.modelUsed
			? describeModel(message.modelUsed, null, models)?.primary
			: null;
		return (
			<Message from="user">
				<MessageContent>
					{message.parts.map((part, i) => (
						<MessagePart key={partKey(message, part, i)} part={part} />
					))}
				</MessageContent>
				{override && (
					<span className="text-[10px] text-muted-foreground">
						Modelo deste turno: {override}
					</span>
				)}
			</Message>
		);
	}

	const text = messageText(message);
	const meta = metaParts(message.meta, models);
	const showActions = !isStreaming && (text || meta.length > 0);

	return (
		<Message from="assistant">
			<MessageContent>
				{message.parts.map((part, i) => (
					<MessagePart
						key={partKey(message, part, i)}
						part={part}
						awaitingApproval={
							part.kind === "tool" && awaitingToolIds?.has(part.toolCallId)
						}
					/>
				))}
			</MessageContent>
			{showActions && (
				<MessageActions className="-ml-1 opacity-70 transition-opacity group-hover:opacity-100">
					{text && <CopyAction text={text} />}
					{meta.length > 0 && (
						<span className="ml-1 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-foreground">
							{meta.map((m, i) => (
								<span key={m.text} title={m.title} className="truncate">
									{i > 0 && <span className="mr-1.5 opacity-50">·</span>}
									{m.text}
								</span>
							))}
						</span>
					)}
				</MessageActions>
			)}
		</Message>
	);
});
