type Listener = (args: { sessionId: string; event: any }) => void;
const listeners = new Set<Listener>();
let openCb: ((a: { sessionId: string }) => void) | null = null;
const SID = "a74ec1f4-2b9c-4d1e-9f00-1234567890ab";
const scenario = (new URLSearchParams(location.search).get("s") ?? "codex") as string;
const isCodex = scenario.startsWith("codex");

const codexModels = [
  { value: "default", displayName: "Padrão do Codex", description: "Usa o modelo configurado no Codex CLI", resolvesTo: "gpt-6-astra" },
  { value: "gpt-6-astra", displayName: "GPT-6 Astra", description: "Mais capaz" },
  { value: "gpt-6.1-sol", displayName: "GPT-6.1 Sol", description: "Custo menor" },
];
const claudeModels = [
  { value: "default", displayName: "Default (recommended)", description: "Opus 4.5" },
  { value: "sonnet", displayName: "Sonnet", description: "Sonnet 4.5" },
];

const ts = "2026-11-01T10:00:00.000Z";
const stored: any[] = [
  { version: 2, role: "user", blocks: [{ type: "text", text: "Quem é o presidente do Brasil?" }], timestamp: ts },
  { version: 2, role: "assistant", timestamp: ts, durationMs: 8400, model: isCodex ? "gpt-6-astra" : "claude-opus-4-5-20251101", ...(isCodex ? {} : { cost: 0.0213 }),
    blocks: [
      { type: "tool_use", id: "t1", name: "Shell", input: { command: "bash -lc 'cat ~/.agents/skills/verification/SKILL.md | head -40'" }, status: "done", elapsedSeconds: 0.4 },
      { type: "tool_result", toolUseId: "t1", content: "# Verification\nAlways check an official, current source before answering." },
      { type: "text", text: "Vou usar a orientação de verificação e consultar uma fonte oficial atualizada." },
      { type: "tool_use", id: "t2", name: "WebSearch", input: { query: "presidente do Brasil 2026 site:gov.br" }, status: "done" },
      { type: "tool_result", toolUseId: "t2", content: "Senado Federal — Presidência da República" },
      { type: "text", text: "O atual presidente do Brasil é **Luiz Inácio Lula da Silva (Lula)**, do PT. [Fonte: Senado Federal](https://www12.senado.leg.br)" },
    ] },
];
if (scenario.endsWith("-long")) {
  stored.push(
    { version: 2, role: "user", blocks: [{ type: "text", text: "Escreve uma função TypeScript que soma os tokens de uma lista de mensagens e explica a complexidade." }], timestamp: ts },
    { version: 2, role: "assistant", timestamp: ts, durationMs: 21300, model: isCodex ? "gpt-6-astra" : "claude-opus-4-5-20251101",
      blocks: [
        { type: "thinking", thinking: "Preciso de uma função pura, tipada, com reduce. Vale mencionar O(n).", durationMs: 3200 },
        { type: "tool_use", id: "t3", name: "TodoWrite", input: { todos: [ { content: "Definir o tipo Message", status: "completed" }, { content: "Implementar sumTokens", status: "completed" }, { content: "Escrever testes", status: "in_progress" } ] }, status: "done" },
        { type: "tool_use", id: "t4", name: "ApplyPatch", input: { changes: [ { path: "/Users/guichafy/.ptolomeu/projects/p1/src/tokens.ts", kind: "add" } ] }, status: "done" },
        { type: "tool_result", toolUseId: "t4", content: "Success. Updated the following files:\nA src/tokens.ts" },
        { type: "text", text: "Pronto! Criei `src/tokens.ts`:\n\n```ts\nexport interface Message {\n  role: \"user\" | \"assistant\";\n  tokens: number;\n}\n\nexport function sumTokens(messages: Message[]): number {\n  return messages.reduce((total, m) => total + m.tokens, 0);\n}\n```\n\n### Complexidade\n\n| Operação | Tempo | Espaço |\n| --- | --- | --- |\n| `sumTokens` | O(n) | O(1) |\n\n- Percorre a lista **uma vez**;\n- Não aloca estruturas auxiliares.\n\n> Dica: se a lista for enorme e atualizada com frequência, mantenha um contador incremental." },
      ] },
  );
}

const meta = {
  id: SID, sdkSessionId: "th_1", agent: isCodex ? "codex" : "claude", title: "t", projectId: "p", projectPath: "/x",
  model: "default", createdAt: ts, updatedAt: ts, messageCount: stored.length, lastMessage: "",
  resolvedModel: isCodex ? "gpt-6-astra" : "claude-opus-4-5-20251101",
  contextUsage: isCodex
    ? { usedTokens: 31840, maxTokens: 272000, inputTokens: 30900, cacheReadTokens: 24064, outputTokens: 940, reasoningTokens: 312, updatedAt: ts }
    : { usedTokens: 152400, maxTokens: 200000, inputTokens: 12, cacheReadTokens: 148000, cacheCreationTokens: 3800, outputTokens: 588, lastTurnCostUsd: 0.0213, updatedAt: ts },
};

export const rpc = {
  request: {
    codexListModels: async () => ({ models: codexModels }),
    claudeListSupportedModels: async () => ({ models: claudeModels, authMode: "anthropic" }),
    claudeResumeSession: async () => ({ ok: true }),
    claudeGetSessionMessages: async () => stored,
    claudeListSessions: async () => [meta],
    claudeSendMessage: async () => ({ ok: true }),
    claudeStopGeneration: async () => true,
    claudeSetSessionModel: async () => ({ ok: true }),
    loadSettings: async () => ({ claude: { permissionMode: "default" } }),
    openUrl: async () => true,
    agentApproveTool: async () => true,
    agentRejectTool: async () => true,
  },
};
export function onAgentEvent(cb: Listener) { listeners.add(cb); return () => listeners.delete(cb); }
export function onOpenSession(cb: (a: { sessionId: string }) => void) { openCb = cb; setTimeout(() => cb({ sessionId: SID }), 0); }
(window as any).__emit = (event: any) => listeners.forEach((l) => l({ sessionId: SID, event }));
(window as any).__sid = SID;
