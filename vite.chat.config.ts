import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function injectReactDevtools(mode: string): Plugin {
	return {
		name: "inject-react-devtools",
		apply: "build",
		transformIndexHtml: {
			order: "pre",
			handler() {
				if (mode !== "development") return;
				return [
					{
						tag: "script",
						attrs: { src: "http://localhost:8097", async: true },
						injectTo: "head-prepend",
					},
				];
			},
		},
	};
}

export default defineConfig(({ mode }) => ({
	plugins: [injectReactDevtools(mode), tailwindcss(), react()],
	root: "src/chatview",
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	build: {
		outDir: "../../dist-chat",
		emptyOutDir: mode !== "development",
		minify: mode !== "development",
		sourcemap: mode === "development" ? "inline" : false,
		chunkSizeWarningLimit: 700,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes("node_modules")) return;
					if (id.includes("@radix-ui")) return "vendor-radix";
					// Shiki grammars/themes are lazy chunks of their own; keep them
					// out of the markdown vendor chunk.
					if (id.includes("/shiki/") || id.includes("@shikijs")) return;
					if (
						id.includes("streamdown") ||
						id.includes("remark") ||
						id.includes("rehype") ||
						id.includes("micromark") ||
						id.includes("mdast") ||
						id.includes("hast") ||
						id.includes("unified") ||
						id.includes("/marked/")
					) {
						return "vendor-markdown";
					}
					if (
						id.includes("/react-dom/") ||
						id.includes("/react/") ||
						id.includes("/scheduler/")
					) {
						return "vendor-react";
					}
				},
			},
		},
	},
	optimizeDeps: {
		include: [
			"react",
			"react-dom/client",
			"react/jsx-runtime",
			"streamdown",
			"@streamdown/code",
			"use-stick-to-bottom",
			"lucide-react",
			"clsx",
			"tailwind-merge",
			"class-variance-authority",
			"@radix-ui/react-collapsible",
			"@radix-ui/react-scroll-area",
			"@radix-ui/react-separator",
			"@radix-ui/react-slot",
			"@radix-ui/react-tooltip",
			"radix-ui",
		],
		noDiscovery: true,
	},
	server: {
		port: 5174,
		strictPort: true,
	},
}));
