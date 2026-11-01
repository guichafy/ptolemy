import { createHash } from "node:crypto";
import type { SkillFile } from "@/shared/skills";
export const commit = "a".repeat(40);
export function githubFixture(
	files: Record<string, string>,
	options: {
		mode?: string;
		truncated?: boolean;
		size?: number;
		mismatch?: boolean;
		ref?: string;
	} = {},
) {
	const blobs = Object.entries(files).map(([path, content]) => ({
		path,
		content,
		sha: createHash("sha1")
			.update(`blob ${Buffer.byteLength(content)}\0${content}`)
			.digest("hex"),
	}));
	const requests: string[] = [];
	const fetcher = async (url: string) => {
		requests.push(url);
		const path = new URL(url).pathname;
		if (path.includes("/commits/"))
			return Response.json(
				decodeURIComponent(path.split("/commits/")[1]) ===
					(options.ref ?? "HEAD") || path.endsWith(`/${commit}`)
					? { sha: commit }
					: { message: "Not Found" },
				{
					status:
						decodeURIComponent(path.split("/commits/")[1]) ===
							(options.ref ?? "HEAD") || path.endsWith(`/${commit}`)
							? 200
							: 404,
				},
			);
		if (path.includes("/git/trees/"))
			return Response.json({
				truncated: options.truncated ?? false,
				tree: blobs.map((b) => ({
					path: b.path,
					sha: b.sha,
					mode: options.mode ?? "100644",
					type: options.mode === "160000" ? "commit" : "blob",
					size: options.size ?? Buffer.byteLength(b.content),
				})),
			});
		const blob = blobs.find((b) => url.endsWith(`/git/blobs/${b.sha}`));
		if (blob)
			return Response.json({
				encoding: "base64",
				size: Buffer.byteLength(blob.content),
				content: Buffer.from(
					options.mismatch ? `${blob.content}x` : blob.content,
				).toString("base64"),
			});
		return Response.json({}, { status: 404 });
	};
	return { fetcher, requests };
}

export const skill = (name: string) =>
	`---\nname: ${name}\ndescription: Test ${name}\nuser-invocable: false\nallowed-tools: [Read, Bash]\n---\nSkill body`;
export const records = (files: Record<string, string>): SkillFile[] =>
	Object.entries(files).map(([path, text]) => ({
		path,
		content: Buffer.from(text).toString("base64"),
		executable: false,
	}));
