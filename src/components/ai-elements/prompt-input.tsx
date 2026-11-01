/**
 * AI Elements `PromptInput`: composer with an auto-growing textarea and a
 * footer of tools + submit. Mirrors the structure of
 * https://github.com/vercel/ai-elements (`prompt-input.tsx`): `PromptInput`
 * › `PromptInputBody` › `PromptInputTextarea`, then `PromptInputFooter` with
 * `PromptInputTools` / `PromptInputButton` and `PromptInputSubmit`.
 *
 * Upstream also owns attachments, drag-and-drop and a provider; the chat
 * keeps those concerns in `ChatPane`, so only the layout primitives are
 * ported. The textarea grows with JS instead of `field-sizing: content`
 * because the macOS WebView (WebKit) does not support it on every version.
 */

import { ArrowUpIcon, LoaderCircleIcon, SquareIcon, XIcon } from "lucide-react";
import {
	type ComponentProps,
	type FormEvent,
	forwardRef,
	type KeyboardEvent,
	useCallback,
	useLayoutEffect,
	useRef,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PromptInputStatus = "ready" | "submitted" | "streaming" | "error";

export interface PromptInputProps extends ComponentProps<"form"> {
	onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}

export const PromptInput = forwardRef<HTMLFormElement, PromptInputProps>(
	({ className, children, onSubmit, ...props }, ref) => (
		<form
			ref={ref}
			data-slot="prompt-input"
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit?.(e);
			}}
			className={cn(
				"flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-card/60 shadow-sm transition-colors",
				"focus-within:border-ring/40 focus-within:ring-2 focus-within:ring-ring/10",
				className,
			)}
			{...props}
		>
			{children}
		</form>
	),
);
PromptInput.displayName = "PromptInput";

export const PromptInputBody = ({
	className,
	...props
}: ComponentProps<"div">) => (
	<div
		data-slot="prompt-input-body"
		className={cn("flex flex-col", className)}
		{...props}
	/>
);

export interface PromptInputTextareaProps extends ComponentProps<"textarea"> {
	/** When true, pressing Enter (without shift) submits the form. Default true. */
	submitOnEnter?: boolean;
	/** Max height in px before the textarea scrolls. */
	maxHeight?: number;
}

export const PromptInputTextarea = forwardRef<
	HTMLTextAreaElement,
	PromptInputTextareaProps
>(
	(
		{
			className,
			submitOnEnter = true,
			maxHeight = 192,
			onKeyDown,
			value,
			...props
		},
		ref,
	) => {
		const localRef = useRef<HTMLTextAreaElement | null>(null);
		const setRefs = useCallback(
			(node: HTMLTextAreaElement | null) => {
				localRef.current = node;
				if (typeof ref === "function") ref(node);
				else if (ref) ref.current = node;
			},
			[ref],
		);

		// Grow with the content (value changes include programmatic resets).
		// biome-ignore lint/correctness/useExhaustiveDependencies: value drives the height
		useLayoutEffect(() => {
			const el = localRef.current;
			if (!el) return;
			el.style.height = "auto";
			el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
			el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
		}, [value, maxHeight]);

		const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
			onKeyDown?.(e);
			if (e.defaultPrevented) return;
			// IME composition (e.g. accents on some layouts) must not submit.
			if (e.nativeEvent.isComposing) return;
			if (submitOnEnter && e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				e.currentTarget.form?.requestSubmit();
			}
		};

		return (
			<textarea
				ref={setRefs}
				rows={1}
				value={value}
				data-slot="prompt-input-textarea"
				onKeyDown={handleKeyDown}
				className={cn(
					"min-h-14 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60",
					className,
				)}
				{...props}
			/>
		);
	},
);
PromptInputTextarea.displayName = "PromptInputTextarea";

export const PromptInputFooter = forwardRef<
	HTMLDivElement,
	ComponentProps<"div">
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		data-slot="prompt-input-footer"
		className={cn("flex items-center justify-between gap-1 p-2", className)}
		{...props}
	/>
));
PromptInputFooter.displayName = "PromptInputFooter";

/** @deprecated Kept for older call sites; use `PromptInputFooter`. */
export const PromptInputToolbar = PromptInputFooter;

export const PromptInputTools = ({
	className,
	...props
}: ComponentProps<"div">) => (
	<div
		data-slot="prompt-input-tools"
		className={cn("flex min-w-0 items-center gap-1", className)}
		{...props}
	/>
);

export type PromptInputButtonProps = ComponentProps<typeof Button>;

export const PromptInputButton = forwardRef<
	HTMLButtonElement,
	PromptInputButtonProps
>(({ variant = "ghost", className, size, children, ...props }, ref) => {
	const isIconOnly =
		Array.isArray(children) === false && typeof children !== "string";
	return (
		<Button
			ref={ref}
			type="button"
			variant={variant}
			size={size ?? (isIconOnly ? "icon-sm" : "sm")}
			className={cn("shrink-0 gap-1.5 text-muted-foreground", className)}
			{...props}
		>
			{children}
		</Button>
	);
});
PromptInputButton.displayName = "PromptInputButton";

export interface PromptInputSubmitProps extends ComponentProps<typeof Button> {
	status?: PromptInputStatus;
}

export const PromptInputSubmit = forwardRef<
	HTMLButtonElement,
	PromptInputSubmitProps
>(({ status = "ready", className, children, disabled, ...props }, ref) => {
	let icon = <ArrowUpIcon className="size-4" />;
	if (status === "submitted") {
		icon = <LoaderCircleIcon className="size-4 animate-spin" />;
	} else if (status === "streaming") {
		icon = <SquareIcon className="size-3.5 fill-current" />;
	} else if (status === "error") {
		icon = <XIcon className="size-4" />;
	}
	const isBusy = status === "streaming" || status === "submitted";
	return (
		<Button
			ref={ref}
			type="submit"
			size="icon-sm"
			data-slot="prompt-input-submit"
			className={cn("shrink-0 rounded-full", className)}
			disabled={disabled}
			aria-label={isBusy ? "Parar geração" : "Enviar mensagem"}
			{...props}
		>
			{children ?? icon}
		</Button>
	);
});
PromptInputSubmit.displayName = "PromptInputSubmit";
