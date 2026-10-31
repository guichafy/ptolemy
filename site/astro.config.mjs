// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
	site: "https://guichafy.github.io",
	base: "/ptolemy",
	trailingSlash: "ignore",
	build: {
		assets: "_assets",
	},
	vite: {
		plugins: [tailwindcss()],
	},
});
