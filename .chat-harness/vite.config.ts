import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
const mock = path.resolve(__dirname, "mock-rpc.ts");
const real = path.resolve(__dirname, "../src/chatview/rpc.ts");
export default defineConfig({
  root: __dirname,
  plugins: [{ name: "mock-rpc", enforce: "pre", async resolveId(source, importer) {
    if (!importer || !source.endsWith("rpc")) return null;
    const r = await this.resolve(source, importer, { skipSelf: true });
    return r && r.id === real ? mock : null; } }, tailwindcss(), react()],
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
  build: { outDir: path.resolve(__dirname, "dist"), emptyOutDir: true },
});
