import { describe, expect, test } from "vitest";
import { validateBundle, validateSkill } from "./validation";

const valid =
	"---\nname: code-review\ndescription: Review code changes.\n---\nRead the diff.";

describe("Agent Skills specification", () => {
	test.each([
		["scripts", "Scripts/run.sh"],
		["Scripts/run.sh", "scripts"],
	])("rejects a file colliding with a case-folded ancestor: %s", (first, second) => {
		const paths = [first, second];
		expect(() =>
			validateBundle({
				name: "code-review",
				description: "Review code changes.",
				source: {
					kind: "github",
					url: "https://github.com/a/b",
					commit: "a".repeat(40),
				},
				files: [
					{
						path: "SKILL.md",
						content: Buffer.from(valid).toString("base64"),
						executable: false,
					},
					...paths.map((path) => ({ path, content: "", executable: false })),
				],
			}),
		).toThrow(/conflit/i);
	});
	test("native metadata supports harmless harness extensions", () => {
		expect(
			validateSkill(
				valid.replace(
					"description: Review code changes.",
					"description: Review code changes.\nargument-hint: file\ndisable-model-invocation: true",
				),
				"code-review",
				true,
			).name,
		).toBe("code-review");
	});
	test("accepts YAML block scalars and optional metadata", () => {
		expect(
			validateSkill(
				valid.replace(
					"description: Review code changes.",
					"description: >\n  Review code changes.\nmetadata:\n  author: Ptolemy",
				),
				"code-review",
			),
		).toMatchObject({
			name: "code-review",
			description: "Review code changes.\n",
		});
	});
	test.each([
		"Code-Review",
		"-code",
		"code--review",
		"a".repeat(65),
	])("rejects invalid name %s", (name) => {
		expect(() =>
			validateSkill(valid.replace("name: code-review", `name: ${name}`), name),
		).toThrow(/nome/i);
	});
	test.each([
		valid.replace("code-review", "other"),
		valid.replace("description: Review code changes.", "description: ''"),
		valid.replace("description: Review code changes.", "description: 123"),
		valid.replace(
			"description: Review code changes.",
			`description: ${"a".repeat(1025)}`,
		),
		valid.replace(
			"description: Review code changes.",
			"description: ok\ncompatibility: 123",
		),
		valid.replace(
			"description: Review code changes.",
			"description: ok\nmetadata: [a, b]",
		),
		valid.replace(
			"description: Review code changes.",
			"description: ok\nmetadata:\n  version: 1",
		),
		valid.replace(
			"description: Review code changes.",
			"description: ok\nlicense: []",
		),
		valid.replace(
			"description: Review code changes.",
			"description: ok\nallowed-tools: []",
		),
		valid.replace(
			"description: Review code changes.",
			"description: ok\ndescription: duplicated",
		),
		"no frontmatter",
		valid.replace(
			"description: Review code changes.",
			"description: ok\nhooks:\n  SessionStart: []",
		),
		valid.replace(
			"description: Review code changes.",
			"description: !unsupported value",
		),
	])("rejects malformed metadata", (text) => {
		expect(() => validateSkill(text, "code-review")).toThrow();
	});
	test("does not turn allowed-tools into Ptolemy permissions", () => {
		expect(
			validateSkill(
				valid.replace(
					"description: Review code changes.",
					"description: ok\nallowed-tools: Bash",
				),
				"code-review",
			).name,
		).toBe("code-review");
	});
});
