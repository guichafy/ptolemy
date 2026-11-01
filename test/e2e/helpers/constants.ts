import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

export const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, "docs", "screenshots");

export const APP_PATH = path.join(
	PROJECT_ROOT,
	"build",
	"dev-macos-arm64",
	"ptolemy-dev.app",
);

export const APPIUM_HOST = "127.0.0.1";
export const APPIUM_PORT = 4723;

export const BUNDLE_ID = "com.ptolomeu.app";

export const ModifierFlag = {
	// macos: keys forwards XCUIKeyModifierFlags, not NSEventModifierFlags.
	SHIFT: 1 << 1,
	CONTROL: 1 << 2,
	OPTION: 1 << 3,
	COMMAND: 1 << 4,
} as const;

// ASCII control-character strings for special keys. appium-mac2-driver's
// `macos: keys` extension requires the `key` field (string) on every entry
// — it won't accept `virtualKeyCode` alone. The driver maps these control
// chars onto XCUIKeyboardKey constants (see Apple's XCUITest docs):
//   "\t"     → tab
//   "\r"     → return
//   "" → escape
//   "" → backspace (XCUIKeyboardKey.delete)
// Selenium's Keys strings ( etc.) are passed through as Unicode
// characters and don't map to real keystrokes, so we avoid them.
export const Key = {
	TAB: "\t",
	ENTER: "\r",
	ESCAPE: "",
	BACKSPACE: "\u007f",
} as const;

// macOS virtual key codes. Some Mac2 driver builds accept these alongside
// `key` as an extra hint; we expose them for future use but normally only
// set `key`.
export const VKey = {
	TAB: 48,
	ENTER: 36,
	ESCAPE: 53,
	BACKSPACE: 51,
} as const;

export const Timing = {
	APPIUM_STARTUP: 30_000,
	APP_STARTUP: 2_000,
	SETTLE_LOCAL: 1_000,
	SETTLE_NETWORK: 8_000,
	POST_TAB: 500,
	// Max wall time we wait for GitHub API results (network + render). The
	// fetch itself is usually < 2s, but CI and WKWebView accessibility
	// refresh can lag; 20s leaves margin without ballooning test runtime.
	RESULTS_WAIT: 20_000,
	RESULTS_POLL: 500,
} as const;

// Providers cycled by Ctrl+Tab, in the default `enabledOrder`. Tests use these
// indices to navigate deterministically between screenshots.
export const Providers = ["apps", "github", "calc", "web", "claude"] as const;
export type ProviderId = (typeof Providers)[number];

export const Screenshots = {
	INITIAL: "estado-inicial.png",
	GITHUB: "busca-github.png",
	CALCULATOR: "calculadora.png",
	APPS: "busca-apps.png",
} as const;
