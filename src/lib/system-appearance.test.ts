import { beforeEach, expect, it, vi } from "vitest";
import { subscribeSystemAppearance } from "./system-appearance";

let dark = false;
let listeners: Set<() => void>;
beforeEach(() => {
	dark = false;
	listeners = new Set();
	document.documentElement.className = "";
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({
			get matches() {
				return dark;
			},
			addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
			removeEventListener: (_type: string, fn: () => void) =>
				listeners.delete(fn),
		})),
	});
});
it("inherits light initially and reacts to the OS changing to dark", () => {
	const cleanup = subscribeSystemAppearance();
	expect(document.documentElement.classList.contains("dark")).toBe(false);
	expect(document.documentElement.style.colorScheme).toBe("light");
	dark = true;
	for (const fn of listeners) fn();
	expect(document.documentElement.classList.contains("dark")).toBe(true);
	expect(document.documentElement.style.colorScheme).toBe("dark");
	cleanup();
});
it("inherits dark immediately and cleans up its listener", () => {
	dark = true;
	const cleanup = subscribeSystemAppearance();
	expect(document.documentElement.classList.contains("dark")).toBe(true);
	expect(listeners.size).toBe(1);
	cleanup();
	expect(listeners.size).toBe(0);
});
