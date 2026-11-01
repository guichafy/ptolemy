import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		globals: true,
		exclude: ["test/e2e/**", "node_modules/**", "site/**"],
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov", "html"],
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.test.{ts,tsx}",
				"src/**/*.d.ts",
				"src/**/main.tsx",
				"src/**/index.html",
				"src/bun/vitest.setup.ts",
				"src/mainview/vitest.setup.ts",
			],
			// Baseline thresholds lock in current coverage so regressions fail CI.
			// Raise these as more tests land (target: lines/statements 60%).
			thresholds: {
				lines: 30,
				functions: 25,
				branches: 28,
				statements: 30,
			},
		},
		projects: [
			{
				extends: true,
				test: {
					name: "node",
					environment: "node",
					include: [
						"src/bun/**/*.test.{ts,tsx}",
						"src/chatview/lib/**/*.test.{ts,tsx}",
						"src/chatview/hooks/**/*.test.{ts,tsx}",
						"scripts/**/*.test.ts",
					],
					setupFiles: ["src/bun/vitest.setup.ts"],
				},
			},
			{
				extends: true,
				test: {
					name: "jsdom",
					environment: "jsdom",
					include: [
						"src/mainview/**/*.test.{ts,tsx}",
						"src/chatview/components/**/*.test.{ts,tsx}",
						"src/components/**/*.test.{ts,tsx}",
						"src/lib/**/*.test.{ts,tsx}",
					],
					setupFiles: ["src/mainview/vitest.setup.ts"],
				},
			},
		],
	},
});
