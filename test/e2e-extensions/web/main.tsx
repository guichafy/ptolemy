import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentComposer } from "@/mainview/components/agent-composer";
import {
	SettingsProvider,
	useSettings,
} from "@/mainview/settings/settings-context";
import { SettingsDialog } from "@/mainview/settings/settings-dialog";
import "@/mainview/index.css";
function Harness() {
	const { openDialog } = useSettings();
	const [value, setValue] = useState("");
	const composer = location.search.includes("composer");
	useEffect(() => {
		if (!composer) openDialog("extensions");
	}, [openDialog, composer]);
	return composer ? (
		<div className="mx-auto mt-12 max-w-[760px]">
			<AgentComposer
				agent={location.search.includes("claude") ? "claude" : "codex"}
				value={value}
				onChange={setValue}
				onCreated={() => {}}
			/>
		</div>
	) : (
		<SettingsDialog />
	);
}
createRoot(document.getElementById("root")!).render(
	<SettingsProvider>
		<Harness />
	</SettingsProvider>,
);
