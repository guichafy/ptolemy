/**
 * AI Elements `Reasoning`: collapsible thinking block that opens while the
 * model reasons and closes itself a moment after it finishes. Ported from
 * https://github.com/vercel/ai-elements (`reasoning.tsx`), labels in pt-BR.
 * `duration` is in seconds, like upstream; when the agent reports none the
 * component measures the streaming time itself.
 */

import { code } from "@streamdown/code";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
	createContext,
	memo,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Streamdown } from "streamdown";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Shimmer } from "./shimmer";

interface ReasoningContextValue {
	isStreaming: boolean;
	isOpen: boolean;
	setIsOpen: (open: boolean) => void;
	duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
	const context = useContext(ReasoningContext);
	if (!context) {
		throw new Error("Reasoning components must be used within Reasoning");
	}
	return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
	isStreaming?: boolean;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	/** Seconds spent reasoning, when known. */
	duration?: number;
};

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

export const Reasoning = memo(
	({
		className,
		isStreaming = false,
		open,
		defaultOpen,
		onOpenChange,
		duration: durationProp,
		children,
		...props
	}: ReasoningProps) => {
		const isControlled = open !== undefined;
		const [internalOpen, setInternalOpen] = useState(
			defaultOpen ?? isStreaming,
		);
		const isOpen = isControlled ? open : internalOpen;
		const isExplicitlyClosed = defaultOpen === false;

		const setIsOpen = useCallback(
			(next: boolean) => {
				if (!isControlled) setInternalOpen(next);
				onOpenChange?.(next);
			},
			[isControlled, onOpenChange],
		);

		const [measured, setMeasured] = useState<number | undefined>(undefined);
		const duration = durationProp ?? measured;

		const hasEverStreamedRef = useRef(isStreaming);
		const [hasAutoClosed, setHasAutoClosed] = useState(false);
		const startTimeRef = useRef<number | null>(null);

		useEffect(() => {
			if (isStreaming) {
				hasEverStreamedRef.current = true;
				if (startTimeRef.current === null) {
					startTimeRef.current = Date.now();
				}
			} else if (startTimeRef.current !== null) {
				setMeasured(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
				startTimeRef.current = null;
			}
		}, [isStreaming]);

		useEffect(() => {
			if (isStreaming && !isOpen && !isExplicitlyClosed) {
				setIsOpen(true);
			}
		}, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);

		useEffect(() => {
			if (
				hasEverStreamedRef.current &&
				!isStreaming &&
				isOpen &&
				!hasAutoClosed
			) {
				const timer = setTimeout(() => {
					setIsOpen(false);
					setHasAutoClosed(true);
				}, AUTO_CLOSE_DELAY);
				return () => clearTimeout(timer);
			}
		}, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);

		const contextValue = useMemo(
			() => ({ duration, isOpen, isStreaming, setIsOpen }),
			[duration, isOpen, isStreaming, setIsOpen],
		);

		return (
			<ReasoningContext.Provider value={contextValue}>
				<Collapsible
					data-slot="reasoning"
					className={cn("not-prose", className)}
					onOpenChange={setIsOpen}
					open={isOpen}
					{...props}
				>
					{children}
				</Collapsible>
			</ReasoningContext.Provider>
		);
	},
);

export type ReasoningTriggerProps = ComponentProps<
	typeof CollapsibleTrigger
> & {
	getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
	if (isStreaming || duration === 0) {
		return (
			<Shimmer as="span" duration={1}>
				Pensando...
			</Shimmer>
		);
	}
	if (duration === undefined) {
		return <span>Pensou por alguns segundos</span>;
	}
	return (
		<span>
			Pensou por {duration} {duration === 1 ? "segundo" : "segundos"}
		</span>
	);
};

export const ReasoningTrigger = memo(
	({
		className,
		children,
		getThinkingMessage = defaultGetThinkingMessage,
		...props
	}: ReasoningTriggerProps) => {
		const { isStreaming, isOpen, duration } = useReasoning();

		return (
			<CollapsibleTrigger
				className={cn(
					"flex items-center gap-2 text-muted-foreground text-xs transition-colors hover:text-foreground",
					className,
				)}
				{...props}
			>
				{children ?? (
					<>
						<BrainIcon className="size-3.5" />
						{getThinkingMessage(isStreaming, duration)}
						<ChevronDownIcon
							className={cn(
								"size-3.5 transition-transform",
								isOpen ? "rotate-180" : "rotate-0",
							)}
						/>
					</>
				)}
			</CollapsibleTrigger>
		);
	},
);

export type ReasoningContentProps = ComponentProps<
	typeof CollapsibleContent
> & {
	children: string;
};

const streamdownPlugins = { code };

export const ReasoningContent = memo(
	({ className, children, ...props }: ReasoningContentProps) => (
		<CollapsibleContent
			className={cn(
				"mt-2 border-l-2 border-border pl-3 text-muted-foreground text-xs leading-relaxed outline-none",
				"data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
				className,
			)}
			{...props}
		>
			<Streamdown plugins={streamdownPlugins}>{children}</Streamdown>
		</CollapsibleContent>
	),
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
