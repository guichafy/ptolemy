/**
 * Points both agents at local mock servers: the CLIs bundled with each SDK,
 * an isolated Claude config dir and CODEX_HOME, API-key auth against the
 * mocks. Shared by the integration suite and the chat screenshot E2E.
 *
 * Mutates `process.env`, so call it before importing app modules that read
 * their paths at import time.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type MockAnthropicServer,
	startMockAnthropicServer,
} from "./mock-anthropic-server";
import {
	type MockResponsesServer,
	mockCodexConfigToml,
	startMockResponsesServer,
} from "./mock-responses-server";

export interface LocalAgents {
	anthropicMock: MockAnthropicServer;
	responsesMock: MockResponsesServer;
	stop(): void;
}

export async function configureLocalAgents(
	tmp: string,
	repo: string,
): Promise<LocalAgents> {
	// Local servers only: bypass any HTTP(S) proxy for loopback.
	for (const key of ["NO_PROXY", "no_proxy"]) {
		process.env[key] = ["127.0.0.1", "localhost", process.env[key]]
			.filter(Boolean)
			.join(",");
	}

	// Claude: the CLI bundled with the Agent SDK, isolated config, API key
	// auth against the mock. Drop anything that could route it elsewhere.
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("ANTHROPIC_") || key.startsWith("CLAUDE_CODE_")) {
			delete process.env[key];
		}
	}
	const anthropicMock = startMockAnthropicServer();
	process.env.ANTHROPIC_BASE_URL = anthropicMock.url;
	process.env.ANTHROPIC_API_KEY = "mock-key";
	process.env.CLAUDE_CONFIG_DIR = join(tmp, ".claude");
	process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
	process.env.PTOLEMY_CLAUDE_PATH ??= join(
		repo,
		"node_modules",
		"@anthropic-ai",
		`claude-agent-sdk-${process.platform}-${process.arch}`,
		"claude",
	);

	// Codex: the CLI bundled with the SDK, with its own CODEX_HOME pointing
	// at the mock provider.
	const responsesMock = startMockResponsesServer();
	const codexHome = join(tmp, ".codex");
	process.env.CODEX_HOME = codexHome;
	await mkdir(codexHome, { recursive: true });
	await writeFile(
		join(codexHome, "config.toml"),
		mockCodexConfigToml(responsesMock.url),
	);
	process.env.PTOLEMY_MOCK_API_KEY = "mock-key";
	process.env.PTOLEMY_CODEX_PATH ??= join(
		repo,
		"node_modules",
		".bin",
		"codex",
	);

	return {
		anthropicMock,
		responsesMock,
		stop() {
			anthropicMock.stop();
			responsesMock.stop();
		},
	};
}
