import { Bot } from "lucide-react";
import { ClaudeSection } from "../settings/claude-section";
import { createAgentSessionProvider } from "./agent-sessions";

export { sessionToResult } from "./agent-sessions";

export const claudeProvider = createAgentSessionProvider({
	agent: "claude",
	label: "Claude Code",
	icon: Bot,
	placeholder: "Pergunte algo ao Claude...",
	configComponent: ClaudeSection,
});
