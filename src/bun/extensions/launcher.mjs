import {
	executeHookSequence,
	executeRestricted,
	hookOutput,
} from "./extension-executor.mjs";

try {
	const spec = JSON.parse(Buffer.from(process.argv[2], "base64url").toString());
	let input = "";
	for await (const chunk of process.stdin) {
		input += chunk;
		if (input.length > 1048576) throw Error();
	}
	if (Array.isArray(spec)) {
		process.stdout.write(
			JSON.stringify(await executeHookSequence(spec, input)),
		);
		process.exit(0);
	}
	const result = await executeRestricted(spec, input);
	if (result.code !== 0) throw Error();
	process.stdout.write(JSON.stringify(hookOutput(spec.event, result.stdout)));
} catch {
	// Exit 2 blocks the triggering operation in both native hook engines.
	process.stderr.write("Hook da extensão falhou ou bloqueou a operação.");
	process.exitCode = 2;
}
