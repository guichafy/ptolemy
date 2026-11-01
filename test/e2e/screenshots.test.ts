import type { ChildProcess } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	activateWindow,
	clearInput,
	clickPaletteElement,
	createDriver,
	indexOfInSource,
	pressEnter,
	pressEscape,
	saveNativeWindowLog,
	saveScreenshot,
	selectProvider,
	startAppiumServer,
	stopAppiumServer,
	tabToProvider,
	typeText,
	wait,
	waitForResults,
} from "./helpers/appium";
import { Providers, Screenshots, Timing } from "./helpers/constants";

/**
 * End-to-end smoke tests that double as screenshot generators for docs.
 *
 * Each test is independent: before every case we clear the input and cycle
 * the provider selector back to "apps" so no state leaks between runs.
 * Previously tests chained state through `pressTab` without clearing, which
 * accumulated typed text and left every screenshot on the wrong provider.
 */
describe("Ptolemy Screenshots", () => {
	let appiumProcess: ChildProcess;
	let driver: WebdriverIO.Browser;

	// We only know the starting provider index (0 = apps) on first run.
	// Each test that navigates must update this so the next `beforeEach`
	// can rotate back without guessing.
	let currentProviderIndex = 0;

	beforeAll(async () => {
		const t0 = Date.now();
		console.log("[e2e] starting Appium server...");
		appiumProcess = await startAppiumServer();
		console.log(`[e2e] Appium ready in ${Date.now() - t0}ms`);

		const t1 = Date.now();
		console.log("[e2e] creating WDIO session (launches the app)...");
		driver = await createDriver();
		console.log(`[e2e] session ready in ${Date.now() - t1}ms`);

		await wait(Timing.APP_STARTUP);
		activateWindow();
		await wait(Timing.SETTLE_LOCAL);
		console.log(`[e2e] total beforeAll ${Date.now() - t0}ms`);
	});

	afterAll(async () => {
		if (driver) {
			saveNativeWindowLog();
			try {
				await driver.deleteSession();
			} catch {
				// Sessão já pode ter sido fechada
			}
		}
		if (appiumProcess) {
			stopAppiumServer(appiumProcess);
		}
	});

	beforeEach(async () => {
		// Ensure every test starts with an empty input on the Apps provider.
		await selectProvider(driver, "apps");
		await clearInput(driver);
		currentProviderIndex = 0;
		await wait(Timing.SETTLE_LOCAL);
	});

	it("Screenshot 1: Estado inicial — command palette vazia", async () => {
		// Sanity: prove the palette actually rendered (not a blank window or
		// stuck splash). The Apps provider is active after beforeEach, so its
		// placeholder must be present in the accessibility tree.
		const report = await waitForResults(
			driver,
			["Buscar aplicativos..."],
			Timing.RESULTS_WAIT,
			Timing.RESULTS_POLL,
		);
		expect(
			report.missing,
			`Palette placeholder missing after ${report.elapsedMs}ms. Snippet: ${report.source.slice(0, 1500)}`,
		).toEqual([]);

		const filePath = await saveScreenshot(driver, Screenshots.INITIAL);
		console.log(`Salvo: ${filePath}`);
	});

	it("Screenshot 2: Busca GitHub — resultados de busca", async () => {
		const githubIndex = Providers.indexOf("github");
		await tabToProvider(
			driver,
			currentProviderIndex,
			githubIndex,
			Providers.length,
		);
		currentProviderIndex = githubIndex;

		await typeText(driver, "bun");
		// GitHub has no auto-search (see App.tsx — only calc/apps/claude auto-run).
		// The first Enter with an empty result set triggers handleSearch() and does
		// NOT open any URL: App.tsx gates openUrl behind results[selectedIndex],
		// which is undefined until the fetch resolves.
		await pressEnter(driver);

		// "bun" on `search/repositories?sort=best-match` is stable enough that
		// oven-sh/bun (the runtime) and uptrace/bun (Go ORM) consistently
		// appear in the top results. We assert both are present to prove the
		// list actually rendered, and assert their relative order to catch
		// regressions in the sort/ranking pipeline.
		const expectedTopRepos = ["oven-sh/bun", "uptrace/bun"] as const;
		const report = await waitForResults(
			driver,
			expectedTopRepos,
			Timing.RESULTS_WAIT,
			Timing.RESULTS_POLL,
		);

		expect(
			report.missing,
			`GitHub results missing after ${report.elapsedMs}ms. Page source snippet: ${report.source.slice(0, 2000)}`,
		).toEqual([]);

		const ovenIdx = indexOfInSource(report.source, "oven-sh/bun");
		const uptraceIdx = indexOfInSource(report.source, "uptrace/bun");
		expect(
			ovenIdx,
			"oven-sh/bun should render before uptrace/bun in the results list",
		).toBeLessThan(uptraceIdx);

		const filePath = await saveScreenshot(driver, Screenshots.GITHUB);
		console.log(`Salvo: ${filePath} (resultados em ${report.elapsedMs}ms)`);
	});

	it("Screenshot 3: Calculadora — expressão com resultado", async () => {
		const calcIndex = Providers.indexOf("calc");
		await selectProvider(driver, "calc");
		currentProviderIndex = calcIndex;

		await typeText(driver, "245 * 3 + 17");

		// Calculator auto-runs (App.tsx debounces at 100ms) so no Enter needed.
		// 245 * 3 + 17 = 752 — we assert the numeric result rendered by
		// CalculatorResult ("= 752"), which proves the provider evaluated
		// the expression end-to-end and the UI reflected the state change.
		const report = await waitForResults(
			driver,
			["752"],
			Timing.RESULTS_WAIT,
			Timing.RESULTS_POLL,
		);
		expect(
			report.missing,
			`Calculator result "752" not rendered after ${report.elapsedMs}ms. Snippet: ${report.source.slice(0, 1500)}`,
		).toEqual([]);

		const filePath = await saveScreenshot(driver, Screenshots.CALCULATOR);
		console.log(`Salvo: ${filePath} (resultado em ${report.elapsedMs}ms)`);
	});

	it("Screenshot 4: Busca de apps — apps locais encontrados", async () => {
		// beforeEach already left us on the Apps provider, no Tab needed.
		await typeText(driver, "Safari");

		// Apps auto-runs on every keystroke (App.tsx debounce = 0). Safari.app
		// is shipped with macOS so it's guaranteed to be in the cached list
		// returned by listApps(). We assert both the app name and its install
		// path to confirm we're looking at a real result row, not just any
		// label that happens to contain "Safari".
		const report = await waitForResults(
			driver,
			["Safari", "/Applications/Safari.app"],
			Timing.RESULTS_WAIT,
			Timing.RESULTS_POLL,
		);
		expect(
			report.missing,
			`Apps results missing after ${report.elapsedMs}ms. Snippet: ${report.source.slice(0, 1500)}`,
		).toEqual([]);

		const filePath = await saveScreenshot(driver, Screenshots.APPS);
		console.log(`Salvo: ${filePath} (resultados em ${report.elapsedMs}ms)`);
	});

	it("Composer de Claude: Skills disponíveis antes da conversa", async () => {
		await selectProvider(driver, "claude");
		currentProviderIndex = Providers.indexOf("claude");
		const composer = await waitForResults(
			driver,
			["Mensagem para Claude", "Configurar Skills"],
			Timing.RESULTS_WAIT,
			Timing.RESULTS_POLL,
		);
		expect(composer.missing, composer.source.slice(0, 1800)).toEqual([]);
		const skills = await driver.$(
			'//XCUIElementTypeButton[@label="Configurar Skills" or @title="Configurar Skills"]',
		);
		await skills.waitForEnabled({ timeout: Timing.RESULTS_WAIT });
		await clickPaletteElement(skills);
		const picker = await waitForResults(
			driver,
			[
				"Skills da conversa",
				"URL da Skill no GitHub",
				"Usar seleção como padrão",
			],
			Timing.RESULTS_WAIT,
			Timing.RESULTS_POLL,
		);
		expect(picker.missing, picker.source.slice(0, 1800)).toEqual([]);
		await saveScreenshot(driver, "skills-composer.png");
		await pressEscape(driver);
		// Returning from the composer must not depend on cycling through its
		// controls. Prove the ordinary search input is reachable again.
		await selectProvider(driver, "apps");
		currentProviderIndex = 0;
		const apps = await waitForResults(
			driver,
			["Buscar aplicativos..."],
			Timing.RESULTS_WAIT,
			Timing.RESULTS_POLL,
		);
		expect(apps.missing).toEqual([]);
	});
});
