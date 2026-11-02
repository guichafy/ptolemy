import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AgentKind } from "@/shared/agent-protocol";
import { useResourceLibrary } from "./use-resource-library";

const request = vi.hoisted(() => ({
	agentListSkills: vi.fn(),
	agentExtensionInventory: vi.fn(),
	agentMcpList: vi.fn(),
}));
vi.mock("@/components/agents/resource-rpc", () => ({
	resourceRpc: { request },
}));
beforeEach(() => vi.resetAllMocks());
it("never exposes the previous harness inventory while the next harness loads", async () => {
	request.agentListSkills.mockImplementation(({ agent }) =>
		agent === "claude"
			? Promise.resolve([
					{
						id: "claude-only",
						name: "Claude native",
						description: "",
						source: { kind: "harness", agent: "claude" },
						defaultFor: ["claude"],
					},
				])
			: new Promise(() => {}),
	);
	request.agentExtensionInventory.mockResolvedValue({
		installed: [],
		nativePlugins: [{ id: "claude-native-plugin" }],
		builtins: [{ name: "claude-builtin" }],
		verifiedRuntime: "claude",
	});
	request.agentMcpList.mockResolvedValue([]);
	const { result, rerender } = renderHook(
		({ agent }: { agent: AgentKind }) => useResourceLibrary(agent),
		{ initialProps: { agent: "claude" as AgentKind } },
	);
	await waitFor(() => expect(result.current.library.skills).toHaveLength(1));
	rerender({ agent: "codex" });
	expect(result.current.library.loading).toBe(true);
	expect(result.current.library.skills).toEqual([]);
	expect(result.current.library.inventory).toBeNull();
	expect(result.current.library.agent).toBe("codex");
	await act(async () => {});
});
