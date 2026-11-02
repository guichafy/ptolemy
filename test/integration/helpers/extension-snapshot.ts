/** Full catalog → session → package-owned MCP → removal → cold-resume contract. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { githubFixture } from "../../../src/bun/extensions/test-fixtures";
import { configureLocalAgents } from "./local-agents";

const root = await mkdtemp(join(tmpdir(), "ptolemy-package-snapshot-"));
process.env.PTOLEMY_HOME = root;
const mocks = await configureLocalAgents(root, process.cwd());
const { ExtensionsStore } = await import("../../../src/bun/extensions/store");
const { extensionMcpId } = await import("../../../src/bun/extensions/mcp");
const { mcpRegistry } = await import("../../../src/bun/mcp/registry");
const { mcpRuntimeName } = await import("../../../src/bun/mcp/runtime");
const sm = await import("../../../src/bun/claude/session-manager");
const events = new Map<
	string,
	Array<{ type: string; [key: string]: unknown }>
>();
sm.setSender({
	sendEvent(id, event) {
		const list = events.get(id) ?? [];
		list.push(event);
		events.set(id, list);
		if (event.type === "tool-permission-request")
			sm.getPermissionGate().approve(event.permissionId, "allow");
	},
});
const fixture = githubFixture({
	"plugin.json": JSON.stringify({
		name: "snapshot",
		skills: "./skills",
		commands: "./commands",
		mcpServers: {
			echo: {
				command: process.execPath,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: Preserve authored ROOT token.
				args: ["${PLUGIN_ROOT}/server.mjs"],
			},
		},
	}),
	"skills/selected/SKILL.md":
		"---\nname: selected\ndescription: PTOLEMY_FROZEN_SELECTED_SKILL\n---\nRead assets/value.txt when requested.",
	"skills/sibling/SKILL.md":
		"---\nname: sibling\ndescription: PTOLEMY_UNSELECTED_SIBLING\n---\nNot selected.",
	"commands/probe.md":
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Preserve authored package command tokens.
		'---\ndescription: Probe frozen package assets\n---\n!`cat "${PLUGIN_ROOT}/assets/value.txt"` $ARGUMENTS',
	"assets/value.txt": "PTOLEMY_PACKAGE_REVISION_ONE",
	"server.mjs": `import {createInterface} from 'node:readline';import {readFileSync} from 'node:fs';const asset=readFileSync(new URL('./assets/value.txt',import.meta.url),'utf8');createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'snapshot',version:'1'}}:m.method==='tools/list'?{tools:[{name:'echo',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:asset}]};console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`,
});
let catalogRequests = 0;
const catalog = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(req) {
		catalogRequests++;
		return fixture.fetcher(new URL(req.url).searchParams.get("url")!);
	},
});
const store = new ExtensionsStore({
	fetcher: (url, init) =>
		fetch(
			`http://127.0.0.1:${catalog.port}/?url=${encodeURIComponent(url)}`,
			init,
		),
});
const sessions: Array<{ id: string; agent: "claude" | "codex"; cwd: string }> =
	[];
async function turn(id: string, action: () => Promise<unknown>) {
	const start = (events.get(id) ?? []).length;
	await action();
	const deadline = Date.now() + 30000;
	while (
		!(events.get(id) ?? []).slice(start).some((e) => e.type === "finish")
	) {
		if (Date.now() > deadline)
			throw Error(`Missing finish: ${JSON.stringify(events.get(id))}`);
		await Bun.sleep(20);
	}
	const current = (events.get(id) ?? []).slice(start);
	assert(!current.some((e) => e.type === "error"), JSON.stringify(current));
	return current;
}
try {
	const source = await store.addSource("https://github.com/offline/snapshot");
	const [item] = await store.browse(source.id);
	assert(item);
	const inspected = await store.inspect(source.id, item.id);
	const pkg = await store.install(source.id, item.id);
	assert.equal(pkg.revision, inspected.revision);
	assert(catalogRequests > 0);
	const mcp = pkg.components.find((c) => c.kind === "mcp")!;
	const binding = extensionMcpId(pkg.id, mcp.id, pkg.revision);
	await mcpRegistry.save({
		id: binding,
		name: "package_echo",
		packageId: pkg.id,
		transport: "stdio",
		command: process.execPath,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: Keep package ROOT token for backend resolution.
		args: ["${PLUGIN_ROOT}/server.mjs"],
		defaults: { claude: false, codex: false },
	});
	const selection = [
		{
			packageId: pkg.id,
			revision: pkg.revision,
			componentIds: pkg.components
				.filter(
					(c) =>
						c.kind === "command" ||
						c.kind === "mcp" ||
						(c.kind === "skill" && c.name === "selected"),
				)
				.map((c) => c.id),
		},
	];
	for (const agent of ["claude", "codex"] as const) {
		const id = await sm.createSession("/snapshot:probe initial", {
			agent,
			model: agent === "claude" ? "haiku" : undefined,
			skillIds: [],
			builtinCommandNames: [],
			mcpServerIds: [],
			extensionSelections: selection,
		});
		const cwd = (await sm.listSessions()).find((s) => s.id === id)!.projectPath;
		sessions.push({ id, agent, cwd });
		await turn(id, () => sm.resumeSession(id));
		const requests = JSON.stringify(
			agent === "claude"
				? mocks.anthropicMock.requests
				: mocks.responsesMock.requests,
		);
		assert(requests.includes("PTOLEMY_PACKAGE_REVISION_ONE"));
		assert(requests.includes("PTOLEMY_FROZEN_SELECTED_SKILL"));
		assert(!requests.includes("PTOLEMY_UNSELECTED_SIBLING"));
		assert.deepEqual(
			(await sm.listSessions()).find((s) => s.id === id)!.extensionSelections,
			selection,
		);
	}
	await store.remove(pkg.id);
	await store.removeSource(source.id);
	assert.equal((await store.installed()).length, 0);
	const downloads = catalogRequests;
	await mcpRegistry.save({
		id: binding,
		name: "changed_binding",
		packageId: pkg.id,
		transport: "stdio",
		command: "/usr/bin/false",
		args: [],
		defaults: { claude: false, codex: false },
	});
	await sm.shutdownSessions();
	for (const { id, agent, cwd } of sessions) {
		// Discard the writable mirror to require reconstruction from the archived revision.
		await rm(join(cwd, ".ptolemy/extensions"), {
			recursive: true,
			force: true,
		});
		await sm.resumeSession(id);
		const requests =
			agent === "claude"
				? mocks.anthropicMock.requests
				: mocks.responsesMock.requests;
		const requestStart = requests.length;
		await turn(id, () => sm.sendMessage("/snapshot:probe resumed"));
		const resumedPrompt = JSON.stringify(requests.slice(requestStart));
		assert(resumedPrompt.includes("PTOLEMY_PACKAGE_REVISION_ONE resumed"));
		assert(resumedPrompt.includes("PTOLEMY_FROZEN_SELECTED_SKILL"));
		assert(!resumedPrompt.includes("PTOLEMY_UNSELECTED_SIBLING"));
		const name =
			agent === "claude"
				? "package_echo"
				: mcpRuntimeName(binding, "package_echo");
		const result = await turn(id, () =>
			sm.sendMessage(`PTOLEMY_MCP_CALL ${name} echo`),
		);
		assert(
			result.some(
				(e) =>
					e.type === "tool-result" &&
					JSON.stringify(e).includes("PTOLEMY_PACKAGE_REVISION_ONE"),
			),
			JSON.stringify(result),
		);
		assert.equal((await sm.getSessionResources(id)).mcpCount, 1);
		assert(
			(await sm.getSessionCommands(id)).some(
				(c) => c.name === "snapshot:probe",
			),
		);
		const persisted = JSON.parse(
			await readFile(join(root, ".ptolomeu/sessions/index.json"), "utf8"),
		).sessions.find((s: { id: string }) => s.id === id);
		assert.equal(persisted.mcpSelection.servers[0].name, "package_echo");
	}
	assert.equal(
		catalogRequests,
		downloads,
		"Cold resume must not redownload a removed package",
	);
	console.log(
		"PACKAGE_SNAPSHOT_RESUME_OK: catalog, selected components, package MCP, changed binding, removed installation, agent switching",
	);
} finally {
	await sm.shutdownSessions();
	for (const { id } of sessions) await sm.deleteSession(id);
	catalog.stop();
	mocks.stop();
	await rm(root, { recursive: true, force: true });
}
