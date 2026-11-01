import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModelPicker } from "@/components/claude/model-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { ProtocolModelInfo } from "@/shared/agent-protocol";
import { sessionsForAgent } from "../providers/agent-sessions";
import {
	type CodexAuthStatus,
	type CodexReasoningEffort,
	type CodexSandboxMode,
	rpc,
} from "../providers/rpc";
import { useSettings } from "./settings-context";

// Radix Select forbids empty-string values, so "" (CLI default) maps here.
const EFFORT_DEFAULT = "cli-default";

type PendingAction = "install" | "login" | null;

export function CodexSection() {
	const { codexSettings, updateCodexSettings, isOpen } = useSettings();

	const [authStatus, setAuthStatus] = useState<CodexAuthStatus | null>(null);
	const [authLoading, setAuthLoading] = useState(true);
	const [actionLoading, setActionLoading] = useState<PendingAction>(null);
	const [pollingMode, setPollingMode] = useState<PendingAction>(null);
	const [pendingMessage, setPendingMessage] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);

	const [models, setModels] = useState<ProtocolModelInfo[]>([]);
	const [sessionCount, setSessionCount] = useState(0);
	const [clearingHistory, setClearingHistory] = useState(false);

	const refreshAuth = useCallback(async () => {
		try {
			setAuthStatus(await rpc.request.codexGetAuthStatus());
		} catch {
			setAuthStatus({ cliStatus: "not-installed" });
		} finally {
			setAuthLoading(false);
		}
	}, []);

	const refreshSessions = useCallback(async () => {
		try {
			const sessions = await rpc.request.claudeListSessions();
			setSessionCount(sessionsForAgent(sessions, "codex").length);
		} catch {
			setSessionCount(0);
		}
	}, []);

	useEffect(() => {
		refreshAuth();
		refreshSessions();
		rpc.request
			.codexListModels()
			.then((res) => setModels(res.models))
			.catch((err) => console.warn("[settings] codexListModels failed:", err));
	}, [refreshAuth, refreshSessions]);

	// Re-check when the dialog goes from closed to open (user may have logged
	// in from a terminal in the meantime).
	const prevOpenRef = useRef(isOpen);
	useEffect(() => {
		if (!prevOpenRef.current && isOpen) refreshAuth();
		prevOpenRef.current = isOpen;
	}, [isOpen, refreshAuth]);

	// After Install or Login, poll until the status flips (or time out).
	useEffect(() => {
		if (!pollingMode) return;
		const isInstall = pollingMode === "install";
		const timeoutMs = isInstall ? 5 * 60 * 1000 : 2 * 60 * 1000;
		const start = Date.now();
		const id = setInterval(
			async () => {
				if (Date.now() - start > timeoutMs) {
					setPendingMessage(null);
					setPollingMode(null);
					clearInterval(id);
					return;
				}
				const status = await rpc.request.codexGetAuthStatus();
				setAuthStatus(status);
				const done = isInstall
					? status.cliStatus !== "not-installed"
					: status.cliStatus === "authenticated";
				if (done) {
					setPendingMessage(null);
					setPollingMode(null);
					clearInterval(id);
				}
			},
			isInstall ? 5000 : 3000,
		);
		return () => clearInterval(id);
	}, [pollingMode]);

	async function runTerminalAction(kind: "install" | "login") {
		setActionError(null);
		setPendingMessage(null);
		setPollingMode(null);
		setActionLoading(kind);
		try {
			const result =
				kind === "install"
					? await rpc.request.codexInstallCli()
					: await rpc.request.codexOpenLogin();
			if (!result.ok) {
				setActionError(result.error ?? "Falha ao abrir o Terminal");
				return;
			}
			setPendingMessage(
				kind === "install"
					? "Instalando no Terminal aberto..."
					: "Conclua o login no Terminal aberto.",
			);
			setPollingMode(kind);
		} finally {
			setActionLoading(null);
		}
	}

	async function handleClearHistory() {
		setClearingHistory(true);
		try {
			const sessions = await rpc.request.claudeListSessions();
			for (const session of sessionsForAgent(sessions, "codex")) {
				await rpc.request.claudeDeleteSession({ sessionId: session.id });
			}
			await refreshSessions();
		} finally {
			setClearingHistory(false);
		}
	}

	const feedback = (
		<>
			{pendingMessage && (
				<p className="text-xs text-muted-foreground">{pendingMessage}</p>
			)}
			{actionError && <p className="text-xs text-destructive">{actionError}</p>}
		</>
	);

	return (
		<div className="flex flex-col gap-5">
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold">Codex</h2>
				<p className="text-xs text-muted-foreground/80">
					Agente de código da OpenAI, executado pelo Codex CLI instalado no
					sistema.
				</p>
			</div>

			{/* Autenticação */}
			<div className="flex flex-col gap-2.5">
				<h3 className="text-sm font-semibold">Autenticação</h3>
				<div className="flex flex-col gap-2.5 rounded-lg border border-border/50 bg-card/50 p-3">
					{authLoading ? (
						<div className="flex items-center gap-2">
							<Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
							<span className="text-xs text-muted-foreground">
								Verificando...
							</span>
						</div>
					) : authStatus?.cliStatus === "authenticated" ? (
						<>
							<div className="flex items-center gap-2">
								<Badge
									className="border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-400"
									variant="outline"
								>
									{authStatus.method === "api-key"
										? "Conectado via API key"
										: "Conectado via ChatGPT"}
								</Badge>
							</div>
							<p className="text-xs text-muted-foreground">
								Usando a credencial do Codex CLI instalado no sistema.
							</p>
							<p className="text-[10px] text-muted-foreground/70">
								Para desconectar, rode <code>codex logout</code> no Terminal.
							</p>
						</>
					) : authStatus?.cliStatus === "not-installed" ? (
						<div className="flex flex-col gap-2">
							<p className="text-xs text-muted-foreground">
								O Codex CLI não está instalado. Ele será instalado via Terminal
								com <code>npm install -g @openai/codex</code> (requer Node.js).
							</p>
							<Button
								size="sm"
								className="h-7 w-fit text-xs"
								onClick={() => runTerminalAction("install")}
								disabled={actionLoading !== null}
							>
								{actionLoading === "install" ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									"Instalar Codex CLI"
								)}
							</Button>
							{feedback}
						</div>
					) : (
						<div className="flex flex-col gap-2">
							<p className="text-xs text-muted-foreground">
								Entre com sua conta do ChatGPT (ou uma API key) pelo Codex CLI.
							</p>
							<Button
								size="sm"
								className="h-7 w-fit text-xs"
								onClick={() => runTerminalAction("login")}
								disabled={actionLoading !== null}
							>
								{actionLoading === "login" ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									"Abrir Codex para conectar"
								)}
							</Button>
							{feedback}
						</div>
					)}
				</div>
			</div>

			<Separator className="opacity-40" />

			{/* Modelo Padrão */}
			<div className="flex flex-col gap-2.5">
				<h3 className="text-sm font-semibold">Modelo Padrão</h3>
				<ModelPicker
					variant="default"
					value={codexSettings.model}
					models={models}
					onChange={(model) => updateCodexSettings({ model })}
					placeholder="Modelo padrão"
				/>
				<p className="text-[10px] text-muted-foreground/70">
					Vale para novas sessões. A disponibilidade de cada modelo depende do
					seu plano.
				</p>
			</div>

			<Separator className="opacity-40" />

			{/* Esforço de raciocínio */}
			<div className="flex flex-col gap-2.5">
				<h3 className="text-sm font-semibold">Esforço de raciocínio</h3>
				<Select
					value={codexSettings.reasoningEffort || EFFORT_DEFAULT}
					onValueChange={(value) =>
						updateCodexSettings({
							reasoningEffort: (value === EFFORT_DEFAULT
								? ""
								: value) as CodexReasoningEffort,
						})
					}
				>
					<SelectTrigger className="h-8 text-xs" aria-label="Esforço">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={EFFORT_DEFAULT}>Padrão do Codex</SelectItem>
						<SelectItem value="low">Baixo</SelectItem>
						<SelectItem value="medium">Médio</SelectItem>
						<SelectItem value="high">Alto</SelectItem>
						<SelectItem value="xhigh">Muito alto</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<Separator className="opacity-40" />

			{/* Sandbox */}
			<div className="flex flex-col gap-2.5">
				<h3 className="text-sm font-semibold">Permissões</h3>
				<Select
					value={codexSettings.sandboxMode}
					onValueChange={(value) =>
						updateCodexSettings({ sandboxMode: value as CodexSandboxMode })
					}
				>
					<SelectTrigger className="h-8 text-xs" aria-label="Sandbox">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="workspace-write">
							Editar arquivos do projeto
						</SelectItem>
						<SelectItem value="read-only">Somente leitura</SelectItem>
					</SelectContent>
				</Select>
				<p className="text-[10px] text-muted-foreground/70">
					O Codex roda no sandbox do próprio CLI, restrito à pasta de projeto de
					cada conversa, e não pede aprovação por ferramenta.
				</p>
			</div>

			<Separator className="opacity-40" />

			{/* Sessões */}
			<div className="flex flex-col gap-2.5">
				<h3 className="text-sm font-semibold">Sessões</h3>
				<div className="flex items-center justify-between rounded-lg border border-border/50 bg-card/50 p-3">
					<span className="text-xs text-muted-foreground">
						{sessionCount === 1
							? "1 sessão armazenada"
							: `${sessionCount} sessões armazenadas`}
					</span>
					<Button
						size="sm"
						variant="destructive"
						className="h-7 text-xs"
						onClick={handleClearHistory}
						disabled={clearingHistory || sessionCount === 0}
					>
						{clearingHistory ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							<>
								<Trash2 className="h-3 w-3" />
								Limpar Histórico
							</>
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}
