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

test("stdout stays literal and cannot replace or introduce another expansion", async () => {
	const output = "$& $` $' $$ !`same` $ARGUMENTS";
	let calls = 0;
	const result = await resolveExtensionCommand(
		{
			name: "x",
			root: "/root",
			metadata: {},
			prompt: "before !`same` between !`same` after $ARGUMENTS",
		},
		{ arguments: "argument" },
		async () => {
			calls++;
			return output;
		},
	);
	expect(calls).toBe(2);
	expect(result).toBe(`before ${output} between ${output} after argument`);
});
test("cancellation between expansions prevents the remaining authored commands", async () => {
	const controller = new AbortController();
	let calls = 0;
	await expect(
		resolveExtensionCommand(
			{ name: "x", root: "/root", metadata: {}, prompt: "!`one` !`two`" },
			{},
			async () => {
				calls++;
				controller.abort();
				return "output";
			},
			controller.signal,
		),
	).rejects.toThrow();
	expect(calls).toBe(1);
});
