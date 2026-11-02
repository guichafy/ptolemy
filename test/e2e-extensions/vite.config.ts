import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const repo = path.resolve(import.meta.dirname, "../..");
const fixture = path.join(import.meta.dirname, "web/rpc.ts");
const swap: Plugin = {
	name: "extension-ui-fixture",
	enforce: "pre",
	async resolveId(source, importer) {
		if (!importer || importer === fixture || !source.endsWith("rpc"))
			return null;
		const resolved = await this.resolve(source, importer, { skipSelf: true });
		return [
			path.join(repo, "src/mainview/providers/rpc.ts"),
			path.join(repo, "src/chatview/rpc.ts"),
		].includes(resolved?.id ?? "")
			? fixture
			: null;
	},
};
export default defineConfig({
	root: path.join(import.meta.dirname, "web"),
	plugins: [swap, tailwindcss(), react()],
	resolve: { alias: { "@": path.join(repo, "src") } },
	build: {
		outDir: process.env.PTOLEMY_UI_DIST ?? "/tmp/ptolemy-extension-ui-dist",
		emptyOutDir: true,
		chunkSizeWarningLimit: 4000,
	},
});
