import { useEffect, useRef, useState } from "react";
import { configureResourceRpc } from "@/components/agents/resource-rpc";
import { Button } from "@/components/ui/button";
import type { AgentKind } from "@/shared/agent-protocol";
import type { ExtensionChoices } from "@/shared/extension-rpc";
import { rpc } from "../../providers/rpc";
import { errorText } from "../extensions-common";
import {
	defaultChoices,
	emptyChoices,
	type ResourcePage,
	resourceLabels,
} from "./model";
import { useResourceLibrary } from "./use-resource-library";
import { ResourceWorkspace } from "./workspace";
export function AgentResourcePreferences({
	agent,
	page,
}: {
	agent: AgentKind;
	page: ResourcePage;
}) {
	configureResourceRpc(rpc);
	const { library, refresh } = useResourceLibrary(agent);
	const [choices, setChoices] = useState<ExtensionChoices>(emptyChoices);
	const initialized = useRef<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (library.loading || library.error || initialized.current === agent)
			return;
		initialized.current = agent;
		setChoices(defaultChoices(agent, library));
	}, [agent, library]);
	async function save() {
		setBusy(true);
		setMessage(null);
		setError(null);
		try {
			await rpc.request.agentExtensionSetDefaults({ agent, ...choices });
			setMessage("Padrão salvo para novas conversas.");
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<header className="mb-4 shrink-0">
				<h2 className="text-lg font-semibold">
					{resourceLabels[page]} do {agent === "claude" ? "Claude" : "Codex"}
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Configure os recursos disponíveis e o padrão de novas conversas.
				</p>
			</header>
			<ResourceWorkspace
				key={page}
				agent={agent}
				page={page}
				library={library}
				choices={choices}
				onChange={(c) => {
					setChoices(c);
					setMessage(null);
				}}
				onRefresh={refresh}
				onBusyChange={setBusy}
			/>
			<footer className="mt-3 shrink-0 border-t pt-3">
				{error && (
					<p role="alert" className="mb-2 text-sm text-destructive">
						{error}
					</p>
				)}
				{message && (
					<p role="status" className="mb-2 text-sm text-muted-foreground">
						{message}
					</p>
				)}
				<Button
					size="sm"
					disabled={busy || library.loading || !!library.error}
					onClick={() => void save()}
				>
					Usar seleção como padrão
				</Button>
			</footer>
		</div>
	);
}
