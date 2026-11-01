import type { ComponentProps } from "react";
import { memo } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import type { AgentPart } from "../../hooks/agent-state";
import { rpc } from "../../rpc";
import { ToolBlock } from "./tool-block";

type MarkdownComponents = NonNullable<
	ComponentProps<typeof MessageResponse>["components"]
>;

/**
 * Links in agent replies open in the user's browser through the main
 * process: the chat webview must not navigate away from the conversation.
 * Stable object so `MessageResponse`'s memo holds across renders.
 */
const markdownComponents: MarkdownComponents = {
	a: ({ href, children, node: _node, ...props }) => (
		<a
			{...props}
			href={href}
			className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
			onClick={(e) => {
				if (!href || href.startsWith("#")) return;
				e.preventDefault();
				rpc.request.openUrl({ url: href }).catch((err) => {
					console.warn("[chat] openUrl failed:", err);
				});
			}}
		>
			{children}
		</a>
	),
};

export const MessagePart = memo(function MessagePart({
	part,
	awaitingApproval,
}: {
	part: AgentPart;
	awaitingApproval?: boolean;
}) {
	switch (part.kind) {
		case "text":
			if (!part.text && !part.streaming) return null;
			return (
				<MessageResponse
					components={markdownComponents}
					isAnimating={part.streaming}
					caret={part.streaming ? "block" : undefined}
				>
					{part.text}
				</MessageResponse>
			);
		case "reasoning":
			if (!part.text && !part.streaming) return null;
			return (
				<Reasoning
					isStreaming={part.streaming}
					duration={
						typeof part.durationMs === "number"
							? Math.max(1, Math.round(part.durationMs / 1000))
							: undefined
					}
				>
					<ReasoningTrigger />
					<ReasoningContent>{part.text}</ReasoningContent>
				</Reasoning>
			);
		case "tool":
			return <ToolBlock part={part} awaitingApproval={awaitingApproval} />;
	}
});
