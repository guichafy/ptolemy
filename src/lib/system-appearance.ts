/** Called before React mounts; the matching head script prevents a first-paint
 * theme flash while the renderer bundle loads. Each webview owns its listener. */
export function subscribeSystemAppearance(): () => void {
	const media = window.matchMedia("(prefers-color-scheme: dark)");
	const apply = () => {
		document.documentElement.classList.toggle("dark", media.matches);
		document.documentElement.style.colorScheme = media.matches
			? "dark"
			: "light";
	};
	apply();
	media.addEventListener("change", apply);
	return () => media.removeEventListener("change", apply);
}
