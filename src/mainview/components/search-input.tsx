import { Search } from "lucide-react";
import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { useWindowShown } from "../hooks/use-window-shown";

interface SearchInputProps {
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
}

export function SearchInput({
	placeholder,
	value,
	onChange,
}: SearchInputProps) {
	const inputRef = useRef<HTMLInputElement>(null);

	// `autoFocus` covers only the initial mount; the palette window is hidden
	// (orderOut) and re-shown without remounting React. The hook fires when
	// the native windowDidBecomeKey: notification arrives — at that moment
	// the WKWebView is firstResponder and DOM .focus() takes effect.
	useWindowShown(() => {
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		el.select();
	});

	return (
		<div className="relative flex flex-1 items-center">
			<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-primary" />
			<Input
				data-palette-search
				ref={inputRef}
				type="text"
				placeholder={placeholder}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.metaKey && e.key === "a") {
						e.currentTarget.select();
					}
				}}
				className="h-12 border-0 bg-transparent pl-10 text-[18px] font-normal tracking-[-0.005em] caret-primary shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/60"
				autoFocus={!document.activeElement?.closest('[role="tablist"]')}
				// Disable WebKit's autofill suggestion panel. It renders in a
				// separate NSPanel that floats over the palette window — when
				// visible, ⌘⇧Espaço is captured by that panel instead of our
				// Carbon hotkey, leaving the palette stuck open. A command-
				// palette input has no business remembering past queries
				// anyway.
				autoComplete="off"
				autoCorrect="off"
				autoCapitalize="off"
				spellCheck={false}
			/>
		</div>
	);
}
