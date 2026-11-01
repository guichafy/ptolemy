/**
 * AI Elements `Conversation`: scroll container that sticks to the bottom
 * while content streams, with a jump-to-bottom button once the user scrolls
 * up. Ported from https://github.com/vercel/ai-elements (`conversation.tsx`),
 * built on `use-stick-to-bottom` (ResizeObserver-driven, so streaming does
 * not force a layout read on every DOM mutation).
 */

import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
	<StickToBottom
		className={cn("relative min-h-0 flex-1 overflow-y-hidden", className)}
		initial="instant"
		resize="smooth"
		role="log"
		{...props}
	/>
);

export type ConversationContentProps = ComponentProps<
	typeof StickToBottom.Content
>;

export const ConversationContent = ({
	className,
	...props
}: ConversationContentProps) => (
	<StickToBottom.Content
		className={cn("flex flex-col gap-8 p-4", className)}
		{...props}
	/>
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
	title?: string;
	description?: string;
	icon?: ReactNode;
};

export const ConversationEmptyState = ({
	className,
	title = "Nenhuma mensagem ainda",
	description = "Comece a conversa para ver as mensagens aqui",
	icon,
	children,
	...props
}: ConversationEmptyStateProps) => (
	<div
		className={cn(
			"flex size-full flex-col items-center justify-center gap-3 p-8 text-center",
			className,
		)}
		{...props}
	>
		{children ?? (
			<>
				{icon && <div className="text-muted-foreground">{icon}</div>}
				<div className="space-y-1">
					<h3 className="font-medium text-sm">{title}</h3>
					{description && (
						<p className="text-muted-foreground text-sm">{description}</p>
					)}
				</div>
			</>
		)}
	</div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
	className,
	...props
}: ConversationScrollButtonProps) => {
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();

	const handleScrollToBottom = useCallback(() => {
		scrollToBottom();
	}, [scrollToBottom]);

	return (
		!isAtBottom && (
			<Button
				aria-label="Ir para o fim da conversa"
				className={cn(
					"absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full bg-background shadow-md hover:bg-muted",
					className,
				)}
				onClick={handleScrollToBottom}
				size="icon"
				type="button"
				variant="outline"
				{...props}
			>
				<ArrowDownIcon className="size-4" />
			</Button>
		)
	);
};
