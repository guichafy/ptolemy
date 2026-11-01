import { describe, expect, it } from "vitest";
import { decodeSecret, encodeSecret } from "./secret-encoding";

describe("native MCP secret envelope", () => {
	it("encodes empty values into a nonempty versioned payload", () => {
		expect(encodeSecret("").toString("utf8")).toBe('{"version":1,"value":""}');
		expect(decodeSecret(Buffer.from('{"version":1,"value":""}'))).toBe("");
	});
	it("preserves exact Unicode, NUL and lone-surrogate string values", () => {
		const fixture = 'á🧪\0\ud800\n"';
		expect(decodeSecret(encodeSecret(fixture))).toBe(fixture);
	});
	it.each([
		"",
		"secret-probe",
		'{"version":2,"value":"secret-probe"}',
		'{"version":1,"value":123}',
		'{"version":1,"value":"secret-probe","extra":true}',
	])("rejects malformed or unsupported stored payload without echoing it: %s", (payload) => {
		let message = "";
		try {
			decodeSecret(Buffer.from(payload));
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toBe("Formato de credencial MCP inválido.");
		expect(message).not.toContain("secret-probe");
	});
	it("rejects invalid UTF-8 and oversized stored payloads", () => {
		expect(() => decodeSecret(Buffer.from([0xff]))).toThrow(
			"Formato de credencial MCP inválido.",
		);
		expect(() => decodeSecret(Buffer.alloc(1048577))).toThrow();
		expect(() => encodeSecret("x".repeat(1048576))).toThrow();
	});
});
