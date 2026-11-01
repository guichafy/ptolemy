import { spawn } from "node:child_process";
import { lstat, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { NativeHook } from "./native";

const failure = () =>
	Error(
		"Não foi possível inventariar as fontes de hooks do Codex com segurança. O runtime deve fornecer installation_id válido e inventário nativo completo antes de habilitar hooks.",
	);
export function parseNativeHookInventory(value: unknown): NativeHook[] {
	const data = (value as { data?: unknown[] })?.data;
	if (!Array.isArray(data) || data.length !== 1) throw failure();
	const entry = data[0] as {
		hooks?: unknown[];
		errors?: unknown[];
		warnings?: unknown[];
	};
	if (
		!Array.isArray(entry.hooks) ||
		!Array.isArray(entry.errors) ||
		!Array.isArray(entry.warnings) ||
		entry.errors.length ||
		entry.warnings.length
	)
		throw failure();
	return entry.hooks.map((value) => {
		const h = value as Record<string, unknown>;
		if (
			typeof h.key !== "string" ||
			typeof h.enabled !== "boolean" ||
			typeof h.isManaged !== "boolean" ||
			typeof h.source !== "string"
		)
			throw failure();
		if (h.source === "unknown" && h.enabled) throw failure();
		return {
			key: h.key,
			enabled: h.enabled,
			managed: h.isManaged,
			source: h.source,
		};
	});
}
export function codexHookInventoryPolicy(scratch: string, id: string): string {
	return `(version 1)(allow default)(deny network*)(allow network* (local unix-socket))(allow network* (remote unix-socket))(deny file-write*)(allow file-write* (subpath ${JSON.stringify(scratch)}))(allow file-write-data (literal ${JSON.stringify(id)}))`;
}
/** No thread/model request, no network; native source identities include policy and trusted project layers. */
export async function inventoryCodexHooks(
	cli: string,
	cwd: string,
	env: Record<string, string>,
): Promise<NativeHook[]> {
	const id = join(
		env.CODEX_HOME || join(homedir(), ".codex"),
		"installation_id",
	);
	// The installed CLI opens this existing UUID read/write even though it only reads it.
	// Never authorize creation, mode repair, links or an invalid identifier.
	// 0.166.0 attempts chmod unless the existing mode is already 0644.
	const before = await lstat(id).catch(() => {
		throw failure();
	});
	if (!before.isFile() || before.isSymbolicLink() || before.size > 128)
		throw failure();
	if ((before.mode & 0o777) !== 0o644)
		throw Error(
			"Inventário de hooks requer installation_id existente com modo 0644; o CLI tentaria reparar as permissões. Nenhum arquivo foi alterado.",
		);
	const bytes = await readFile(id);
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*$/i.test(
			bytes.toString(),
		)
	)
		throw failure();

	const scratch = await mkdtemp(join(tmpdir(), "ptolemy-hook-inventory-"));
	const policy = codexHookInventoryPolicy(
		await realpath(scratch),
		await realpath(id),
	);
	const child = spawn(
		"/usr/bin/sandbox-exec",
		[
			"-p",
			policy,
			cli,
			"app-server",
			"-c",
			`log_dir=${JSON.stringify(scratch)}`,
			"-c",
			`sqlite_home=${JSON.stringify(scratch)}`,
		],
		{ cwd, env: { ...env, TMPDIR: scratch }, stdio: ["pipe", "pipe", "pipe"] },
	);
	const closed = new Promise<void>((resolve) =>
		child.once("close", () => resolve()),
	);
	try {
		return await new Promise<NativeHook[]>((resolve, reject) => {
			let size = 0;
			const timer = setTimeout(() => reject(failure()), 15000);
			const lines = createInterface({ input: child.stdout });
			const send = (message: unknown) =>
				child.stdin.write(`${JSON.stringify(message)}\n`);
			const fail = () => reject(failure());
			child.once("error", fail);
			child.once("exit", fail);
			child.stdin.on("error", fail);
			for (const stream of [child.stdout, child.stderr])
				stream.on("data", (chunk) => {
					size += chunk.length;
					if (size > 8 * 1024 * 1024) fail();
				});
			lines.on("line", (line) => {
				try {
					const response = JSON.parse(line);
					if (response.error) throw failure();
					if (response.id === 1) {
						send({ method: "initialized" });
						send({ id: 2, method: "hooks/list", params: { cwds: [cwd] } });
					}
					if (response.id === 2) {
						const hooks = parseNativeHookInventory(response.result);
						clearTimeout(timer);
						resolve(hooks);
					}
				} catch {
					clearTimeout(timer);
					fail();
				}
			});
			child.once("close", () => {
				clearTimeout(timer);
				lines.close();
			});
			send({
				id: 1,
				method: "initialize",
				params: {
					clientInfo: { name: "ptolemy-hook-inventory", version: "1" },
					capabilities: { experimentalApi: true },
				},
			});
		});
	} finally {
		child.kill("SIGKILL");
		await closed;
		await rm(scratch, { recursive: true, force: true });
		const after = await stat(id).catch(() => {
			throw failure();
		});
		if (
			after.ino !== before.ino ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs ||
			!bytes.equals(await readFile(id))
		)
			await Promise.reject(failure());
	}
}
