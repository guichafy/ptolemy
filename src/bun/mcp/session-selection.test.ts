import { expect, test } from "vitest";
import { publicSessionMcp } from "./session-selection";

test("public metadata redacts private snapshot references while preserving explicit none versus legacy absence", () => {
	const base = { id: "s", title: "title" };
	expect(publicSessionMcp(base)).toEqual(base);
	expect(
		publicSessionMcp({ ...base, mcpSelection: { version: 1, servers: [] } }),
	).toEqual({ ...base, mcpServerIds: [] });
	const data = publicSessionMcp({
		...base,
		mcpSelection: {
			version: 1,
			servers: [
				{
					id: "one",
					name: "one",
					transport: "http",
					url: "https://private",
					headers: { Authorization: { secretRef: "vault-secret" } },
					defaults: { claude: false, codex: false },
				},
			],
		},
	});
	expect(data).toEqual({ ...base, mcpServerIds: ["one"] });
	expect(JSON.stringify(data)).not.toContain("vault-secret");
});

test("public session metadata exposes selected builtin names without internal native paths or denial universe", () => {
	const safe = publicSessionMcp({
		id: "s",
		skillSelection: { nativePaths: ["/private/native/skill"] },
		builtinCommands: { all: ["selected", "other"], selected: ["selected"] },
		extensionSelections: [
			{ packageId: "package", revision: "revision", componentIds: ["command"] },
		],
	});
	expect(safe).toEqual({
		id: "s",
		builtinCommandNames: ["selected"],
		extensionSelections: [
			{ packageId: "package", revision: "revision", componentIds: ["command"] },
		],
	});
});
