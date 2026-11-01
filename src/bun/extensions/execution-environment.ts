import { getLoginShellPath } from "../codex/codex-cli";
import { restrictedEnvironment } from "./extension-executor.mjs";
/** Login PATH plus the current proxy route; no model/MCP/OAuth credential inheritance. */
export async function buildExtensionEnvironment(
	resolvePath = getLoginShellPath,
): Promise<Record<string, string>> {
	const path = await resolvePath();
	return restrictedEnvironment({ ...process.env, PATH: path });
}
