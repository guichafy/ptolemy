import { expect, test } from "vitest";
import { SessionExecutions } from "./session-execution";

test("Stop cancels pending work before it begins", async () => {
	const work = new SessionExecutions();
	let ran = false;
	const promise = work.run("a", async () => {
		ran = true;
	});
	expect(work.abort()).toBe(true);
	await expect(promise).rejects.toThrow();
	expect(ran).toBe(false);
	expect(work.abort()).toBe(false);
});
test("switch/delete drain canceled work without canceling another session", async () => {
	const work = new SessionExecutions();
	const seen: string[] = [];
	const pending = (id: string) =>
		work.run(
			id,
			(signal) =>
				new Promise<void>((resolve) =>
					signal.addEventListener(
						"abort",
						() => {
							seen.push(id);
							resolve();
						},
						{ once: true },
					),
				),
		);
	const a = pending("a"),
		b = pending("b");
	await Promise.resolve();
	await work.cancelExcept("b");
	expect(seen).toEqual(["a"]);
	await work.cancel("b");
	await Promise.all([a, b]);
	expect(seen).toEqual(["a", "b"]);
});
