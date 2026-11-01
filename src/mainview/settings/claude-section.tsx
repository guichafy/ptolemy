import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ModelPicker } from "@/components/claude/model-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { ProtocolModelInfo } from "@/shared/agent-protocol";
import { sessionsForAgent } from "../providers/agent-sessions";
import {
	type ClaudeAuthMode,
	type ClaudeAuthStatus,
	type ClaudePermissionMode,
	onAgentEvent,
	rpc,
} from "../providers/rpc";
import { McpServersSection } from "./mcp-servers";
import { useSettings } from "./settings-context";

export function ClaudeSection() {
	const { settings, isOpen } = useSettings();

	// Auth state
	const [authStatus, setAuthStatus] = useState<ClaudeAuthStatus | null>(null);
	const [authLoading, setAuthLoading] = useState(true);
	const [actionLoading, setActionLoading] = useState<
		"install" | "login" | null
	>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [pendingMessage, setPendingMessage] = useState<string | null>(null);
	const [pollingMode, setPollingMode] = useState<"install" | "login" | null>(
		null,
	);

	// Auth mode toggle (local, synced to settings)
	const [authMode, setAuthMode] = useState<ClaudeAuthMode>(
		settings?.claude?.authMode ?? "anthropic",
	);

	// Bedrock fields
	const [bedrockEndpoint, setBedrockEndpoint] = useState("");
	const [bedrockProfile, setBedrockProfile] = useState("");
	const [bedrockRegion, setBedrockRegion] = useState("");
	const [bedrockSaving, setBedrockSaving] = useState(false);

	// Model & permissions (synced to settings)
	const [model, setModel] = useState(
		settings?.claude?.model ?? "claude-sonnet-4-6",
	);
	const [permissionMode, setPermissionMode] = useState<ClaudePermissionMode>(
		settings?.claude?.permissionMode ?? "acceptEdits",
	);

	// Model list (fetched from SDK on mount)
	const [models, setModels] = useState<ProtocolModelInfo[]>([]);
	const [loadingModels, setLoadingModels] = useState(true);

	// Sessions
	const [sessionCount, setSessionCount] = useState(0);
	const [clearingHistory, setClearingHistory] = useState(false);

	// Sync from settings when they load
	useEffect(() => {
		if (settings?.claude) {
			setAuthMode(settings.claude.authMode);
			setModel(settings.claude.model);
			setPermissionMode(settings.claude.permissionMode);
		}
	}, [settings?.claude]);

	// Fetch model list on mount and re-fetch when models cache is invalidated
	useEffect(() => {
		let cancelled = false;
		const refresh = async () => {
			setLoadingModels(true);
			try {
				const res = await rpc.request.claudeListSupportedModels();
				if (!cancelled) setModels(res.models);
			} catch (err) {
				console.warn("[settings] claudeListSupportedModels failed:", err);
				if (!cancelled) setModels([]);
			} finally {
				if (!cancelled) setLoadingModels(false);
			}
		};
		refresh();
		const unsubscribe = onAgentEvent((args) => {
			if (args.event.type === "models-cache-invalidated") {
				refresh();
			}
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	const refreshAuth = useCallback(async () => {
		try {
			const status = await rpc.request.claudeGetAuthStatus();
			setAuthStatus(status);
			// If bedrock config exists, populate fields
			if (status.bedrock) {
				setBedrockEndpoint(status.bedrock.endpoint);
				setBedrockProfile(status.bedrock.profile);
				setBedrockRegion(status.bedrock.region);
			}
		} catch {
			setAuthStatus({ mode: "none" });
		} finally {
			setAuthLoading(false);
		}
	}, []);

	const refreshSessions = useCallback(async () => {
		try {
			const sessions = await rpc.request.claudeListSessions();
			setSessionCount(sessionsForAgent(sessions, "claude").length);
		} catch {
			setSessionCount(0);
		}
	}, []);

	useEffect(() => {
		refreshAuth();
		refreshSessions();
	}, [refreshAuth, refreshSessions]);

	// Polling: after Install or Login, poll until status transitions
	useEffect(() => {
		if (!pollingMode) return;
		const isInstall = pollingMode === "install";
		const intervalMs = isInstall ? 5000 : 3000;
		const timeoutMs = isInstall ? 5 * 60 * 1000 : 2 * 60 * 1000;
		const start = Date.now();

		const id = setInterval(async () => {
			if (Date.now() - start > timeoutMs) {
				setPendingMessage(null);
				setPollingMode(null);
				clearInterval(id);
				return;
			}
			const status = await rpc.request.claudeGetAuthStatus();
			setAuthStatus(status);
			const done = isInstall
				? status.anthropic?.cliStatus !== "not-installed"
				: status.anthropic?.cliStatus === "authenticated";
			if (done) {
				setPendingMessage(null);
				setPollingMode(null);
				clearInterval(id);
			}
		}, intervalMs);

		return () => clearInterval(id);
	}, [pollingMode]);

	// Refresh auth when the dialog transitions from closed → open
	const prevOpenRef = useRef(isOpen);
	useEffect(() => {
		if (!prevOpenRef.current && isOpen) {
			refreshAuth();
		}
		prevOpenRef.current = isOpen;
	}, [isOpen, refreshAuth]);

	// Persist a claude settings change
	async function persistClaudeSetting(
		patch: Partial<{
			authMode: ClaudeAuthMode;
			model: string;
			permissionMode: ClaudePermissionMode;
		}>,
	) {
		try {
			const current = await rpc.request.loadSettings();
			const updated = {
				...current,
				claude: { ...current.claude, ...patch },
			};
			await rpc.request.saveSettings(updated);
		} catch {
			// silent
		}
	}

	function handleAuthModeChange(mode: ClaudeAuthMode) {
		setAuthMode(mode);
		persistClaudeSetting({ authMode: mode });
	}

	async function handleInstallCli() {
		setActionError(null);
		setPendingMessage(null);
		setPollingMode(null);
		setActionLoading("install");
		try {
			const result = await rpc.request.claudeInstallCli();
			if (!result.ok) {
				setActionError(result.error ?? "Falha ao abrir o Terminal");
				return;
			}
			setPendingMessage("Instalando no Terminal aberto...");
			setPollingMode("install");
		} finally {
			setActionLoading(null);
		}
	}

	async function handleOpenLogin() {
		setActionError(null);
		setPendingMessage(null);
		setPollingMode(null);
		setActionLoading("login");
		try {
			const result = await rpc.request.claudeOpenLogin();
			if (!result.ok) {
				setActionError(result.error ?? "Falha ao abrir o Terminal");
				return;
			}
			setPendingMessage("Conclua o login no Terminal aberto.");
			setPollingMode("login");
		} finally {
			setActionLoading(null);
		}
	}

	async function handleBedrockSave() {
		setBedrockSaving(true);
		try {
			await rpc.request.claudeSetBedrock({
				endpoint: bedrockEndpoint,
				profile: bedrockProfile,
				region: bedrockRegion,
			});
			await refreshAuth();
		} finally {
			setBedrockSaving(false);
		}
	}

	function handleModelChange(value: string) {
		setModel(value);
		persistClaudeSetting({ model: value });
	}

	function handlePermissionChange(value: ClaudePermissionMode) {
		setPermissionMode(value);
		persistClaudeSetting({ permissionMode: value });
	}

	async function handleClearHistory() {
		setClearingHistory(true);
		try {
			// Codex sessions live in the same store; clear only Claude's here.
			const sessions = await rpc.request.claudeListSessions();
			for (const session of sessionsForAgent(sessions, "claude")) {
				await rpc.request.claudeDeleteSession({ sessionId: session.id });
			}
			await refreshSessions();
		} finally {
			setClearingHistory(false);
		}
	}

	return (
		<div className="flex flex-col gap-5">
			{/* Header */}
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold">Claude Code</h2>
				<p className="text-xs text-muted-foreground/80">
					Configuração de autenticação, modelo e permissões.
				</p>
			</div>

			{/* Autenticação */}
			<div className="flex flex-col gap-2.5">
				<h3 className="text-sm font-semibold">Autenticação</h3>

				{/* Auth mode toggle */}
				<div className="flex gap-1 rounded-lg border border-border/50 bg-card/50 p-1">
					<button
						type="button"
						className={cn(
							"flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
							authMode === "anthropic"
								? "bg-primary text-primary-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => handleAuthModeChange("anthropic")}
					>
						Anthropic SSO
					</button>
					<button
						type="button"
						className={cn(
							"flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
							authMode === "bedrock"
								? "bg-primary text-primary-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => handleAuthModeChange("bedrock")}
					>
						AWS Bedrock
					</button>
				</div>

				{/* Anthropic SSO panel */}
				{authMode === "anthropic" && (
					<div className="flex flex-col gap-2.5 rounded-lg border border-border/50 bg-card/50 p-3">
						{authLoading ? (
							<div className="flex items-center gap-2">
								<Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
								<span className="text-xs text-muted-foreground">
									Verificando...
								</span>
							</div>
						) : authStatus?.anthropic?.cliStatus === "authenticated" ? (
							<>
								<div className="flex items-center gap-2">
									<Badge
										className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] px-1.5 py-0"
										variant="outline"
									>
										Conectado via Claude Code
									</Badge>
								</div>
								<p className="text-xs text-muted-foreground">
									Usando credencial do Claude Code instalado no sistema.
								</p>
								<p className="text-[10px] text-muted-foreground/70">
									Para desconectar, rode <code>claude /logout</code> no
									Terminal.
								</p>
							</>
						) : authStatus?.anthropic?.cliStatus === "not-installed" ? (
							<div className="flex flex-col gap-2">
								<p className="text-xs text-muted-foreground">
									O Claude Code não está instalado. Ele será baixado de{" "}
									<code>claude.ai/install.sh</code> e instalado via Terminal.
								</p>
								<Button
									size="sm"
									className="h-7 text-xs w-fit"
									onClick={handleInstallCli}
									disabled={actionLoading !== null}
								>
									{actionLoading === "install" ? (
										<Loader2 className="h-3 w-3 animate-spin" />
									) : (
										"Instalar Claude Code"
									)}
								</Button>
								{pendingMessage && (
									<p className="text-xs text-muted-foreground">
										{pendingMessage}
									</p>
								)}
								{actionError && (
									<p className="text-xs text-destructive">{actionError}</p>
								)}
							</div>
						) : (
							<div className="flex flex-col gap-2">
								<p className="text-xs text-muted-foreground">
									Você precisa entrar na sua conta Anthropic pelo Claude Code.
								</p>
								<Button
									size="sm"
									className="h-7 text-xs w-fit"
									onClick={handleOpenLogin}
									disabled={actionLoading !== null}
								>
									{actionLoading === "login" ? (
										<Loader2 className="h-3 w-3 animate-spin" />
									) : (
										"Abrir Claude Code para conectar"
									)}
								</Button>
								{pendingMessage && (
									<p className="text-xs text-muted-foreground">
										{pendingMessage}
									</p>
								)}
								{actionError && (
									<p className="text-xs text-destructive">{actionError}</p>
								)}
							</div>
						)}
					</div>
				)}

				{/* AWS Bedrock panel */}
				{authMode === "bedrock" && (
					<div className="flex flex-col gap-2.5 rounded-lg border border-border/50 bg-card/50 p-3">
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="bedrock-endpoint"
								className="text-xs font-medium text-muted-foreground"
							>
								Endpoint URL
							</label>
							<Input
								id="bedrock-endpoint"
								placeholder="https://bedrock-runtime.us-east-1.amazonaws.com"
								value={bedrockEndpoint}
								onChange={(e) => setBedrockEndpoint(e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="bedrock-profile"
								className="text-xs font-medium text-muted-foreground"
							>
								Profile
							</label>
							<Input
								id="bedrock-profile"
								placeholder="default"
								value={bedrockProfile}
								onChange={(e) => setBedrockProfile(e.target.value)}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="bedrock-region"
								className="text-xs font-medium text-muted-foreground"
							>
								Region
							</label>
							<Input
								id="bedrock-region"
								placeholder="us-east-1"
								value={bedrockRegion}
								onChange={(e) => setBedrockRegion(e.target.value)}
							/>
						</div>
						<Button
							size="sm"
							className="h-7 text-xs w-fit"
							onClick={handleBedrockSave}
							disabled={bedrockSaving}
						>
							{bedrockSaving ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								"Salvar"
							)}
						</Button>
					</div>
				)}
			</div>

			<Separator className="opacity-40" />

			{/* Modelo Padrão */}
			<div className="flex flex-col gap-2.5">
				<h3 className="text-sm font-semibold">Modelo Padrão</h3>
				<ModelPicker
					variant="default"
					value={model}
					models={models}
					onChange={handleModelChange}
					disabled={loadingModels && models.length === 0}
					placeholder="Modelo padrão"
				/>
			</div>

			<Separator className="opacity-40" />

			{/* Permissões */}
			<div className="flex flex-col gap-2.5">
				<h3 className="text-sm font-semibold">Permissões</h3>
				<Select value={permissionMode} onValueChange={handlePermissionChange}>
					<SelectTrigger className="h-8 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="dontAsk">Não perguntar</SelectItem>
						<SelectItem value="acceptEdits">Aceitar edições</SelectItem>
						<SelectItem value="bypassPermissions">
							Automático completo
						</SelectItem>
						<SelectItem value="plan">Apenas planejar</SelectItem>
					</SelectContent>
				</Select>
			</div>

			<Separator className="opacity-40" />

			<McpServersSection />

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
