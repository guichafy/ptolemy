import { join } from "node:path";

// This module is imported only when the real vault is first used. Node/Vitest never
// needs Bun FFI; production never launches a subprocess with credential arguments.
const { dlopen, FFIType } = await import("bun:ffi");
const lib = dlopen(join(import.meta.dir, "..", "native", "liboverlay.dylib"), {
	mcpReadSecret: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
		returns: FFIType.i32,
	},
	mcpWriteSecret: {
		args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
		returns: FFIType.i32,
	},
	mcpDeleteSecret: { args: [FFIType.ptr], returns: FFIType.i32 },
} as const);
const MAX_BYTES = 1024 * 1024;
function account(key: string): Buffer {
	if (!/^[a-zA-Z0-9_.:-]{1,256}$/.test(key))
		throw Error("Invalid credential reference");
	return Buffer.from(`${key}\0`);
}
export function readSecret(key: string): string | undefined {
	const output = Buffer.alloc(MAX_BYTES);
	try {
		const size = lib.symbols.mcpReadSecret(account(key), output, output.length);
		if (size === -1) return undefined;
		if (size < 0 || size > MAX_BYTES) throw Error("Keychain read failed");
		return output.toString("utf8", 0, size);
	} finally {
		output.fill(0);
	}
}
export function writeSecret(key: string, value: string): void {
	const length = Buffer.byteLength(value, "utf8");
	if (length > MAX_BYTES) throw Error("Keychain write failed");
	const bytes = Buffer.alloc(Math.max(length, 1));
	bytes.write(value, "utf8");
	try {
		if (
			length > MAX_BYTES ||
			lib.symbols.mcpWriteSecret(account(key), bytes, length) !== 0
		)
			throw Error("Keychain write failed");
	} finally {
		bytes.fill(0);
	}
}
export function deleteSecret(key: string): void {
	if (lib.symbols.mcpDeleteSecret(account(key)) !== 0)
		throw Error("Keychain delete failed");
}
