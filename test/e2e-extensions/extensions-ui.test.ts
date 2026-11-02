import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

test("extension management renders, keeps failed drafts, and supports keyboard selection", async () => {
	const build = process.env.PTOLEMY_UI_DIST ?? "/tmp/ptolemy-extension-ui-dist";
	const screenshots =
		process.env.PTOLEMY_UI_SCREENSHOTS ??
		(await mkdtemp(join(tmpdir(), "ptolemy-extension-screenshots-")));
	await mkdir(screenshots, { recursive: true });
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const path = join(
				build,
				url.pathname === "/" ? "index.html" : url.pathname,
			);
			if (!resolve(path).startsWith(`${resolve(build)}/`))
				return new Response(null, { status: 404 });
			try {
				return new Response(await readFile(path), {
					headers: {
						"Content-Type": path.endsWith(".js")
							? "text/javascript"
							: path.endsWith(".css")
								? "text/css"
								: "text/html",
					},
				});
			} catch {
				return new Response(null, { status: 404 });
			}
		},
	});
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage({
			viewport: { width: 1120, height: 800 },
			reducedMotion: "reduce",
		});
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(server.url.href);
		await page
			.getByRole("heading", { name: "Extensões", exact: true })
			.waitFor();
		await page.getByRole("button", { name: /Inspecionar Ferramentas/ }).click();
		await page
			.getByText("Conector proprietário sem endpoint MCP público utilizável.")
			.waitFor();
		await page.waitForTimeout(180);
		await page.screenshot({ path: join(screenshots, "installed-detail.png") });
		await page.getByRole("tab", { name: "Marketplace" }).click();
		await page.getByRole("button", { name: /Inspecionar Ferramentas/ }).click();
		await page.getByRole("button", { name: "Instalar pacote" }).click();
		await page.getByRole("alert").waitFor();
		await page.waitForTimeout(180);
		await page.screenshot({ path: join(screenshots, "marketplace-error.png") });
		await page.getByRole("tab", { name: "MCP" }).click();
		await page
			.getByRole("button", { name: /Documentação e referências/ })
			.click();
		await page.getByText("Desconectado", { exact: true }).waitFor();
		await page.getByRole("button", { name: "Obter URI de registro" }).click();
		const uri = page.getByLabel("URI de redirecionamento");
		await uri.waitFor();
		expect(await uri.inputValue()).toBe(
			`http://127.0.0.1/oauth/callback/${"c".repeat(64)}`,
		);
		await uri.scrollIntoViewIfNeeded();
		await page.waitForTimeout(180);
		await page.screenshot({
			path: join(screenshots, "mcp-registration-uri.png"),
		});
		await page.getByRole("button", { name: "Conectar no navegador" }).click();
		await page.getByText("Aguardando no navegador", { exact: true }).waitFor();
		await page.waitForTimeout(180);
		await page.screenshot({ path: join(screenshots, "mcp-oauth.png") });
		await page.getByRole("button", { name: "Cancelar conexão" }).click();
		await page.getByText("Conexão cancelada", { exact: true }).waitFor();
		await page.setViewportSize({ width: 480, height: 780 });
		await page.waitForTimeout(180);
		await page.screenshot({ path: join(screenshots, "mcp-narrow.png") });
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await page.getByRole("button", { name: "Cancelar edição" }).click();
		await page.getByRole("button", { name: "Novo servidor" }).click();
		await page.getByLabel("Nome", { exact: true }).fill("Rascunho");
		await page.getByLabel("Comando", { exact: true }).fill("runner");
		await page.getByLabel("Argumentos (JSON)").fill("[invalid");
		await page.getByRole("button", { name: "Salvar servidor" }).click();
		await page.getByRole("alert").waitFor();
		expect(
			await page.getByLabel("Argumentos (JSON)").getAttribute("aria-invalid"),
		).toBe("true");
		expect(
			await page
				.getByLabel("Argumentos (JSON)")
				.evaluate((el) => el === document.activeElement),
		).toBe(true);
		expect(await page.getByRole("alert").isVisible()).toBe(true);
		expect(await page.getByLabel("Argumentos (JSON)").inputValue()).toBe(
			"[invalid",
		);
		await page.waitForTimeout(180);
		await page.screenshot({ path: join(screenshots, "mcp-invalid-draft.png") });
		await page.setViewportSize({ width: 900, height: 650 });
		await page.goto(`${server.url.href}?composer`);
		await page.getByRole("button", { name: /Configurar extensões/ }).click();
		await page.getByText(/sem confirmação a cada chamada/).waitFor();
		await page.waitForTimeout(180);
		await page.screenshot({
			path: join(screenshots, "composer-selection.png"),
		});
		await page.keyboard.press("Escape");
		const input = page.getByRole("textbox", { name: "Mensagem para Codex" });
		await input.fill("/");
		await page.getByRole("option", { name: /ferramentas:review/ }).waitFor();
		await input.press("ArrowDown");
		await input.press("Enter");
		expect(await input.inputValue()).toBe("/ferramentas:review ");
		await input.press("Shift+Enter");
		expect(await input.inputValue()).toContain("\n");
		await page.waitForTimeout(180);
		await page.screenshot({ path: join(screenshots, "composer-keyboard.png") });

		await page.setViewportSize({ width: 1000, height: 900 });
		await page.goto(`${server.url.href}?composer&claude`);
		await page.getByRole("button", { name: /Configurar Skills/ }).click();
		const builtinSkill = page.getByRole("checkbox", {
			name: "Usar Skill interna debug",
		});
		await builtinSkill.waitFor();
		expect(await builtinSkill.isChecked()).toBe(true);
		const packageSkill = page.getByRole("checkbox", {
			name: /Usar Ferramentas.*Revisar alteração/,
		});
		await packageSkill.waitFor();
		await packageSkill.check();
		await packageSkill.waitFor();
		expect(await packageSkill.isChecked()).toBe(true);
		expect(
			await page
				.getByRole("checkbox", { name: "Usar Revisão local" })
				.isChecked(),
		).toBe(true);
		expect(
			await page
				.getByRole("checkbox", { name: "Usar Revisão importada" })
				.isChecked(),
		).toBe(false);
		expect(await page.getByRole("checkbox", { name: /clear/ }).count()).toBe(0);
		await page.getByRole("button", { name: "Configurar Skills (3)" }).waitFor();
		await page.waitForTimeout(180);
		await page.screenshot({
			path: join(screenshots, "claude-skills-selection.png"),
		});
		expect(errors).toEqual([]);
		console.log(`Extension UI screenshots: ${screenshots}`);
	} finally {
		await browser.close();
		server.stop(true);
	}
}, 60000);
