/**
 * Chat E2E that doubles as the screenshot generator for the site.
 *
 * Everything below the webview is real: the Bun request handlers
 * (`src/bun/rpc.ts`), the session manager, the Agent SDK and the Codex SDK,
 * and the CLIs bundled with each SDK. The CLIs talk to the local mock
 * servers of the integration suite (no network, no sign-in), so the run is
 * deterministic and works in CI.
 *
 * The webview is the real chat app (`src/chatview`) built by Vite, served by
 * a small bridge server and driven by Playwright/Chromium. The only swap is
 * the transport: Electrobun's RPC becomes a WebSocket (`web/ws-rpc.ts`).
 *
 *   bun run screenshots:chat
 *
 * PNGs go to `site/public/screenshots/` (override with
 * PTOLEMY_SCREENSHOTS_DIR). Set PTOLEMY_E2E_SKIP_BUILD=1 to reuse the last
 * webview build.
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import type { Browser, Page } from "playwright";
import type { AgentKind } from "@/shared/agent-protocol";
import { configureLocalAgents } from "../integration/helpers/local-agents";
import {
	ASK_FILE_NAME,
	createFilePrompt,
	scenarioFile,
} from "../integration/helpers/scenario";

const REPO = join(import.meta.dir, "..", "..");
const DIST = join(import.meta.dir, ".dist");
const OUT_DIR =
	process.env.PTOLEMY_SCREENSHOTS_DIR ??
	join(REPO, "site", "public", "screenshots");
const VIEWPORT = { width: 1024, height: 768 };
const TURN_TIMEOUT = 90_000;

// ---------------------------------------------------------------------------
// Environment (before importing app modules: some read paths at import time)
// ---------------------------------------------------------------------------

const TMP = await mkdtemp(join(tmpdir(), "ptolemy-e2e-chat-"));
process.env.PTOLEMY_HOME = TMP;
for (const key of ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_REMOTE_SESSION_ID"]) {
	delete process.env[key];
}
const localAgents = await configureLocalAgents(TMP, REPO);

// Electrobun's Bun runtime only loads inside the app bundle. Stand in for its
// RPC factory: every webview message the handlers send (`agentEvent`,
// `claudeSessionsUpdate`...) is forwarded to the bridge's WebSocket clients.
type ClientData = { sessionId: string | null };
const clients = new Set<ServerWebSocket<ClientData>>();
function broadcast(name: string, payload: unknown): void {
	const frame = JSON.stringify({ kind: "message", name, payload });
	for (const ws of clients) ws.send(frame);
}
mock.module("electrobun/bun", () => ({
	defineElectrobunRPC: () => ({
		request: {},
		send: new Proxy(
			{},
			{
				get: (_target, name: string) => (payload: unknown) =>
					broadcast(name, payload),
			},
		),
	}),
	Utils: {},
}));

const { requestHandlers } = await import("../../src/bun/rpc");
const { loadSettings, saveSettings } = await import("../../src/bun/settings");

type Handler = (params: unknown) => Promise<unknown> | unknown;
const handlers = requestHandlers as unknown as Record<string, Handler>;

// ---------------------------------------------------------------------------
// Bridge server: static webview + WebSocket RPC
// ---------------------------------------------------------------------------

let server: Server<ClientData> | null = null;
let browser: Browser | null = null;

function startBridge(): Server<ClientData> {
	return Bun.serve<ClientData, never>({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(req, srv) {
			const url = new URL(req.url);
			if (url.pathname === "/rpc") {
				const sessionId = url.searchParams.get("session");
				return srv.upgrade(req, { data: { sessionId } })
					? undefined
					: new Response("upgrade failed", { status: 400 });
			}
			const rel = normalize(
				url.pathname === "/" ? "index.html" : url.pathname.slice(1),
			);
			if (rel.startsWith("..")) return new Response(null, { status: 403 });
			const file = Bun.file(join(DIST, rel));
			return (await file.exists())
				? new Response(file)
				: new Response(null, { status: 404 });
		},
		websocket: {
			open(ws) {
				clients.add(ws);
				// What the main process does when it opens the chat window.
				if (ws.data.sessionId) {
					ws.send(
						JSON.stringify({
							kind: "message",
							name: "claudeOpenSession",
							payload: { sessionId: ws.data.sessionId },
						}),
					);
				}
			},
			close(ws) {
				clients.delete(ws);
			},
			async message(ws, raw) {
				const { id, method, params } = JSON.parse(String(raw)) as {
					id: number;
					method: string;
					params: unknown;
				};
				const handler = handlers[method];
				try {
					if (!handler) throw new Error(`handler desconhecido: ${method}`);
					const result = await handler(params);
					ws.send(JSON.stringify({ kind: "response", id, result }));
				} catch (err) {
					ws.send(
						JSON.stringify({
							kind: "response",
							id,
							error: err instanceof Error ? err.message : String(err),
						}),
					);
				}
			},
		},
	});
}

async function buildWebview(): Promise<void> {
	if (process.env.PTOLEMY_E2E_SKIP_BUILD === "1") return;
	const proc = Bun.spawn(
		["bunx", "vite", "build", "--config", "test/e2e-chat/vite.config.ts"],
		{ cwd: REPO, stdout: "inherit", stderr: "inherit" },
	);
	if ((await proc.exited) !== 0) throw new Error("vite build falhou");
}

beforeAll(async () => {
	const settings = await loadSettings();
	await saveSettings({
		...settings,
		claude: { ...settings.claude, model: "haiku" },
	});
	await mkdir(OUT_DIR, { recursive: true });
	await buildWebview();
	server = startBridge();
	const { chromium } = await import("playwright");
	browser = await chromium.launch();
}, 240_000);

afterAll(async () => {
	await browser?.close();
	server?.stop(true);
	localAgents.stop();
	await rm(TMP, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

/** Uncaught errors in the webview; asserted empty at the end. */
const pageErrors: string[] = [];

/** Tool card titles the chat shows for the tools each mock "model" uses. */
const TOOL_TITLES: Record<AgentKind, string[]> = {
	claude: ["Criar arquivo", "Terminal"],
	codex: ["Aplicar alterações", "Terminal"],
};

async function openChat(agent: AgentKind): Promise<Page> {
	if (!browser || !server) throw new Error("setup incompleto");
	const file = scenarioFile(agent);
	const { sessionId } = (await handlers.claudeCreateSession({
		prompt: createFilePrompt(file),
		agent,
	})) as { sessionId: string };
	const page = await browser.newPage({
		viewport: VIEWPORT,
		deviceScaleFactor: 2,
		colorScheme: "dark",
	});
	page.on("pageerror", (err) => pageErrors.push(`${agent}: ${err.message}`));
	await page.goto(`${server.url}?session=${sessionId}`);
	return page;
}

/** Waits until `count` assistant replies have their actions row. */
async function waitReplies(page: Page, count: number): Promise<void> {
	await page
		.locator('[data-slot="message-actions"]')
		.nth(count - 1)
		.waitFor({ timeout: TURN_TIMEOUT });
	// The turn indicator and the submit spinner settle right after `finish`.
	await page.waitForTimeout(600);
}

async function shoot(page: Page, name: string): Promise<void> {
	await page.screenshot({ path: join(OUT_DIR, name) });
	console.log(`[e2e-chat] ${join(OUT_DIR, name)}`);
}

function chatScenario(agent: AgentKind) {
	describe(agent, () => {
		let page: Page;

		test(
			"turno 1 e 2 renderizados com ferramentas, modelo e contexto",
			async () => {
				page = await openChat(agent);
				await waitReplies(page, 1);

				for (const title of TOOL_TITLES[agent]) {
					await expect(
						page.getByText(title, { exact: true }).first().isVisible(),
					).resolves.toBe(true);
				}

				await page.locator("textarea").fill(ASK_FILE_NAME);
				await page.keyboard.press("Enter");
				await waitReplies(page, 2);
				await expect(
					page.getByText(scenarioFile(agent).name).last().isVisible(),
				).resolves.toBe(true);

				// The composer's picker names the concrete model, not the alias.
				const picker = page.getByRole("button", { name: /selecionar modelo/i });
				await expect(picker.textContent()).resolves.not.toMatch(/^Padrão/);

				await page
					.locator('button[aria-label^="Contexto usado"]')
					.waitFor({ timeout: 10_000 });
				await shoot(page, `chat-${agent}.png`);
			},
			TURN_TIMEOUT * 2 + 30_000,
		);

		test("painel de contexto", async () => {
			await page.locator('button[aria-label^="Contexto usado"]').click();
			const dialog = page.getByRole("dialog");
			await dialog.getByText("Janela de contexto").waitFor();
			// Loaded the breakdown (not the loading or error state).
			await dialog.locator("ul li").first().waitFor({ timeout: 15_000 });
			await page.waitForTimeout(300);
			await shoot(page, `chat-${agent}-contexto.png`);
			await page.close();
		}, 30_000);
	});
}

chatScenario("claude");
chatScenario("codex");

test("sem erros no webview", () => {
	expect(pageErrors).toEqual([]);
});
