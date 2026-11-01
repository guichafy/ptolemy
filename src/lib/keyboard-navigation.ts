import type { KeyboardEvent } from "react";

/** Arrow navigation for vertical option groups; text fields keep editing keys. */
export function navigateOptions(event: KeyboardEvent<HTMLElement>) {
	if (
		event.defaultPrevented ||
		event.nativeEvent.isComposing ||
		event.nativeEvent.keyCode === 229 ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey
	)
		return;
	const target = event.target;
	if (
		!(target instanceof HTMLElement) ||
		target.matches(
			"input:not([type=checkbox]), textarea, [contenteditable=true]",
		)
	)
		return;
	if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
	const items = Array.from(
		event.currentTarget.querySelectorAll<HTMLElement>(
			"button:not(:disabled), input[type=checkbox]:not(:disabled)",
		),
	);
	if (!items.length) return;
	const index = items.findIndex(
		(item) => item === target || item.contains(target),
	);
	const next =
		event.key === "Home"
			? 0
			: event.key === "End"
				? items.length - 1
				: (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
					items.length;
	event.preventDefault();
	event.stopPropagation();
	items[next].focus();
}
