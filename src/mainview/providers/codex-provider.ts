import { SquareTerminal } from "lucide-react";
import { CodexSection } from "../settings/codex-section";
import { createAgentSessionProvider } from "./agent-sessions";

export const codexProvider = createAgentSessionProvider({
	agent: "codex",
	label: "Codex",
	icon: SquareTerminal,
	placeholder: "Pergunte algo ao Codex...",
	configComponent: CodexSection,
});
