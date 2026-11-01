import {
	type ChildProcess,
	execFileSync,
	execSync,
	spawn,
} from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { type ChainablePromiseElement, remote } from "webdriverio";
import {
	APP_PATH,
	APPIUM_HOST,
	APPIUM_PORT,
	BUNDLE_ID,
	Key,
	ModifierFlag,
	type ProviderId,
	SCREENSHOTS_DIR,
	Timing,
} from "./constants";

export async function startAppiumServer(): Promise<ChildProcess> {
	const appiumBin = path.resolve(
		process.cwd(),
		"node_modules",
		".bin",
		"appium",
	);

	const proc = spawn(
		appiumBin,
		[
			"--address",
			APPIUM_HOST,
			"--port",
			String(APPIUM_PORT),
			"--log-level",
			"warn",
		],
		{
			stdio: ["ignore", "pipe", "pipe"],
			detached: false,
		},
	);

	await waitForAppium(proc, Timing.APPIUM_STARTUP);
	return proc;
}

async function waitForAppium(
	proc: ChildProcess,
	timeoutMs: number,
): Promise<void> {
	const url = `http://${APPIUM_HOST}:${APPIUM_PORT}/status`;
	const deadline = Date.now() + timeoutMs;
	const interval = 500;

	while (Date.now() < deadline) {
		if (proc.exitCode !== null) {
			throw new Error(`Appium process exited with code ${proc.exitCode}`);
		}
		try {
			const res = await fetch(url);
			if (res.ok) return;
		} catch {
			// Server not ready yet
		}
		await new Promise((r) => setTimeout(r, interval));
	}
	throw new Error(`Appium server did not start within ${timeoutMs}ms`);
}

export function stopAppiumServer(proc: ChildProcess): void {
	if (proc && !proc.killed) {
		proc.kill("SIGTERM");
	}
}

export async function createDriver() {
	return await remote({
		hostname: APPIUM_HOST,
		port: APPIUM_PORT,
		path: "/",
		capabilities: {
			platformName: "mac",
			"appium:automationName": "mac2",
			"appium:bundleId": BUNDLE_ID,
			"appium:appPath": APP_PATH,
			"appium:noReset": true,
			"appium:skipAppKill": false,
			"appium:newCommandTimeout": 120,
		} as Record<string, unknown>,
		logLevel: "warn",
	});
}

export async function typeText(
	driver: WebdriverIO.Browser,
	text: string,
): Promise<void> {
	const keys = text.split("").map((char) => ({ key: char }));
	await driver.executeScript("macos: keys", [{ keys }]);
}

async function sendKey(
	driver: WebdriverIO.Browser,
	key: string,
	modifierFlags?: number,
): Promise<void> {
	const keyObj: { key: string; modifierFlags?: number } = { key };
	if (modifierFlags !== undefined) {
		keyObj.modifierFlags = modifierFlags;
	}
	await driver.executeScript("macos: keys", [{ keys: [keyObj] }]);
}

export async function pressTab(driver: WebdriverIO.Browser): Promise<void> {
	await sendKey(driver, Key.TAB);
}

export async function pressEnter(driver: WebdriverIO.Browser): Promise<void> {
	await sendKey(driver, Key.ENTER);
}

export async function pressEscape(driver: WebdriverIO.Browser): Promise<void> {
	await sendKey(driver, Key.ESCAPE);
}

/**
 * Select all (Cmd+A) + Backspace. Leaves the input empty without changing
 * which provider tab is active.
 */
export async function clearInput(driver: WebdriverIO.Browser): Promise<void> {
	await sendKey(driver, "a", ModifierFlag.COMMAND);
	await sendKey(driver, Key.BACKSPACE);
}

/** Composer Tab navigates controls, so provider resets must use the mode bar. */
export async function selectProvider(
	driver: WebdriverIO.Browser,
	provider: ProviderId,
): Promise<void> {
	await ensurePaletteInteractive(driver);
	const labels: Record<ProviderId, string> = {
		apps: "Apps",
		github: "GitHub",
		calc: "Calc",
		web: "Web",
		claude: "Claude Code",
	};
	const title = labels[provider];
	const button = await driver.$(
		`//XCUIElementTypeButton[@title="${title}" or @label="${title}"]`,
	);
	await clickPaletteElement(button);
	await wait(Timing.POST_TAB);
	await ensurePaletteInteractive(driver);
	if (provider !== "claude") {
		// Clicking a mode leaves keyboard focus on its button. Refocus the
		// search field before typing instead of relying on the previous DOM.
		const input = await driver.$("//XCUIElementTypeTextField");
		await clickPaletteElement(input);
	}
}

/** Electrobun v1.16 mirrors native webviews out of the AX tree when the
 * pointer leaves their rendered layer, including after centered resizes.
 * See nativeWrapper.mm toggleMirrorMode/updateActiveWebviewForMousePosition.
 * Check the real CGWindow's visibility, then move inside it before AX queries. */
async function ensurePaletteInteractive(
	driver: WebdriverIO.Browser,
): Promise<void> {
	for (let attempt = 0; attempt < 6; attempt++) {
		const native = execFileSync(compileSwiftHelper(), ["prepare"])
			.toString()
			.trim();
		if (native === "hidden") {
			activateWindow();
			await wait(Timing.SETTLE_LOCAL);
			continue;
		}
		await wait(200);
		const source = await driver.getPageSource();
		const webview = source.match(/<XCUIElementTypeWebView\b[^>]*>/)?.[0];
		const x = Number(webview?.match(/\bx="([^"]+)"/)?.[1]);
		const y = Number(webview?.match(/\by="([^"]+)"/)?.[1]);
		console.log(`[e2e] palette ${native} AX x=${x} y=${y}`);
		if (Number.isFinite(x) && Number.isFinite(y) && x > -10_000 && y > -10_000)
			return;
		await wait(Timing.POST_TAB);
	}
	throw new Error(
		"A paleta não tornou os controles acessíveis após posicionar o ponteiro.",
	);
}

export function saveNativeWindowLog(): void {
	try {
		const logs = execFileSync(
			"/usr/bin/log",
			[
				"show",
				"--last",
				"10m",
				"--style",
				"compact",
				"--predicate",
				'eventMessage CONTAINS "[Hotkey]" OR eventMessage CONTAINS "[Delegate]"',
			],
			{ timeout: 15_000 },
		);
		writeFileSync(path.join(SCREENSHOTS_DIR, "native-window.log"), logs);
	} catch (error) {
		console.warn("[e2e] native window logs unavailable:", error);
	}
}

/** Click the observed AX rect after restoring Electrobun's interactive layer. */
export async function clickPaletteElement(
	element: ChainablePromiseElement,
): Promise<void> {
	const [location, size] = await Promise.all([
		element.getLocation(),
		element.getSize(),
	]);
	console.log(
		`[e2e] native click x=${location.x} y=${location.y} width=${size.width} height=${size.height}`,
	);
	if (location.x < -10_000 || location.y < -10_000)
		throw new Error("Controle da paleta está fora da tela.");
	execFileSync(compileSwiftHelper(), [
		"click",
		String(location.x + size.width / 2),
		String(location.y + size.height / 2),
	]);
}

/**
 * Cycle the provider selector forward until `targetIndex` is active. Caller
 * is responsible for tracking `currentIndex`. Cycles through a known-size
 * provider list (`Providers.length` in constants.ts).
 */
export async function tabToProvider(
	driver: WebdriverIO.Browser,
	currentIndex: number,
	targetIndex: number,
	providerCount: number,
): Promise<void> {
	const distance = (targetIndex - currentIndex + providerCount) % providerCount;
	for (let i = 0; i < distance; i++) {
		await pressTab(driver);
		await new Promise((r) => setTimeout(r, Timing.POST_TAB));
	}
}

let swiftHelperPath: string | null = null;

export function compileSwiftHelper(): string {
	if (swiftHelperPath) return swiftHelperPath;

	const srcPath = path.join(SCREENSHOTS_DIR, ".helper.swift");
	const binPath = path.join(SCREENSHOTS_DIR, ".helper");

	const src = `
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count > 1 else { exit(1) }

switch args[1] {
case "activate":
    let down = CGEvent(keyboardEventSource: nil, virtualKey: 49, keyDown: true)!
    down.flags = [.maskCommand, .maskShift]
    down.post(tap: .cghidEventTap)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: 49, keyDown: false)!
    up.flags = [.maskCommand, .maskShift]
    up.post(tap: .cghidEventTap)

case "prepare":
    let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
    var found = false
    for window in windows {
        guard (window["kCGWindowOwnerName"] as? String) == "ptolemy-dev",
              (window["kCGWindowAlpha"] as? Double ?? 0) > 0,
              let bounds = window["kCGWindowBounds"] as? [String:Any],
              let x = bounds["X"] as? Double, let y = bounds["Y"] as? Double,
              let width = bounds["Width"] as? Double, let height = bounds["Height"] as? Double,
              width >= 600, height >= 100 else { continue }
        // Owner + bounds also work without Screen Recording permission,
        // which may omit kCGWindowName. Ignore the app's small tray window.
        let point = CGPoint(x: x + width / 2, y: y + height / 2)
        let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)!
        move.post(tap: .cghidEventTap)
        print("visible x=\\(x) y=\\(y) w=\\(width) h=\\(height)")
        found = true
        break
    }
    if !found { print("hidden") }

case "click":
    guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { exit(1) }
    let point = CGPoint(x: x, y: y)
    let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)!
    down.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.05)
    let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)!
    up.post(tap: .cghidEventTap)

case "bounds":
    let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String:Any]] ?? []
    for w in list {
        if (w["kCGWindowOwnerName"] as? String) == "ptolemy-dev",
           (w["kCGWindowName"] as? String) == "Ptolemy",
           let b = w["kCGWindowBounds"] as? [String:Any] {
            let x = b["X"] as? Int ?? 0
            let y = b["Y"] as? Int ?? 0
            let w = b["Width"] as? Int ?? 0
            let h = b["Height"] as? Int ?? 0
            print("\\(x),\\(y),\\(w),\\(h)")
            break
        }
    }

case "crop":
    guard args.count >= 5 else { exit(1) }
    let inputPath = args[2]
    let outputPath = args[3]
    let parts = args[4].split(separator: ",").compactMap { Int($0) }
    let scale = args.count > 5 ? (Int(args[5]) ?? 2) : 2
    guard parts.count == 4 else { exit(1) }

    let url = URL(fileURLWithPath: inputPath)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fputs("Falha ao ler imagem\\n", stderr); exit(1)
    }

    let rect = CGRect(
        x: parts[0] * scale, y: parts[1] * scale,
        width: parts[2] * scale, height: parts[3] * scale
    )
    guard let cropped = image.cropping(to: rect) else {
        fputs("Falha ao cortar imagem\\n", stderr); exit(1)
    }

    let outUrl = URL(fileURLWithPath: outputPath)
    guard let dest = CGImageDestinationCreateWithURL(
        outUrl as CFURL, UTType.png.identifier as CFString, 1, nil
    ) else { exit(1) }
    CGImageDestinationAddImage(dest, cropped, nil)
    CGImageDestinationFinalize(dest)

default:
    break
}
`;

	execSync(`mkdir -p "${SCREENSHOTS_DIR}"`);
	writeFileSync(srcPath, src);
	execSync(`swiftc -O -o "${binPath}" "${srcPath}"`, {
		timeout: 30_000,
	});

	swiftHelperPath = binPath;
	return binPath;
}

export function activateWindow(): void {
	const bin = compileSwiftHelper();
	execSync(`"${bin}" activate`);
}

export async function saveScreenshot(
	driver: WebdriverIO.Browser,
	filename: string,
): Promise<string> {
	const filePath = path.join(SCREENSHOTS_DIR, filename);
	await driver.saveScreenshot(filePath);
	return filePath;
}

export function wait(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Accessibility tree XML of the app. appium-mac2-driver serializes the
 * XCUITest tree — for WKWebView content, list items render as descendants
 * of `XCUIElementTypeButton` with titles/labels preserved as attributes.
 * We match against the raw XML so helpers don't need to know the exact
 * element taxonomy.
 */
export async function getPageSource(
	driver: WebdriverIO.Browser,
): Promise<string> {
	return await driver.getPageSource();
}

export interface WaitForResultsReport {
	found: string[];
	missing: string[];
	elapsedMs: number;
	source: string;
}

/**
 * Poll the accessibility tree until every expected substring is present,
 * or the timeout expires. Returns what was actually found so callers can
 * build precise assertions (order, counts, etc.) instead of just a boolean.
 *
 * Substrings are matched against the raw XML page source — good enough for
 * repo full-names like "oven-sh/bun" that only appear inside result rows.
 */
export async function waitForResults(
	driver: WebdriverIO.Browser,
	expected: readonly string[],
	timeoutMs: number,
	pollMs = 500,
): Promise<WaitForResultsReport> {
	const start = Date.now();
	let lastSource = "";
	while (Date.now() - start < timeoutMs) {
		lastSource = await getPageSource(driver);
		const missing = expected.filter((s) => !lastSource.includes(s));
		if (missing.length === 0) {
			return {
				found: [...expected],
				missing: [],
				elapsedMs: Date.now() - start,
				source: lastSource,
			};
		}
		await wait(pollMs);
	}
	const found = expected.filter((s) => lastSource.includes(s));
	const missing = expected.filter((s) => !lastSource.includes(s));
	// Preserve the complete tree as a CI artifact, beyond the short assertion
	// excerpt, so a wrong provider or hidden native window can be diagnosed.
	writeFileSync(
		path.join(SCREENSHOTS_DIR, `missing-results-${Date.now()}.xml`),
		lastSource,
	);
	return {
		found,
		missing,
		elapsedMs: Date.now() - start,
		source: lastSource,
	};
}

/**
 * Index of `needle` in the accessibility-tree XML, or -1 if absent.
 * Callers use this to assert relative ordering between result rows
 * without depending on a specific DOM/accessibility shape.
 */
export function indexOfInSource(source: string, needle: string): number {
	return source.indexOf(needle);
}
