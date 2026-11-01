import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureLocalAgents } from "./local-agents";

const root = await mkdtemp(join(tmpdir(), "ptolemy-command-lifecycle-"));
process.env.PTOLEMY_HOME = root;
const mocks = await configureLocalAgents(root, process.cwd());
const sm = await import("../../../src/bun/claude/session-manager");
const { ExtensionsStore } = await import("../../../src/bun/extensions/store");
const finishes = new Map<string, number>();
sm.setSender({
	sendEvent: (id, event) => {
		if (event.type === "finish") finishes.set(id, (finishes.get(id) ?? 0) + 1);
	},
});
async function until(check: () => Promise<boolean> | boolean) {
	const limit = Date.now() + 20000;
	while (!(await check())) {
		if (Date.now() > limit)
			throw Error("Timed out waiting for lifecycle marker");
		await Bun.sleep(20);
	}
}
const exists = async (path: string) =>
	await readFile(path).then(
		() => true,
		() => false,
	);
try {
	const plugin = join(root, "plugin");
	await mkdir(join(plugin, "commands"), { recursive: true });
	await writeFile(
		join(plugin, "plugin.json"),
		JSON.stringify({ name: "cancel" }),
	);
	await writeFile(
		join(plugin, "commands", "wait.md"),
		"---\ndescription: Delayed shell work\n---\n!`echo $$ > started; (sleep 1; echo late > late) & wait`",
	);
	const store = new ExtensionsStore();
	const pkg = await store.importNative("claude", {
		id: "cancel@fixture",
		name: "cancel",
		enabled: true,
		managed: false,
		path: plugin,
	});
	const selections = [
		{
			packageId: pkg.id,
			revision: pkg.revision,
			componentIds: pkg.components
				.filter((c) => c.kind === "command")
				.map((c) => c.id),
		},
	];
	for (const agent of ["claude", "codex"] as const) {
		const options = {
			agent,
			model: agent === "claude" ? "haiku" : undefined,
			skillIds: [],
			mcpServerIds: [],
			builtinCommandNames: [],
			extensionSelections: selections,
		};
		const initial = await sm.createSession("/cancel:wait", options);
		const cwd = (await sm.listSessions()).find(
			(s) => s.id === initial,
		)!.projectPath;
		const before =
			mocks.anthropicMock.requests.length + mocks.responsesMock.requests.length;
		const resuming = sm.resumeSession(initial);
		await until(() => exists(join(cwd, "started")));
		assert.equal(await sm.stopGeneration(), true);
		await resuming;
		await Bun.sleep(1200);
		assert.equal(
			await exists(join(cwd, "late")),
			false,
			`${agent} pending Stop must kill children`,
		);
		assert.equal(
			mocks.anthropicMock.requests.length + mocks.responsesMock.requests.length,
			before,
		);
		await sm.deleteSession(initial);
		const active = await sm.createSession("Hello", options);
		const indexPath = join(root, ".ptolomeu", "sessions", "index.json");
		async function oldBuiltinUniverse() {
			if (agent !== "claude") return;
			const index = JSON.parse(await readFile(indexPath, "utf8"));
			const meta = index.sessions.find((s: { id: string }) => s.id === active);
			meta.builtinCommands.all = meta.builtinCommands.all.filter(
				(name: string) => name !== "update-config",
			);
			meta.builtinCommands.all.push("historical-removed");
			await writeFile(indexPath, JSON.stringify(index));
		}
		async function assertRefreshedBuiltins() {
			if (agent !== "claude") return;
			const index = JSON.parse(await readFile(indexPath, "utf8"));
			const selected = index.sessions.find(
				(s: { id: string }) => s.id === active,
			).builtinCommands;
			assert(selected.all.includes("update-config"));
			assert(selected.all.includes("historical-removed"));
			assert.deepEqual(selected.selected, []);
			await assert.rejects(sm.sendMessage("/update-config"));
		}
		await oldBuiltinUniverse();
		await sm.resumeSession(active);
		await until(() => (finishes.get(active) ?? 0) > 0);
		await assertRefreshedBuiltins();
		const activeCwd = (await sm.listSessions()).find(
			(s) => s.id === active,
		)!.projectPath;
		const send = sm.sendMessage("/cancel:wait").catch(() => {});
		await until(() => exists(join(activeCwd, "started")));
		await sm.stopGeneration();
		await send;
		await Bun.sleep(1200);
		assert.equal(
			await exists(join(activeCwd, "late")),
			false,
			`${agent} follow-up Stop must kill children`,
		);
		await rm(join(activeCwd, "started"));
		const again = sm.sendMessage("/cancel:wait").catch(() => {});
		await until(() => exists(join(activeCwd, "started")));
		await sm.shutdownSessions();
		await again;
		await Bun.sleep(1200);
		assert.equal(
			await exists(join(activeCwd, "late")),
			false,
			`${agent} shutdown must drain children`,
		);
		await oldBuiltinUniverse();
		await sm.resumeSession(active);
		await assertRefreshedBuiltins();
		const other = await sm.createSession("Other", options);
		await rm(join(activeCwd, "started"));
		const switching = sm.sendMessage("/cancel:wait").catch(() => {});
		await until(() => exists(join(activeCwd, "started")));
		await sm.resumeSession(other);
		await switching;
		await Bun.sleep(1200);
		assert.equal(
			await exists(join(activeCwd, "late")),
			false,
			`${agent} switch must drain children`,
		);
		await sm.shutdownSessions();
		await sm.deleteSession(other);
		await sm.deleteSession(active);
	}
	console.log("LIFECYCLE_CANCELLATION_OK");
} finally {
	await sm.shutdownSessions();
	mocks.stop();
	await rm(root, { recursive: true, force: true });
}
