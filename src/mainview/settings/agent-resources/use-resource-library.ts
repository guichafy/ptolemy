import { useCallback, useEffect, useState } from "react";
import { resourceRpc as rpc } from "@/components/agents/resource-rpc";
import type { AgentKind } from "@/shared/agent-protocol";
import type { ExtensionCapability } from "@/shared/extension-rpc";
import type { ExtensionSelection, ExtensionSummary } from "@/shared/extensions";
import { errorText } from "../extensions-common";
import type { ResourceLibrary } from "./model";
export function useResourceLibrary(agent: AgentKind) {
	const [attempt, setAttempt] = useState(0);
	const [library, setLibrary] = useState<ResourceLibrary>({
		skills: [],
		inventory: null,
		servers: [],
		loading: true,
		error: null,
	});
	const refresh = useCallback(() => setAttempt((a) => a + 1), []);
	useEffect(() => {
		void attempt;
		let cancelled = false;
		setLibrary((l) => ({ ...l, loading: true, error: null }));
		Promise.allSettled([
			rpc.request.agentListSkills({ agent }),
			rpc.request.agentExtensionInventory({ agent }),
			rpc.request.agentMcpList(),
		]).then(([skills, inventory, servers]) => {
			if (cancelled) return;
			const errors = [skills, inventory, servers]
				.filter((r) => r.status === "rejected")
				.map((r) => errorText((r as PromiseRejectedResult).reason));
			setLibrary({
				agent,
				skills: skills.status === "fulfilled" ? skills.value : [],
				inventory: inventory.status === "fulfilled" ? inventory.value : null,
				servers: servers.status === "fulfilled" ? servers.value : [],
				loading: false,
				error: errors.join(" ") || null,
			});
		});
		return () => {
			cancelled = true;
		};
	}, [agent, attempt]);
	return {
		library: {
			...library,
			...(library.agent !== agent
				? {
						agent,
						skills: [],
						inventory: null,
						servers: [],
						loading: true,
						error: null,
					}
				: {}),
		},
		refresh,
	};
}
export interface PackageReviewState {
	capabilities: ExtensionCapability[];
	loading: boolean;
	error: string | null;
}
export function usePackageReview(
	agent: AgentKind,
	packages: ExtensionSummary[],
	selections: ExtensionSelection[],
	enabled = true,
) {
	const [state, setState] = useState<{
		capabilities: ExtensionCapability[];
		loading: boolean;
		error: string | null;
	}>({ capabilities: [], loading: true, error: null });
	const fingerprint = JSON.stringify(
		packages.map((p) => ({
			id: p.id,
			revision: p.revision,
			trust: selections.find(
				(s) => s.packageId === p.id && s.revision === p.revision,
			)?.trustedHookDigest,
		})),
	);
	useEffect(() => {
		if (!enabled) {
			setState({ capabilities: [], loading: false, error: null });
			return;
		}
		let cancelled = false;
		const entries = JSON.parse(fingerprint) as {
			id: string;
			revision: string;
			trust?: string;
		}[];
		setState({ capabilities: [], loading: true, error: null });
		Promise.all(
			entries.map((p) =>
				rpc.request.agentExtensionReview({
					agent,
					packageId: p.id,
					revision: p.revision,
					...(p.trust ? { trustedHookDigest: p.trust } : {}),
				}),
			),
		)
			.then((caps) => {
				if (!cancelled)
					setState({
						capabilities: caps.flatMap((values, index) =>
							values.map((value) => ({
								...value,
								revision: entries[index].revision,
							})),
						),
						loading: false,
						error: null,
					});
			})
			.catch((e) => {
				if (!cancelled)
					setState({ capabilities: [], loading: false, error: errorText(e) });
			});
		return () => {
			cancelled = true;
		};
	}, [agent, fingerprint, enabled]);
	return state;
}
