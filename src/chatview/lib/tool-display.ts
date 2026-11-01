/**
 * Human labels for tool calls: a short title ("Terminal", "Ler arquivo") and
 * a one-line subtitle drawn from the arguments (the command, the path, the
 * query), so a collapsed tool card still says what the agent did.
 * Covers Claude Code's built-in tools, the names the Codex mapper emits
 * (`Shell`, `ApplyPatch`, `WebSearch`, `TodoWrite`) and `mcp__server__tool`.
 */

export type ToolIconKind =
	| "terminal"
	| "file-read"
	| "file-edit"
	| "search"
	| "web"
	| "todo"
	| "agent"
	| "mcp"
	| "generic";

export interface ToolDisplay {
	title: string;
	subtitle?: string;
	icon: ToolIconKind;
}

const SUBTITLE_MAX = 140;

type Args = Record<string, unknown>;

function asArgs(value: unknown): Args {
	return value && typeof value === "object" ? (value as Args) : {};
}

function str(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim()) return value.trim();
	if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
		const joined = value.join(" ").trim();
		return joined || undefined;
	}
	return undefined;
}

function oneLine(text: string | undefined): string | undefined {
	if (!text) return undefined;
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > SUBTITLE_MAX
		? `${flat.slice(0, SUBTITLE_MAX - 1)}…`
		: flat;
}

/** Shows only the tail of long paths: `…/src/chatview/App.tsx`. */
export function shortPath(path: string | undefined): string | undefined {
	if (!path) return undefined;
	const parts = path.split("/").filter(Boolean);
	if (parts.length <= 3) return path;
	return `…/${parts.slice(-3).join("/")}`;
}

/** Strips the `bash -lc '...'` wrapper Codex puts around commands. */
function unwrapShell(command: string | undefined): string | undefined {
	if (!command) return command;
	const match = /^(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(
		command,
	);
	return match ? match[2] : command;
}

function patchSubtitle(args: Args): string | undefined {
	const changes = args.changes;
	if (!Array.isArray(changes) || changes.length === 0) return undefined;
	const paths = changes
		.map((c) => shortPath(str(asArgs(c).path)))
		.filter(Boolean) as string[];
	if (paths.length === 0) return `${changes.length} arquivo(s)`;
	return paths.length === 1 ? paths[0] : `${paths[0]} +${paths.length - 1}`;
}

export function describeTool(toolName: string, rawArgs: unknown): ToolDisplay {
	const args = asArgs(rawArgs);

	if (toolName.startsWith("mcp__")) {
		const [, server, ...rest] = toolName.split("__");
		return {
			title: `${server} · ${rest.join("__") || "tool"}`,
			icon: "mcp",
		};
	}

	switch (toolName) {
		case "Bash":
		case "Shell":
			return {
				title: "Terminal",
				subtitle: oneLine(unwrapShell(str(args.command))),
				icon: "terminal",
			};
		case "BashOutput":
			return { title: "Saída do terminal", icon: "terminal" };
		case "Read":
			return {
				title: "Ler arquivo",
				subtitle: shortPath(str(args.file_path)),
				icon: "file-read",
			};
		case "Write":
			return {
				title: "Criar arquivo",
				subtitle: shortPath(str(args.file_path)),
				icon: "file-edit",
			};
		case "Edit":
		case "MultiEdit":
			return {
				title: "Editar arquivo",
				subtitle: shortPath(str(args.file_path)),
				icon: "file-edit",
			};
		case "NotebookEdit":
			return {
				title: "Editar notebook",
				subtitle: shortPath(str(args.notebook_path)),
				icon: "file-edit",
			};
		case "ApplyPatch":
			return {
				title: "Aplicar alterações",
				subtitle: patchSubtitle(args),
				icon: "file-edit",
			};
		case "Glob":
			return {
				title: "Buscar arquivos",
				subtitle: oneLine(str(args.pattern)),
				icon: "search",
			};
		case "Grep":
			return {
				title: "Buscar no código",
				subtitle: oneLine(str(args.pattern)),
				icon: "search",
			};
		case "WebSearch":
			return {
				title: "Pesquisa na web",
				subtitle: oneLine(str(args.query)),
				icon: "web",
			};
		case "WebFetch":
			return {
				title: "Abrir página",
				subtitle: oneLine(str(args.url)),
				icon: "web",
			};
		case "TodoWrite": {
			const todos = Array.isArray(args.todos) ? args.todos : [];
			const done = todos.filter((t) => asArgs(t).status === "completed").length;
			return {
				title: "Plano",
				subtitle: todos.length ? `${done}/${todos.length} concluídas` : "",
				icon: "todo",
			};
		}
		case "Task":
		case "Agent":
			return {
				title: "Subagente",
				subtitle: oneLine(str(args.description)),
				icon: "agent",
			};
		default:
			return { title: toolName, icon: "generic" };
	}
}
