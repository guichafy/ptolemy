import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStore } from "./project-store";

describe("ProjectStore", () => {
	let root: string;
	let store: ProjectStore;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "ptolemy-projects-"));
		store = new ProjectStore({ root });
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("creates a project whose id is a slug + shortid and whose path exists on disk", async () => {
		const project = await store.create({ title: "Corrigir login SSO" });

		expect(project.id).toMatch(/^corrigir-login-sso-[a-z0-9]{6}$/);
		expect(project.name).toBe("Corrigir login SSO");
		expect(project.path).toBe(join(root, project.id));
		expect(existsSync(project.path)).toBe(true);
		expect(project.createdAt).toBe(project.updatedAt);
	});

	it("falls back to 'projeto' when the title yields an empty slug", async () => {
		const project = await store.create({ title: "   !!!   " });
		expect(project.id).toMatch(/^projeto-[a-z0-9]{6}$/);
	});

	it("truncates long slugs to 40 chars before appending the shortid", async () => {
		const longTitle = "a".repeat(100);
		const project = await store.create({ title: longTitle });
		const [slug] = project.id.split(/-(?=[a-z0-9]{6}$)/);
		expect(slug.length).toBeLessThanOrEqual(40);
	});

	it("disambiguates concurrent creations with different shortids", async () => {
		const [a, b] = await Promise.all([
			store.create({ title: "Mesmo título" }),
			store.create({ title: "Mesmo título" }),
		]);
		expect(a.id).not.toBe(b.id);
		expect(existsSync(a.path)).toBe(true);
		expect(existsSync(b.path)).toBe(true);
	});

	it("persists projects in the index file and returns them via list()", async () => {
		const first = await store.create({ title: "Primeiro" });
		const second = await store.create({ title: "Segundo" });

		const listed = await store.list();
		const ids = listed.map((p) => p.id).sort();
		expect(ids).toEqual([first.id, second.id].sort());
	});

	it("loads persisted projects via a fresh store instance", async () => {
		const created = await store.create({ title: "Retomar depois" });
		const fresh = new ProjectStore({ root });
		const loaded = await fresh.get(created.id);
		expect(loaded).toMatchObject({
			id: created.id,
			name: "Retomar depois",
			path: created.path,
		});
	});

	it("returns null for unknown project ids", async () => {
		expect(await store.get("nao-existe-123456")).toBeNull();
	});

	it("deletes the project entry and removes the folder", async () => {
		const project = await store.create({ title: "Apagar" });
		expect(existsSync(project.path)).toBe(true);

		const ok = await store.delete(project.id);
		expect(ok).toBe(true);
		expect(existsSync(project.path)).toBe(false);
		expect(await store.get(project.id)).toBeNull();
	});

	it("returns false when deleting an unknown project", async () => {
		expect(await store.delete("fantasma-123456")).toBe(false);
	});

	it("rejects ids that would escape the root (defense in depth)", async () => {
		await expect(store.get("../escape")).resolves.toBeNull();
		await expect(store.delete("../escape")).resolves.toBe(false);
	});
});
