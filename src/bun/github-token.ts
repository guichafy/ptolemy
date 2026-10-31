import { fetchWithProxy } from "./net/proxy";

const SERVICE = "com.ptolomeu.app.github.pat";
const ACCOUNT = process.env.USER ?? "ptolomeu";

let cachedToken: string | null | undefined;

async function readStdout(
	stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
	if (!stream) return "";
	return new Response(stream).text();
}

export async function getToken(): Promise<string | null> {
	if (cachedToken !== undefined) return cachedToken;
	const proc = Bun.spawn(
		["security", "find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, code] = await Promise.all([
		readStdout(proc.stdout),
		proc.exited,
	]);
	if (code !== 0) {
		cachedToken = null;
		return null;
	}
	const token = stdout.trim();
	cachedToken = token || null;
	return cachedToken;
}

export interface SetTokenResult {
	ok: boolean;
	login?: string;
	error?: string;
}

async function validateTokenViaApi(token: string): Promise<SetTokenResult> {
	try {
		const res = await fetchWithProxy("https://api.github.com/user", {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: "application/vnd.github+json",
				"User-Agent": "Ptolemy",
			},
		});
		if (res.status === 401) {
			return { ok: false, error: "Token inválido (401)" };
		}
		if (!res.ok) {
			return { ok: false, error: `GitHub respondeu ${res.status}` };
		}
		const data = (await res.json()) as { login?: string };
		return { ok: true, login: data.login };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : "Erro de rede",
		};
	}
}

export async function setToken(token: string): Promise<SetTokenResult> {
	const trimmed = token.trim();
	if (!trimmed) return { ok: false, error: "Token vazio" };
	const validation = await validateTokenViaApi(trimmed);
	if (!validation.ok) return validation;
	const proc = Bun.spawn(
		[
			"security",
			"add-generic-password",
			"-U",
			"-a",
			ACCOUNT,
			"-s",
			SERVICE,
			"-w",
			trimmed,
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const code = await proc.exited;
	if (code !== 0) {
		return { ok: false, error: "Falha ao gravar no keychain" };
	}
	cachedToken = trimmed;
	return validation;
}

export async function deleteToken(): Promise<void> {
	const proc = Bun.spawn(
		["security", "delete-generic-password", "-a", ACCOUNT, "-s", SERVICE],
		{ stdout: "pipe", stderr: "pipe" },
	);
	await proc.exited;
	cachedToken = null;
}

export interface TokenStatus {
	hasToken: boolean;
	account?: string;
	login?: string;
}

export async function getStatus(): Promise<TokenStatus> {
	const token = await getToken();
	if (!token) return { hasToken: false, account: ACCOUNT };
	const validation = await validateTokenViaApi(token);
	if (!validation.ok) {
		return { hasToken: true, account: ACCOUNT };
	}
	return { hasToken: true, account: ACCOUNT, login: validation.login };
}

export function _resetCache() {
	cachedToken = undefined;
}
