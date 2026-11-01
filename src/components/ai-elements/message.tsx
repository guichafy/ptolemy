/**
 * AI Elements `Message` family. Ported from
 * https://github.com/vercel/ai-elements (`message.tsx`): the user turn is a
 * bubble on the right, the assistant turn is full-width prose with an actions
 * row underneath. `MessageResponse` renders markdown with Streamdown, which
 * parses the text into blocks and memoizes each one, so a streaming delta
 * only re-renders the last block instead of the whole reply.
 *
 * Branching (`MessageBranch*`) is not ported: the agents have no regenerate.
 */

import { code } from "@streamdown/code";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type MessageRole = "user" | "assistant" | "system";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: MessageRole;
};

export const Message = ({ className, from, ...props }: MessageProps) => (
	<div
		data-slot="message"
		data-role={from}
		className={cn(
			"group flex w-full flex-col gap-2",
			from === "user"
				? "is-user ml-auto max-w-[85%] items-end"
				: "is-assistant max-w-full",
			className,
		)}
		{...props}
	/>
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
	children,
	className,
	...props
}: MessageContentProps) => (
	<div
		data-slot="message-content"
		className={cn(
			"flex min-w-0 max-w-full flex-col gap-3 text-sm leading-relaxed",
			"group-[.is-user]:w-fit group-[.is-user]:rounded-2xl group-[.is-user]:rounded-br-md group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-secondary-foreground",
			"group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground",
			className,
		)}
		{...props}
	>
		{children}
	</div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
	className,
	children,
	...props
}: MessageActionsProps) => (
	<div
		data-slot="message-actions"
		className={cn("flex items-center gap-1", className)}
		{...props}
	>
		{children}
	</div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
	tooltip?: string;
	label?: string;
};

export const MessageAction = ({
	tooltip,
	children,
	label,
	variant = "ghost",
	size = "icon-xs",
	className,
	...props
}: MessageActionProps) => {
	const button = (
		<Button
			size={size}
			type="button"
			variant={variant}
			className={cn("text-muted-foreground hover:text-foreground", className)}
			{...props}
		>
			{children}
			<span className="sr-only">{label || tooltip}</span>
		</Button>
	);

	if (tooltip) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>{button}</TooltipTrigger>
					<TooltipContent>
						<p>{tooltip}</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		);
	}

	return button;
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { code };

export const MessageResponse = memo(
	({ className, ...props }: MessageResponseProps) => (
		<Streamdown
			className={cn(
				"size-full text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				className,
			)}
			plugins={streamdownPlugins}
			{...props}
		/>
	),
	(prevProps, nextProps) =>
		prevProps.children === nextProps.children &&
		prevProps.isAnimating === nextProps.isAnimating &&
		prevProps.components === nextProps.components,
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
	className,
	children,
	...props
}: MessageToolbarProps) => (
	<div
		data-slot="message-toolbar"
		className={cn("flex w-full items-center justify-between gap-4", className)}
		{...props}
	>
		{children}
	</div>
);
