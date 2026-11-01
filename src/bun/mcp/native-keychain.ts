import { join } from "node:path";
import {
	decodeSecret,
	encodeSecret,
	MAX_STORED_SECRET_BYTES,
} from "./secret-encoding";

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
const MAX_BYTES = MAX_STORED_SECRET_BYTES;
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
		return decodeSecret(output.subarray(0, size));
	} finally {
		output.fill(0);
	}
}
export function writeSecret(key: string, value: string): void {
	const bytes = encodeSecret(value);
	try {
		if (lib.symbols.mcpWriteSecret(account(key), bytes, bytes.length) !== 0)
			throw Error("Keychain write failed");
	} finally {
		bytes.fill(0);
	}
}
export function deleteSecret(key: string): void {
	if (lib.symbols.mcpDeleteSecret(account(key)) !== 0)
		throw Error("Keychain delete failed");
}
