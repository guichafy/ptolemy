export interface ExtensionCommand {
	name: string;
	prompt: string;
	metadata: Record<string, unknown>;
	root: string;
	data?: string;
}
export async function resolveExtensionCommand(
	command: ExtensionCommand,
	input: { arguments?: string; named?: Record<string, string> },
	execute: (
		command: string,
		variables: Record<string, string>,
		args: string[],
	) => Promise<string>,
	signal?: AbortSignal,
): Promise<string> {
	signal?.throwIfAborted();
	const prompt = command.prompt;
	const raw = input.arguments ?? "";
	const args = (raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []).map((a) =>
		a.replace(/^(["'])([\s\S]*)\1$/, "$2"),
	);
	const declared = Array.isArray(command.metadata.arguments)
		? command.metadata.arguments
		: [];
	const named = {
		...Object.fromEntries(
			declared.map((argument, i) => [
				typeof argument === "string" ? argument : argument.name,
				args[i] ?? "",
			]),
		),
		...input.named,
	};
	const variables = {
		...named,
		ARGUMENTS: raw,
		...Object.fromEntries(args.map((v, i) => [`PTOLEMY_ARG_${i}`, v])),
	};
	const render = (text: string) =>
		text.replace(
			/\$ARGUMENTS\[(\d+)\]|\$(\d+)|\$ARGUMENTS\b|\$\{?(CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}?|\$([A-Z][A-Z0-9_]*)\b/g,
			(token, index, position, root, name) =>
				index !== undefined
					? (args[Number(index)] ?? "")
					: position !== undefined
						? (args[Number(position) - 1] ?? "")
						: root
							? command.root
							: name
								? (named[name] ?? token)
								: raw,
		);
	const chunks: string[] = [];
	let cursor = 0;
	for (const expansion of prompt.matchAll(/!`([^`]+)`/g)) {
		signal?.throwIfAborted();
		chunks.push(render(prompt.slice(cursor, expansion.index)));
		const output = await execute(
			expansion[1].replace(
				/\$ARGUMENTS\[(\d+)\]/g,
				(_m, i) => `\${PTOLEMY_ARG_${i}}`,
			),
			variables,
			args,
		);
		signal?.throwIfAborted();
		chunks.push(output);
		cursor = expansion.index + expansion[0].length;
	}
	chunks.push(render(prompt.slice(cursor)));
	return chunks.join("");
}
