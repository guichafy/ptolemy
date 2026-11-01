import { useRef } from "react";
import { cn } from "@/lib/utils";
import { useProvider } from "../providers/provider-context";

export function ModeBar() {
	const { providers, activeIndex, setIndex } = useProvider();
	const tabs = useRef<(HTMLButtonElement | null)[]>([]);

	return (
		<div
			role="tablist"
			aria-label="Plugins"
			className="flex items-center gap-1 px-3 py-2 border-b border-white/[0.04] bg-black/[0.18]"
		>
			{providers.map((provider, i) => (
				<button
					type="button"
					key={provider.id}
					ref={(node) => {
						tabs.current[i] = node;
					}}
					role="tab"
					id={`plugin-tab-${provider.id}`}
					aria-controls={`plugin-panel-${provider.id}`}
					aria-selected={i === activeIndex}
					tabIndex={i === activeIndex ? 0 : -1}
					onClick={() => setIndex(i)}
					onKeyDown={(event) => {
						if (
							event.altKey ||
							event.ctrlKey ||
							event.metaKey ||
							event.shiftKey ||
							event.nativeEvent.isComposing
						)
							return;
						let next: number;
						if (event.key === "ArrowRight") next = (i + 1) % providers.length;
						else if (event.key === "ArrowLeft")
							next = (i - 1 + providers.length) % providers.length;
						else if (event.key === "Home") next = 0;
						else if (event.key === "End") next = providers.length - 1;
						else return;
						event.preventDefault();
						event.stopPropagation();
						setIndex(next);
						tabs.current[next]?.focus();
					}}
					className={cn(
						"flex items-center gap-1.5 h-6 px-2.5 rounded-md text-[12px] leading-none transition-colors cursor-pointer",
						i === activeIndex
							? "bg-accent text-accent-foreground font-medium ring-1 ring-inset ring-primary/25"
							: "text-muted-foreground hover:bg-white/[0.035] hover:text-foreground",
					)}
				>
					<provider.icon className="h-3.5 w-3.5" />
					{provider.label}
				</button>
			))}
			<span className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
				<kbd className="mx-0.5 inline-block rounded border border-white/[0.06] bg-black/30 px-1 py-0.5 text-[10px] font-medium text-foreground/80">
					Tab
				</kbd>
				navegar · ⌃Tab trocar
			</span>
		</div>
	);
}
