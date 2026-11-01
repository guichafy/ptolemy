import { cn } from "@/lib/utils";
import { agentForProviderId } from "../providers/agent-sessions";
import { useProvider } from "../providers/provider-context";

export function ModeBar() {
	const { providers, activeProvider, activeIndex, setIndex } = useProvider();

	return (
		<div className="flex items-center gap-1 px-3 py-2 border-b border-white/[0.04] bg-black/[0.18]">
			{providers.map((provider, i) => (
				<button
					type="button"
					key={provider.id}
					onClick={() => setIndex(i)}
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
				{agentForProviderId(activeProvider.id) ? "navegar" : "trocar"}
			</span>
		</div>
	);
}
