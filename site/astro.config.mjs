// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	site: "https://guichafy.github.io",
	// GitHub Pages serves project sites at /<repo>; follow the repo name in CI
	// so a rename doesn't silently break every asset path.
	base: `/${process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "ptolemy"}`,
	trailingSlash: "ignore",
	build: {
		assets: "_assets",
	},
	vite: {
		plugins: [tailwindcss()],
	},
});
