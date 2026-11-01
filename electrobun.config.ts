import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "ptolemy",
		identifier: "com.ptolomeu.app",
		version: "0.14.0",
	},
	runtime: {
		exitOnLastWindowClosed: false,
	},
	build: {
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			"dist-chat/index.html": "views/chatview/index.html",
			"dist-chat/assets": "views/chatview/assets",
			"src/bun/native/liboverlay.dylib": "native/liboverlay.dylib",
			"src/bun/tray-icon.png": "native/tray-icon.png",
		},
		watchIgnore: [],
		mac: {
			bundleCEF: false,
			icons: "ptolemy.iconset",
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
