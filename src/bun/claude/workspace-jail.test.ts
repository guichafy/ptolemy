import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkToolInput, isInsideWorkspace } from "./workspace-jail";

describe("isInsideWorkspace", () => {
	let ws: string;

	beforeEach(async () => {
		ws = await realpath(await mkdtemp(join(tmpdir(), "ptolemy-jail-")));
	});

	afterEach(async () => {
		await rm(ws, { recursive: true, force: true });
	});

	it("accepts absolute paths directly inside the workspace", () => {
		expect(isInsideWorkspace(ws, join(ws, "file.txt"))).toBe(true);
		expect(isInsideWorkspace(ws, join(ws, "sub", "deep", "file.txt"))).toBe(
			true,
		);
	});

	it("rejects absolute paths outside the workspace", () => {
		expect(isInsideWorkspace(ws, "/etc/passwd")).toBe(false);
		expect(isInsideWorkspace(ws, "/Users/someone/secret")).toBe(false);
	});

	it("rejects traversal escapes", () => {
		expect(isInsideWorkspace(ws, join(ws, "..", "outside.txt"))).toBe(false);
	});

	it("accepts the workspace root itself", () => {
		expect(isInsideWorkspace(ws, ws)).toBe(true);
	});

	it("rejects sibling dirs that share a prefix (no substring false positives)", () => {
		expect(isInsideWorkspace(ws, `${ws}-evil/file.txt`)).toBe(false);
	});

	it("treats relative paths as resolved against the workspace", () => {
		expect(isInsideWorkspace(ws, "sub/file.txt")).toBe(true);
		expect(isInsideWorkspace(ws, "../escape.txt")).toBe(false);
	});
});

describe("checkToolInput — Write/Edit/NotebookEdit", () => {
	let ws: string;
	beforeEach(async () => {
		ws = await realpath(await mkdtemp(join(tmpdir(), "ptolemy-jail-")));
	});
	afterEach(async () => {
		await rm(ws, { recursive: true, force: true });
	});

	it("allows Write with file_path inside workspace", () => {
		const result = checkToolInput(ws, "Write", {
			file_path: join(ws, "piada.txt"),
			content: "oi",
		});
		expect(result.allowed).toBe(true);
	});

	it("denies Write with absolute file_path outside workspace", () => {
		const result = checkToolInput(ws, "Write", {
			file_path:
				"/Users/guichafy/Workspaces/BunWorkspace/sample-electronbun/piada.txt",
			content: "oi",
		});
		expect(result.allowed).toBe(false);
		if (!result.allowed) {
			expect(result.reason).toMatch(/workspace/i);
			expect(result.reason).toContain(ws);
		}
	});

	it("denies Edit with file_path outside workspace", () => {
		const result = checkToolInput(ws, "Edit", {
			file_path: "/etc/hosts",
			old_string: "a",
			new_string: "b",
		});
		expect(result.allowed).toBe(false);
	});

	it("denies NotebookEdit with notebook_path outside workspace", () => {
		const result = checkToolInput(ws, "NotebookEdit", {
			notebook_path: "/tmp/x.ipynb",
			new_source: "print('hi')",
		});
		expect(result.allowed).toBe(false);
	});

	it("denies when the required path field is missing", () => {
		const result = checkToolInput(ws, "Write", { content: "oops" });
		expect(result.allowed).toBe(false);
	});

	it("denies Write whose file_path escapes via ..", () => {
		const result = checkToolInput(ws, "Write", {
			file_path: join(ws, "..", "outside.txt"),
			content: "x",
		});
		expect(result.allowed).toBe(false);
	});

	it("denies Write through a symlink that points outside the workspace", async () => {
		const outside = await realpath(
			await mkdtemp(join(tmpdir(), "ptolemy-out-")),
		);
		try {
			await symlink(outside, join(ws, "out-link"));
			const result = checkToolInput(ws, "Write", {
				file_path: "out-link/created.txt",
				content: "x",
			});
			expect(result.allowed).toBe(false);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});
});

describe("checkToolInput — Bash", () => {
	let ws: string;
	beforeEach(async () => {
		ws = await realpath(await mkdtemp(join(tmpdir(), "ptolemy-jail-")));
	});
	afterEach(async () => {
		await rm(ws, { recursive: true, force: true });
	});

	it("allows read-only commands without absolute paths", () => {
		expect(checkToolInput(ws, "Bash", { command: "ls -la" }).allowed).toBe(
			true,
		);
		expect(
			checkToolInput(ws, "Bash", { command: "cat package.json" }).allowed,
		).toBe(true);
	});

	it("allows commands touching absolute paths that live inside workspace", () => {
		expect(
			checkToolInput(ws, "Bash", {
				command: `touch ${join(ws, "ok.txt")}`,
			}).allowed,
		).toBe(true);
	});

	it("denies redirect-to-absolute-path outside workspace", () => {
		expect(
			checkToolInput(ws, "Bash", {
				command: "echo hi > /Users/foo/secret.txt",
			}).allowed,
		).toBe(false);
		expect(
			checkToolInput(ws, "Bash", {
				command: "echo hi >> /etc/hosts",
			}).allowed,
		).toBe(false);
	});

	it("denies mutating commands with relative traversal targets", () => {
		for (const command of ["touch ../escape", "echo hi > ../escape"]) {
			const r = checkToolInput(ws, "Bash", { command });
			expect(r.allowed, command).toBe(false);
		}
	});

	it("denies write commands after cd escapes the workspace", () => {
		const r = checkToolInput(ws, "Bash", {
			command: "cd .. && touch escaped.txt",
		});
		expect(r.allowed).toBe(false);
	});

	it("allows write commands after cd into a workspace subdirectory", async () => {
		await mkdir(join(ws, "sub"));
		const r = checkToolInput(ws, "Bash", {
			command: "cd sub && touch ok.txt",
		});
		expect(r.allowed).toBe(true);
	});

	it("denies writes through symlinked directories", async () => {
		const outside = await realpath(
			await mkdtemp(join(tmpdir(), "ptolemy-out-")),
		);
		try {
			await symlink(outside, join(ws, "out-link"));
			const r = checkToolInput(ws, "Bash", {
				command: "touch out-link/created.txt",
			});
			expect(r.allowed).toBe(false);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("denies rm/mv/cp/touch/mkdir/chmod targeting absolute paths outside workspace", () => {
		const cases = [
			"rm /etc/passwd",
			"mv foo /tmp/escape",
			"cp foo.txt /Users/foo/bar.txt",
			"touch /Users/foo/created",
			"mkdir /Users/foo/newdir",
			"chmod 777 /Users/foo/thing",
			"ln -s foo /Users/foo/link",
			"tee -a /Users/foo/log < input",
		];
		for (const command of cases) {
			const r = checkToolInput(ws, "Bash", { command });
			expect(r.allowed, command).toBe(false);
		}
	});

	it("denies sed -i on absolute paths outside workspace", () => {
		const r = checkToolInput(ws, "Bash", {
			command: "sed -i '' s/a/b/ /Users/foo/thing.txt",
		});
		expect(r.allowed).toBe(false);
	});

	it("allows grep/cat reading absolute system paths (read is not in scope)", () => {
		expect(
			checkToolInput(ws, "Bash", { command: "grep foo /etc/hosts" }).allowed,
		).toBe(true);
		expect(
			checkToolInput(ws, "Bash", { command: "cat /etc/hosts" }).allowed,
		).toBe(true);
	});

	it("denies when command is missing", () => {
		expect(checkToolInput(ws, "Bash", {}).allowed).toBe(false);
	});

	it("denies tilde paths pointing outside workspace (bypass guard)", () => {
		const cases = [
			"echo hi >> ~/.bashrc",
			"cp foo.txt ~/Desktop/exfil.txt",
			"rm ~/.ssh/authorized_keys",
			"mv foo ~/secret",
		];
		for (const command of cases) {
			const r = checkToolInput(ws, "Bash", { command });
			expect(r.allowed, command).toBe(false);
		}
	});

	it("allows tilde paths that resolve inside workspace", () => {
		// Only reachable when the home dir happens to contain the workspace
		// (tmp on mac does not, so this mostly guards against false positives
		// when home is a prefix of workspace in rare setups).
		const home = homedir();
		expect(
			checkToolInput(home, "Bash", { command: "touch ~/ok.txt" }).allowed,
		).toBe(true);
	});

	it("denies stderr redirect (2>, 2>>) to absolute path outside workspace", () => {
		expect(
			checkToolInput(ws, "Bash", {
				command: "python script.py 2>/etc/cron.allow",
			}).allowed,
		).toBe(false);
		expect(
			checkToolInput(ws, "Bash", {
				command: "make 2>>/var/log/evil",
			}).allowed,
		).toBe(false);
	});

	it("denies combined stdout+stderr redirect (&>, &>>)", () => {
		expect(
			checkToolInput(ws, "Bash", {
				command: "build &>/Users/foo/out",
			}).allowed,
		).toBe(false);
	});

	it("denies dd of= targeting paths outside workspace", () => {
		expect(
			checkToolInput(ws, "Bash", {
				command: "dd if=/dev/urandom of=/etc/shadow bs=1",
			}).allowed,
		).toBe(false);
	});

	it("denies interpreter inline code touching absolute paths outside workspace", () => {
		const cases = [
			"python3 -c \"open('/etc/passwd','w').write('x')\"",
			"python -c 'import os; os.remove(\"/tmp/evil\")'",
			"node -e \"require('fs').writeFileSync('/etc/hosts','x')\"",
			'perl -e \'open(F,">/etc/hosts");print F "x"\'',
			'ruby -e \'File.write("/tmp/evil","x")\'',
		];
		for (const command of cases) {
			const r = checkToolInput(ws, "Bash", { command });
			expect(r.allowed, command).toBe(false);
		}
	});

	it("allows interpreter invocations that do not touch absolute paths outside workspace", () => {
		// Running a script inside workspace is fine — the command itself has
		// no absolute path escape, and we intentionally don't try to analyze
		// script contents.
		expect(
			checkToolInput(ws, "Bash", { command: "python3 -c 'print(1)'" }).allowed,
		).toBe(true);
		expect(
			checkToolInput(ws, "Bash", { command: `node ${join(ws, "foo.js")}` })
				.allowed,
		).toBe(true);
	});

	it("denies awk -i inplace on absolute paths outside workspace", () => {
		expect(
			checkToolInput(ws, "Bash", {
				command: "awk -i inplace '{print}' /etc/hosts",
			}).allowed,
		).toBe(false);
	});
});

describe("checkToolInput — other tools", () => {
	let ws: string;
	beforeEach(async () => {
		ws = await realpath(await mkdtemp(join(tmpdir(), "ptolemy-jail-")));
	});
	afterEach(async () => {
		await rm(ws, { recursive: true, force: true });
	});

	it("allows Read / Grep / Glob / LS regardless of path (scope is writes)", () => {
		expect(
			checkToolInput(ws, "Read", { file_path: "/etc/hosts" }).allowed,
		).toBe(true);
		expect(checkToolInput(ws, "Grep", { pattern: "x" }).allowed).toBe(true);
		expect(checkToolInput(ws, "Glob", { pattern: "/**" }).allowed).toBe(true);
		expect(checkToolInput(ws, "LS", { path: "/" }).allowed).toBe(true);
	});

	it("allows unknown tool names (no rule → no constraint)", () => {
		expect(checkToolInput(ws, "SomeMcpTool", { foo: "bar" }).allowed).toBe(
			true,
		);
	});
});
