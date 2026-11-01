import { expect, test } from "vitest";
import { resolveExtensionCommand } from "./commands";

test("commands preserve positional and named arguments without interpolating user input into shell", async () => {
	const seen: string[] = [];
	const result = await resolveExtensionCommand(
		{
			name: "demo:review",
			prompt: "$ARGUMENTS / $1 / $ARGUMENTS[1] / $TARGET / !`echo static`",
			metadata: { arguments: [{ name: "TARGET" }] },
			root: "/package",
		},
		{ arguments: 'hello "two words"', named: { TARGET: "$(touch /outside)" } },
		async (c) => {
			seen.push(c);
			return "dynamic";
		},
	);
	expect(seen).toEqual(["echo static"]);
	expect(result).toBe(
		'hello "two words" / hello / two words / $(touch /outside) / dynamic',
	);
});
test("dynamic expansions receive arguments as data, including indexed and named arguments", async () => {
	let captured: unknown;
	await resolveExtensionCommand(
		{
			name: "review",
			root: "/package",
			prompt: "!`echo $ARGUMENTS $ARGUMENTS[1] $TARGET`",
			metadata: {},
		},
		{ arguments: "one two", named: { TARGET: "$(touch /outside)" } },
		async (script, env, args) => {
			captured = { script, env, args };
			return "ok";
		},
	);
	expect(captured).toMatchObject({
		script: `echo $ARGUMENTS \${PTOLEMY_ARG_1} $TARGET`,
		env: {
			ARGUMENTS: "one two",
			PTOLEMY_ARG_1: "two",
			TARGET: "$(touch /outside)",
		},
		args: ["one", "two"],
	});
});

test("declared named arguments receive slash command positions", async () => {
	expect(
		await resolveExtensionCommand(
			{
				name: "x",
				root: "/root",
				metadata: { arguments: [{ name: "TARGET" }, { name: "MODE" }] },
				prompt: "$TARGET $MODE",
			},
			{ arguments: '"two words" strict' },
			async () => "",
		),
	).toBe("two words strict");
});
