/**
 * AI Elements `Shimmer`: animated text for "thinking" / "running" states.
 * Ported from https://github.com/vercel/ai-elements (`shimmer.tsx`). The
 * upstream version animates with `motion`; this one uses a CSS keyframe
 * (`ai-shimmer` in the chat stylesheet) so the chat bundle does not pull an
 * animation library for one effect. Same props.
 */

import type { CSSProperties, ElementType } from "react";
import { memo } from "react";
import { cn } from "@/lib/utils";

export interface TextShimmerProps {
	children: string;
	as?: ElementType;
	className?: string;
	/** Seconds per sweep. */
	duration?: number;
	/** Highlight width per character, in px. */
	spread?: number;
}

const ShimmerComponent = ({
	children,
	as: Component = "p",
	className,
	duration = 2,
	spread = 2,
}: TextShimmerProps) => (
	<Component
		data-slot="shimmer"
		className={cn(
			"relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent [background-repeat:no-repeat,padding-box]",
			"motion-safe:animate-[ai-shimmer_var(--shimmer-duration)_linear_infinite]",
			className,
		)}
		style={
			{
				"--spread": `${(children?.length ?? 0) * spread}px`,
				"--shimmer-duration": `${duration}s`,
				backgroundImage:
					"linear-gradient(90deg, #0000 calc(50% - var(--spread)), var(--color-background), #0000 calc(50% + var(--spread))), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
			} as CSSProperties
		}
	>
		{children}
	</Component>
);

export const Shimmer = memo(ShimmerComponent);
