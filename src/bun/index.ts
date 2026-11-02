import { dlopen, FFIType, JSCallback } from "bun:ffi";
import { join } from "node:path";
import { ApplicationMenu, BrowserWindow, Tray, Utils } from "electrobun/bun";
import { initAnalytics, shutdownAnalytics, trackEvent } from "./analytics";
import {
	listSessions as claudeListSessions,
	shutdownSessions,
} from "./claude/session-manager";
import { ensureMcpCutover } from "./mcp/cutover";
import { mcpOAuthService } from "./mcp/oauth";
import { initProxy } from "./net/proxy";
import {
	chatRpc,
	mainRpc,
	setMainWindow,
	setMainWindowVisibilityChecker,
	setOpenChatCallback,
} from "./rpc";
import { loadSettings } from "./settings";

// Carrega settings antes de qualquer fetch para que o modo de proxy escolhido
// pelo usuário (auto/system/env/none/manual) seja respeitado desde o startup.
// Propaga HTTPS_PROXY para subprocessos (Claude CLI) e SDKs de terceiros
// (PostHog). Em modo manual, a senha vem do Keychain.
const bootSettings = await loadSettings();
await initProxy(bootSettings.proxy?.mode ?? "auto", bootSettings.proxy?.manual);
// A failed cutover remains recoverable through Preferences; no legacy writer survives.
await ensureMcpCutover().catch(() =>
	console.error(
		"[mcp] Migração pendente. Abra Extensões para recuperar os dados preservados.",
	),
);

// Load native helper for window overlay on fullscreen
// import.meta.dir points to Resources/app/bun/ in the bundle
// The dylib is copied to Resources/app/native/ via electrobun.config.ts
const dylibPath = join(import.meta.dir, "..", "native", "liboverlay.dylib");
const overlaySymbols = {
	makeWindowOverlay: {
		args: [FFIType.ptr],
		returns: FFIType.void,
	},
	registerHotkey: {
		args: [FFIType.ptr],
		returns: FFIType.i32,
	},
	unregisterHotkey: {
		args: [],
		returns: FFIType.void,
	},
	setWindowShowCallback: {
		args: [FFIType.ptr],
		returns: FFIType.void,
	},
	quitApp: {
		args: [],
		returns: FFIType.void,
	},
	setTrayLength: {
		args: [FFIType.ptr, FFIType.f64],
		returns: FFIType.void,
	},
	isMainWindowVisible: {
		args: [],
		returns: FFIType.i32,
	},
} as const;

let overlayLib: ReturnType<typeof dlopen<typeof overlaySymbols>>;
try {
	overlayLib = dlopen(dylibPath, overlaySymbols);
} catch (e) {
	console.error("Failed to load liboverlay.dylib:", e);
	process.exit(1);
}

// Chat window — lazy, created on first open
let chatWindow: InstanceType<typeof BrowserWindow> | null = null;

function openChatWindow(sessionId?: string) {
	console.log(
		`[main] openChatWindow: sessionId=${sessionId ?? "null"} hasWindow=${chatWindow !== null}`,
	);

	if (chatWindow) {
		// Window already exists — send sessionId via RPC and show it
		try {
			if (sessionId) {
				console.log(
					`[main] openChatWindow: reusing window, sending openSession sessionId=${sessionId}`,
				);
				chatRpc.send.claudeOpenSession({ sessionId });
			}
			chatWindow.show();
			return;
		} catch (err) {
			console.error(
				"[main] openChatWindow: reuse failed, recreating window:",
				err,
			);
			chatWindow = null;
		}
	}

	console.log("[main] openChatWindow: creating new chat window");
	chatWindow = new BrowserWindow({
		title: "Ptolemy — Chat",
		url: "views://chatview/index.html",
		hidden: false,
		titleBarStyle: "default",
		styleMask: {
			Borderless: false,
			Titled: true,
			Closable: true,
			Miniaturizable: false,
			Resizable: true,
		},
		frame: {
			width: 800,
			height: 600,
			x: 300,
			y: 150,
		},
		rpc: chatRpc,
	});

	// Electrobun removes the window from its internal map on close, but our
	// reference here would remain stale — causing the next open to take the
	// "reuse" branch and silently fail. Clear the ref so we recreate.
	chatWindow.on("close", () => {
		console.log("[main] chatWindow closed, clearing reference");
		chatWindow = null;
	});

	// Send sessionId via RPC after window is created
	if (sessionId) {
		setTimeout(() => {
			console.log(
				`[main] openChatWindow: sending openSession to new window sessionId=${sessionId}`,
			);
			chatRpc.send.claudeOpenSession({ sessionId });
		}, 500);
	}
}

// Hide dock icon — app runs as a menu bar agent
Utils.setDockIconVisible(false);

// Install application menu so macOS routes standard text-editing shortcuts
// (Cmd+A/C/V/X/Z) to focused inputs via NSMenu key equivalents. Even with the
// dock icon hidden, NSApp.mainMenu still participates in the responder chain.
ApplicationMenu.setApplicationMenu([
	{
		label: "Ptolemy",
		submenu: [],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo", accelerator: "CommandOrControl+Z" },
			{ role: "redo", accelerator: "CommandOrControl+Shift+Z" },
			{ type: "separator" },
			{ role: "cut", accelerator: "CommandOrControl+X" },
			{ role: "copy", accelerator: "CommandOrControl+C" },
			{ role: "paste", accelerator: "CommandOrControl+V" },
			{
				role: "pasteAndMatchStyle",
				accelerator: "CommandOrControl+Shift+Option+V",
			},
			{ role: "delete" },
			{ role: "selectAll", accelerator: "CommandOrControl+A" },
		],
	},
]);

// Create the main application window (hidden)
const url = "views://mainview/index.html";

const mainWindow = new BrowserWindow({
	title: "Ptolemy",
	url,
	hidden: true,
	titleBarStyle: "hidden",
	styleMask: {
		Borderless: true,
		Titled: false,
		Closable: false,
		Miniaturizable: false,
		Resizable: false,
	},
	frame: {
		width: 630,
		height: 120,
		x: 200,
		y: 200,
	},
	rpc: mainRpc,
});

setMainWindow(mainWindow);
setMainWindowVisibilityChecker(
	() => overlayLib.symbols.isMainWindowVisible() !== 0,
);
setOpenChatCallback((sessionId) => openChatWindow(sessionId));

// Push Claude session list to the palette whenever the main window gains
// focus. The webview's own visibilitychange/focus events are unreliable
// after the chat window has been shown — WebKit can suspend the webview,
// and outbound RPC calls from the renderer may be dropped. Pushing from the
// bun side bypasses the webview state entirely, so the palette always shows
// up-to-date sessions on reopen.
// Coalesce rapid pushClaudeSessions calls within this window. On a hotkey
// press, both `mainWindow.on("focus")` and the native `setWindowShowCallback`
// fire within milliseconds of each other — without a throttle we'd do two
// disk reads and two message sends per open. 50ms is well under any
// user-perceivable delay and comfortably wider than the observed gap between
// the two paths.
const PUSH_COALESCE_MS = 50;
let lastPushAt = 0;
async function pushClaudeSessions(reason: string): Promise<void> {
	const now = Date.now();
	if (now - lastPushAt < PUSH_COALESCE_MS) {
		return;
	}
	lastPushAt = now;
	try {
		const sessions = await claudeListSessions();
		console.log(
			`[main] pushClaudeSessions: reason=${reason} count=${sessions.length}`,
		);
		mainRpc.send.claudeSessionsUpdate({ sessions });
	} catch (err) {
		console.error("[main] pushClaudeSessions failed:", err);
	}
}

mainWindow.on("focus", () => {
	pushClaudeSessions("mainWindow.focus");
});

// Initialize analytics (respects user consent)
initAnalytics(bootSettings.analytics);
trackEvent("app_launched", { version: "1.2.0" });

// Create system tray with app icon
const trayIconPath = join(import.meta.dir, "..", "native", "tray-icon.png");
const tray = new Tray({
	title: "",
	image: trayIconPath,
	template: false,
	width: 32,
	height: 14,
});

// Shrink the menu bar slot beyond what Electrobun's `width` allows — that
// option only resizes the rendered image, not the NSStatusItem's length.
if (tray.ptr) {
	overlayLib.symbols.setTrayLength(tray.ptr, 28);
}

tray.on("tray-clicked", (event: any) => {
	const action = event.data?.action;

	if (action === "open-window") {
		overlayLib.symbols.makeWindowOverlay(mainWindow.ptr);
		pushClaudeSessions("tray.open-window");
	} else if (action === "open-preferences") {
		overlayLib.symbols.makeWindowOverlay(mainWindow.ptr);
		mainRpc.send.openPreferences({});
	} else if (action === "quit") {
		trackEvent("app_quit");
		Promise.allSettled([
			shutdownAnalytics(),
			shutdownSessions().finally(() => mcpOAuthService.dispose()),
		]).finally(() => {
			tray.remove();
			overlayLib.symbols.quitApp();
		});
	}
});

// Register global hotkey (Command+Shift+Space) via Carbon API in native code
const hotkeyStatus = overlayLib.symbols.registerHotkey(mainWindow.ptr);
const hotkeyOk = hotkeyStatus === 0;
if (!hotkeyOk) {
	console.warn(
		`[main] failed to register global hotkey Command+Shift+Space (OSStatus ${hotkeyStatus})`,
	);
	trackEvent("hotkey_register_failed", { status: hotkeyStatus });
}

const baseMenu = [
	{ type: "normal" as const, label: "Abrir", action: "open-window" },
	{
		type: "normal" as const,
		label: "Preferências...",
		action: "open-preferences",
	},
	{ type: "separator" as const },
	{ type: "normal" as const, label: "Sair", action: "quit" },
];

tray.setMenu(
	hotkeyOk
		? baseMenu
		: [
				{
					type: "normal" as const,
					label: "⚠️ Atalho ⌘⇧Espaço indisponível",
					enabled: false,
				},
				{ type: "separator" as const },
				...baseMenu,
			],
);

// Native-side notification fired from windowDidBecomeKey: in overlay.m —
// the only point where the WKWebView is firstResponder. The renderer's
// `useWindowShown` hook subscribes to the resulting `windowShown` push and
// (re)focuses the search input. We also refresh the Claude session list
// here because the same moment is when the palette is ready to show data.
const windowShowCallback = new JSCallback(
	() => {
		mainRpc.send.windowShown({ at: Date.now() });
		pushClaudeSessions("native.windowShow");
	},
	{
		args: [],
		returns: "void",
		threadsafe: true,
	},
);
overlayLib.symbols.setWindowShowCallback(windowShowCallback.ptr);

process.on("exit", () => {
	try {
		overlayLib.symbols.unregisterHotkey();
	} catch {
		// Native cleanup is best-effort during process teardown.
	}
});

console.log("System tray app started!");
