/**
 * Builds the real chat webview (`src/chatview`) for the screenshot E2E, with
 * one swap: `src/chatview/rpc.ts` (Electrobun transport) becomes
 * `web/ws-rpc.ts` (WebSocket to the test's bridge server).
 */
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const REPO = path.resolve(__dirname, "..", "..");
const REAL_RPC = path.join(REPO, "src", "chatview", "rpc.ts");
const WS_RPC = path.join(__dirname, "web", "ws-rpc.ts");

function swapChatRpc(): Plugin {
	return {
		name: "e2e-swap-chat-rpc",
		enforce: "pre",
		async resolveId(source, importer) {
			if (!importer || importer === WS_RPC || !source.endsWith("rpc")) {
				return null;
			}
			const resolved = await this.resolve(source, importer, {
				skipSelf: true,
			});
			return resolved?.id === REAL_RPC ? WS_RPC : null;
		},
	};
}

export default defineConfig({
	plugins: [swapChatRpc(), tailwindcss(), react()],
	root: path.join(REPO, "src", "chatview"),
	resolve: { alias: { "@": path.join(REPO, "src") } },
	logLevel: "warn",
	build: {
		outDir: path.join(__dirname, ".dist"),
		emptyOutDir: true,
		chunkSizeWarningLimit: 4000,
	},
});
