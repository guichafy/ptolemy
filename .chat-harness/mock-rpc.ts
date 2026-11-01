type Listener = (args: { sessionId: string; event: any }) => void;
const listeners = new Set<Listener>();
const SID = "a74ec1f4-2b9c-4d1e-9f00-1234567890ab";
const scenario = new URLSearchParams(location.search).get("s") ?? "claude";
const isCodex = scenario === "codex";
const ts = "2026-11-01T10:00:00.000Z";
const codexModels = [
  { value: "default", displayName: "Padrão do Codex", description: "Usa o modelo configurado no Codex CLI", resolvesTo: "gpt-6-astra" },
  { value: "gpt-6-astra", displayName: "GPT-6 Astra", description: "Mais capaz" },
];
const claudeModels = [
  { value: "default", displayName: "Default (recommended)", description: "Use the default model" },
  { value: "sonnet", displayName: "Sonnet", description: "Sonnet 4.5" },
];
const stored = [
  { version: 2, role: "user", blocks: [{ type: "text", text: "Analisa o projeto e me diz onde está a lentidão do chat." }], timestamp: ts },
  { version: 2, role: "assistant", timestamp: ts, durationMs: 48200, model: isCodex ? "gpt-6-astra" : "claude-opus-4-5-20251101", cost: isCodex ? undefined : 0.4213,
    blocks: [
      { type: "tool_use", id: "t1", name: isCodex ? "Shell" : "Grep", input: isCodex ? { command: "rg -n useReducer src" } : { pattern: "useReducer" }, status: "done" },
      { type: "tool_result", toolUseId: "t1", content: "src/chatview/hooks/use-agent-chat.ts:1" },
      { type: "text", text: "O gargalo é o reducer ser despachado a cada `text-delta`." },
    ] },
];
const meta = {
  id: SID, sdkSessionId: "th_1", agent: isCodex ? "codex" : "claude", title: "t", projectId: "p", projectPath: "/x",
  model: "default", createdAt: ts, updatedAt: ts, messageCount: 2, lastMessage: "",
  resolvedModel: isCodex ? "gpt-6-astra" : "claude-opus-4-5-20251101",
  contextUsage: isCodex
    ? { usedTokens: 61840, maxTokens: 272000, inputTokens: 6900, cacheReadTokens: 54000, outputTokens: 940, reasoningTokens: 312, updatedAt: ts }
    : { usedTokens: 71400, maxTokens: 200000, inputTokens: 12, cacheReadTokens: 68800, cacheCreationTokens: 2000, outputTokens: 588, lastTurnCostUsd: 0.0613, updatedAt: ts },
  stats: isCodex ? { compactions: 1, lastCompaction: { at: ts } } : { compactions: 2, totalCostUsd: 1.8734, lastCompaction: { trigger: "auto", preTokens: 167200, at: ts } },
};
const claudeBreakdown = { source: "claude", model: "claude-opus-4-5-20251101", usedTokens: 71400, maxTokens: 200000, autoCompactThreshold: 167000,
  categories: [ { name: "Prompt do sistema", tokens: 3100 }, { name: "Ferramentas do sistema", tokens: 16900 }, { name: "Ferramentas MCP", tokens: 8200 }, { name: "Arquivos de memória (CLAUDE.md)", tokens: 2400 }, { name: "Skills", tokens: 1200 }, { name: "Mensagens", tokens: 39600 }, { name: "Ferramentas MCP (sob demanda)", tokens: 4100, isDeferred: true } ],
  sections: [
    { title: "Mensagens por tipo", items: [ { name: "Resultados de ferramenta", tokens: 27100 }, { name: "Respostas do agente", tokens: 7200 }, { name: "Chamadas de ferramenta", tokens: 3100 }, { name: "Mensagens do usuário", tokens: 2200 } ] },
    { title: "Ferramentas usadas na conversa", items: [ { name: "Read", tokens: 18200, hint: "chamada 400 · resultado 17800" }, { name: "Grep", tokens: 6100, hint: "chamada 300 · resultado 5800" } ] },
    { title: "Ferramentas MCP", items: [ { name: "search_repositories", tokens: 1900, hint: "github" } ] },
  ] };
const codexBreakdown = { source: "codex-estimate", model: "gpt-6-astra", usedTokens: 61840, maxTokens: 272000,
  categories: [ { name: "Prompt do sistema e ferramentas", tokens: 14200 }, { name: "Saídas de ferramenta", tokens: 30100 }, { name: "Raciocínio", tokens: 7400 }, { name: "Respostas do agente", tokens: 4100 }, { name: "Resumo da compactação", tokens: 3200 }, { name: "Mensagens do usuário", tokens: 1800 }, { name: "Chamadas de ferramenta", tokens: 1040 } ],
  sections: [ { title: "Ferramentas (chamadas + saídas)", items: [ { name: "shell", tokens: 29900 }, { name: "apply_patch", tokens: 1240 } ] } ],
  note: "Estimativa: o Codex informa só o total. As fatias vêm do tamanho de cada item do histórico da thread (~4 caracteres por token); o restante é o prompt do sistema e as definições de ferramentas, que não ficam gravados." };
export const rpc = { request: {
  codexListModels: async () => ({ models: codexModels }),
  claudeListSupportedModels: async () => ({ models: claudeModels, authMode: "anthropic" }),
  claudeResumeSession: async () => true, claudeGetSessionMessages: async () => stored,
  claudeListSessions: async () => [meta], claudeSendMessage: async () => ({}), claudeStopGeneration: async () => true,
  claudeSetSessionModel: async () => ({ ok: true }), loadSettings: async () => ({ claude: { permissionMode: "default" } }),
  openUrl: async () => true, agentApproveTool: async () => true, agentRejectTool: async () => true,
  agentGetContextBreakdown: async () => { await new Promise((r) => setTimeout(r, 300)); return { ok: true, breakdown: isCodex ? codexBreakdown : claudeBreakdown }; },
} };
export function onAgentEvent(cb: Listener) { listeners.add(cb); return () => listeners.delete(cb); }
export function onOpenSession(cb: (a: { sessionId: string }) => void) { setTimeout(() => cb({ sessionId: SID }), 0); }
