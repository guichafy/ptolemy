import type { KeyboardEvent } from "react";
import type { ExtensionCommandSummary } from "@/shared/extension-rpc";
/** Selection inserts a slash command. The ordinary send path resolves arguments in the backend. */
export function commandKeyDown(
	event: KeyboardEvent<HTMLTextAreaElement>,
	commands: ExtensionCommandSummary[],
	index: number,
	setIndex: (n: number) => void,
	select: (name: string) => void,
	dismiss: () => void,
) {
	if (
		!commands.length ||
		event.nativeEvent.isComposing ||
		event.nativeEvent.keyCode === 229 ||
		event.shiftKey ||
		event.altKey ||
		event.metaKey ||
		event.ctrlKey
	)
		return false;
	if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key))
		return false;
	event.preventDefault();
	event.stopPropagation();
	if (event.key === "Escape") dismiss();
	else if (event.key === "Enter" || event.key === "Tab")
		select(commands[Math.min(index, commands.length - 1)].name);
	else
		setIndex(
			(index + (event.key === "ArrowDown" ? 1 : commands.length - 1)) %
				commands.length,
		);
	return true;
}
export function CommandSuggestions({
	commands,
	index,
	onSelect,
}: {
	commands: ExtensionCommandSummary[];
	index: number;
	onSelect: (name: string) => void;
}) {
	if (!commands.length) return null;
	return (
		<div
			role="listbox"
			aria-label="Comandos da conversa"
			className="max-h-40 overflow-y-auto rounded-md border p-1"
		>
			{commands.map((command, i) => (
				<button
					type="button"
					role="option"
					aria-selected={i === Math.min(index, commands.length - 1)}
					key={command.name}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => onSelect(command.name)}
					className={`block w-full break-words rounded px-2 py-1.5 text-left text-xs ${i === index ? "bg-accent" : ""}`}
				>
					<span className="font-medium">/{command.name}</span>
					<span className="ml-2 text-muted-foreground">
						{command.description}
					</span>
				</button>
			))}
		</div>
	);
}
