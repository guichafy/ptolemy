import { describe, expect, it } from "vitest";
import { parseLoginStatus } from "./auth";

describe("parseLoginStatus", () => {
	it("reconhece login via ChatGPT", () => {
		expect(parseLoginStatus(0, "Logged in using ChatGPT\n")).toEqual({
			cliStatus: "authenticated",
			method: "chatgpt",
		});
	});

	it("reconhece login via API key", () => {
		expect(
			parseLoginStatus(0, "\nLogged in using an API key - sk-***"),
		).toEqual({ cliStatus: "authenticated", method: "api-key" });
	});

	it("trata exit code diferente de zero como não autenticado", () => {
		expect(parseLoginStatus(1, "Not logged in")).toEqual({
			cliStatus: "not-authenticated",
		});
	});

	it("trata 'Not logged in' como não autenticado mesmo com exit 0", () => {
		expect(parseLoginStatus(0, "Not logged in")).toEqual({
			cliStatus: "not-authenticated",
		});
	});

	it("exit 0 com texto desconhecido conta como autenticado", () => {
		expect(parseLoginStatus(0, "")).toEqual({ cliStatus: "authenticated" });
	});
});
