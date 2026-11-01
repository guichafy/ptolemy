import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { SearchResult } from "../providers/types";

interface ResultItemProps {
	result: SearchResult;
	isSelected: boolean;
	onSelect?: () => void;
	onFocus?: () => void;
}

export function ResultItem({
	result,
	isSelected,
	onSelect,
	onFocus,
}: ResultItemProps) {
	const ref = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		if (isSelected) {
			ref.current?.scrollIntoView({ block: "nearest" });
		}
	}, [isSelected]);

	return (
		<button
			ref={ref}
			type="button"
			data-palette-result
			onFocus={onFocus}
			className={cn(
				"group relative flex items-center gap-3 px-3 py-2.5 w-full text-left rounded-[10px] transition-colors",
				isSelected
					? "bg-white/[0.05] ring-1 ring-inset ring-primary/[0.18] shadow-[inset_3px_0_0_0_var(--primary)]"
					: "hover:bg-white/[0.025]",
			)}
			onClick={onSelect ?? result.onSelect}
		>
			{result.icon && (
				<span
					className={cn(
						"shrink-0 grid place-items-center h-[30px] w-[30px] rounded-md bg-white/[0.03] [&_svg]:h-[15px] [&_svg]:w-[15px]",
						isSelected ? "text-primary" : "text-muted-foreground",
					)}
				>
					{result.icon}
				</span>
			)}
			<div className="flex-1 min-w-0">
				<p className="text-[14px] leading-[1.25] font-medium text-foreground truncate">
					{result.title}
				</p>
				{result.subtitle && (
					<p className="text-[12px] leading-[1.3] text-muted-foreground truncate mt-0.5">
						{result.subtitle}
					</p>
				)}
			</div>
			{result.badge && (
				<span className="font-mono text-[11px] text-muted-foreground shrink-0 px-1.5 py-0.5 rounded border border-white/[0.05] bg-white/[0.04]">
					{result.badge}
				</span>
			)}
		</button>
	);
}
