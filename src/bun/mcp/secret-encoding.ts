/** Nonempty, versioned representation for atomic Keychain replacement. Some
 * native Keychain updates accept zero bytes without replacing the old value. */
export const MAX_STORED_SECRET_BYTES = 1024 * 1024;
const invalid = () => Error("Formato de credencial MCP inválido.");
export function encodeSecret(value: string): Buffer {
	const encoded = Buffer.from(JSON.stringify({ version: 1, value }), "utf8");
	if (encoded.length > MAX_STORED_SECRET_BYTES) {
		encoded.fill(0);
		throw invalid();
	}
	return encoded;
}
export function decodeSecret(bytes: Uint8Array): string {
	try {
		if (bytes.length === 0 || bytes.length > MAX_STORED_SECRET_BYTES)
			throw invalid();
		const value: unknown = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		);
		if (
			!value ||
			typeof value !== "object" ||
			Array.isArray(value) ||
			Object.keys(value).length !== 2 ||
			!("version" in value) ||
			value.version !== 1 ||
			!("value" in value) ||
			typeof value.value !== "string"
		)
			throw invalid();
		return value.value;
	} catch {
		throw invalid();
	}
}
