import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
	McpConnectionStatus,
	McpCredentialEdit,
	McpEditableServer,
	McpOAuthRegistration,
} from "@/shared/mcp";
import { rpc } from "../providers/rpc";
import {
	ExtensionError,
	errorText,
	ExtensionField as Field,
} from "./extensions-common";

const states: Record<McpConnectionStatus["state"], string> = {
	disconnected: "Desconectado",
	connecting: "Conectando",
	waiting: "Aguardando no navegador",
	connected: "Conectado",
	expired: "Conexão expirada",
	cancelled: "Conexão cancelada",
	error: "Falha de conexão",
};
type SecretRow = { key: string; name: string; edit: McpCredentialEdit };
function rows(map?: Record<string, McpCredentialEdit>): SecretRow[] {
	return Object.entries(map ?? {}).map(([name, edit]) => ({
		key: crypto.randomUUID(),
		name,
		edit,
	}));
}
function SecretFields({
	label,
	items,
	onChange,
	disabled,
}: {
	label: string;
	items: SecretRow[];
	onChange: (rows: SecretRow[]) => void;
	disabled: boolean;
}) {
	return (
		<fieldset className="space-y-2">
			<legend className="text-xs font-medium">{label}</legend>
			{items.map((row, index) => (
				<div key={row.key} className="flex flex-wrap gap-2">
					<Input
						aria-label={`${label} nome ${index + 1}`}
						className="min-w-0 flex-1"
						value={row.name}
						disabled={disabled}
						onChange={(e) =>
							onChange(
								items.map((r) =>
									r.key === row.key ? { ...r, name: e.target.value } : r,
								),
							)
						}
					/>
					<Input
						type="password"
						autoComplete="new-password"
						aria-label={`${label} valor ${index + 1}`}
						placeholder={
							"preserve" in row.edit
								? "Credencial salva ••••"
								: "Valor (pode ser vazio)"
						}
						value={"value" in row.edit ? row.edit.value : ""}
						disabled={disabled}
						className="min-w-0 flex-1"
						onChange={(e) =>
							onChange(
								items.map((r) =>
									r.key === row.key
										? { ...r, edit: { value: e.target.value } }
										: r,
								),
							)
						}
					/>
					<Button
						size="sm"
						variant="ghost"
						disabled={disabled}
						onClick={() => onChange(items.filter((r) => r.key !== row.key))}
					>
						Remover campo
					</Button>
				</div>
			))}
			<Button
				size="sm"
				variant="outline"
				disabled={disabled}
				onClick={() =>
					onChange([
						...items,
						{ key: crypto.randomUUID(), name: "", edit: { value: "" } },
					])
				}
			>
				Adicionar {label.toLowerCase()}
			</Button>
			<p className="text-[11px] text-muted-foreground">
				Credencial salva é preservada. Digitar substitui; remover campo exclui.
				Um valor vazio é salvo como vazio. Ao renomear um campo, informe seu
				novo valor.
			</p>
		</fieldset>
	);
}
export function McpEditor({
	initial,
	isSaved = false,
	binding,
	onSaved,
	onCancel,
}: {
	initial: McpEditableServer;
	isSaved?: boolean;
	binding?: { packageId: string; revision: string; componentId: string };
	onSaved: () => void;
	onCancel: () => void;
}) {
	const [draft, setDraft] = useState(initial);
	const [scopes, setScopes] = useState(
		initial.transport === "http" ? (initial.auth?.scopes?.join(" ") ?? "") : "",
	);
	const [scopesEdited, setScopesEdited] = useState(false);
	const [args, setArgs] = useState(
		initial.transport === "stdio" ? JSON.stringify(initial.args ?? []) : "[]",
	);
	const [fields, setFields] = useState(
		rows(initial.transport === "stdio" ? initial.env : initial.headers),
	);
	const [dirty, setDirty] = useState(!isSaved);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [argsError, setArgsError] = useState<string | null>(null);
	const argsRef = useRef<HTMLInputElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const commandRef = useRef<HTMLInputElement>(null);
	const urlRef = useRef<HTMLInputElement>(null);
	const argsErrorId = useId();
	const [saved, setSaved] = useState(false);
	const [connection, setConnection] = useState<McpConnectionStatus>({
		state: "disconnected",
	});
	const [registration, setRegistration] = useState<McpOAuthRegistration | null>(
		null,
	);
	const mounted = useRef(true);
	const generation = useRef(0);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			generation.current++;
		};
	}, []);
	const change = (patch: Partial<McpEditableServer>) => {
		setDraft((d) => ({ ...d, ...patch }) as McpEditableServer);
		setDirty(true);
		setRegistration(null);
		setSaved(false);
		generation.current++;
	};
	useEffect(() => {
		if (dirty || draft.transport !== "http" || !draft.auth) return;
		let cancelled = false;
		let timer: ReturnType<typeof setTimeout>;
		const poll = async () => {
			try {
				const status = await rpc.request.agentMcpStatus({ id: draft.id });
				if (!cancelled) {
					setConnection(status);
					if (["connecting", "waiting"].includes(status.state))
						timer = setTimeout(() => void poll(), 750);
				}
			} catch (err) {
				if (!cancelled) setError(errorText(err));
			}
		};
		void poll();
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [dirty, draft]);
	async function action(fn: () => Promise<unknown>) {
		if (busy) return;
		const current = ++generation.current;
		setBusy(true);
		setError(null);
		try {
			await fn();
		} catch (err) {
			if (mounted.current && current === generation.current)
				setError(errorText(err));
		} finally {
			if (mounted.current) setBusy(false);
		}
	}
	async function save() {
		setArgsError(null);
		setError(null);
		if (!draft.name.trim()) {
			setError("Nome é obrigatório.");
			nameRef.current?.focus();
			return;
		}
		if (draft.transport === "stdio" && !draft.command.trim()) {
			setError("Comando é obrigatório.");
			commandRef.current?.focus();
			return;
		}
		if (draft.transport === "http" && !draft.url.trim()) {
			setError("URL do servidor é obrigatória.");
			urlRef.current?.focus();
			return;
		}
		if (draft.transport === "stdio") {
			try {
				const parsed = JSON.parse(args);
				if (!Array.isArray(parsed) || parsed.some((a) => typeof a !== "string"))
					throw Error();
			} catch {
				setArgsError("Argumentos devem ser um array JSON de strings.");
				argsRef.current?.focus();
				argsRef.current?.scrollIntoView({ block: "center" });
				return;
			}
		}
		await action(async () => {
			const map: Record<string, McpCredentialEdit> = Object.create(null);
			for (const row of fields) {
				if (!row.name || row.name in map)
					throw Error("Nomes de credenciais devem ser únicos e preenchidos.");
				map[row.name] = row.edit;
			}
			let value: McpEditableServer;
			if (draft.transport === "stdio") {
				let parsed: unknown;
				try {
					parsed = JSON.parse(args);
				} catch {
					throw Error("Argumentos devem ser um array JSON de strings.");
				}
				if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== "string"))
					throw Error("Argumentos devem ser um array JSON de strings.");
				value = { ...draft, args: parsed, env: map };
			} else
				value = {
					...draft,
					headers: map,
					...(draft.auth
						? {
								auth: {
									...draft.auth,
									...(scopesEdited
										? { scopes: scopes.split(/\s+/).filter(Boolean) }
										: {}),
								},
							}
						: {}),
				};
			await rpc.request.agentMcpSave({
				draft: value,
				...(binding ? { binding } : {}),
			});
			if (!mounted.current) return;
			setDraft(value);
			setDirty(false);
			setSaved(true);
			onSaved();
		});
	}
	const oauth = draft.transport === "http" ? draft.auth : undefined;
	return (
		<div className="space-y-4 min-w-0">
			<div>
				<h3 className="text-sm font-semibold">
					{binding ? "Configurar MCP da extensão" : "Editar servidor MCP"}
				</h3>
				<p className="mt-1 text-xs text-muted-foreground">
					Salve explicitamente antes de conectar. Credenciais existentes nunca
					são exibidas.
				</p>
			</div>
			<fieldset disabled={busy} className="space-y-3 min-w-0">
				<Field label="Nome">
					<Input
						ref={nameRef}
						value={draft.name}
						onChange={(e) => change({ name: e.target.value })}
					/>
				</Field>
				<Field label="Transporte">
					<select
						className="rounded-md border bg-background p-2"
						value={draft.transport}
						onChange={(e) => {
							setFields([]);
							setArgs("[]");
							change(
								e.target.value === "stdio"
									? { transport: "stdio", command: "" }
									: { transport: "http", url: "" },
							);
							setDraft((d) =>
								e.target.value === "stdio"
									? {
											id: d.id,
											name: d.name,
											defaults: d.defaults,
											packageId: d.packageId,
											transport: "stdio",
											command: "",
										}
									: {
											id: d.id,
											name: d.name,
											defaults: d.defaults,
											packageId: d.packageId,
											transport: "http",
											url: "",
										},
							);
						}}
					>
						<option value="stdio">Processo local (stdio)</option>
						<option value="http">HTTP Streamable</option>
					</select>
				</Field>
				{draft.transport === "stdio" ? (
					<>
						<Field label="Comando">
							<Input
								ref={commandRef}
								value={draft.command}
								onChange={(e) => change({ command: e.target.value })}
							/>
						</Field>
						<Field label="Argumentos (JSON)">
							<Input
								ref={argsRef}
								aria-invalid={!!argsError}
								aria-describedby={argsError ? argsErrorId : undefined}
								value={args}
								onChange={(e) => {
									setArgs(e.target.value);
									setArgsError(null);
									change({});
								}}
							/>
						</Field>
						{argsError && (
							<p
								id={argsErrorId}
								role="alert"
								className="text-xs text-destructive"
							>
								{argsError}
							</p>
						)}
						<p className="text-[11px] text-muted-foreground">
							Argumentos são literais. Use variáveis de ambiente para
							credenciais.
						</p>
					</>
				) : (
					<>
						<Field label="URL do servidor">
							<Input
								type="url"
								ref={urlRef}
								value={draft.url}
								onChange={(e) => change({ url: e.target.value })}
							/>
						</Field>
						<Field label="Autenticação">
							<select
								className="rounded-md border bg-background p-2"
								value={oauth ? "oauth" : "none"}
								onChange={(e) =>
									change({
										auth:
											e.target.value === "oauth"
												? { type: "oauth" }
												: undefined,
									})
								}
							>
								<option value="none">Sem OAuth (headers opcionais)</option>
								<option value="oauth">OAuth no navegador</option>
							</select>
						</Field>
					</>
				)}
				<SecretFields
					label={
						draft.transport === "stdio" ? "Variáveis de ambiente" : "Headers"
					}
					items={fields}
					disabled={busy}
					onChange={(v) => {
						setFields(v);
						change({});
					}}
				/>
				{oauth && (
					<>
						<p className="text-xs text-muted-foreground">
							Registro dinâmico ou cliente previamente registrado. Para obter o
							redirecionamento, salve sem client ID e descubra o emissor.
						</p>
						{(["issuer", "resource", "clientId"] as const).map((key) => (
							<Field
								key={key}
								label={
									{
										issuer: "Emissor OAuth (opcional)",
										resource: "Recurso OAuth (opcional)",
										clientId: "Client ID (opcional)",
									}[key]
								}
							>
								<Input
									value={oauth[key] ?? ""}
									onChange={(e) =>
										change({
											auth: { ...oauth, [key]: e.target.value || undefined },
										})
									}
								/>
							</Field>
						))}
						<Field label="Escopos (separados por espaço)">
							<Input
								value={scopes}
								onChange={(e) => {
									setScopes(e.target.value);
									setScopesEdited(true);
									change({});
								}}
							/>
						</Field>
						<Field label="Client secret (opcional)">
							<Input
								type="password"
								autoComplete="new-password"
								placeholder={
									oauth.clientSecret && "preserve" in oauth.clientSecret
										? "Credencial salva ••••"
										: "Valor"
								}
								value={
									oauth.clientSecret && "value" in oauth.clientSecret
										? oauth.clientSecret.value
										: ""
								}
								onChange={(e) =>
									change({
										auth: { ...oauth, clientSecret: { value: e.target.value } },
									})
								}
							/>
						</Field>
						{oauth.clientSecret && (
							<Button
								size="sm"
								variant="ghost"
								onClick={() =>
									change({ auth: { ...oauth, clientSecret: undefined } })
								}
							>
								Remover client secret
							</Button>
						)}
					</>
				)}
				{!draft.packageId && (
					<div className="flex flex-wrap gap-4 text-xs">
						{(["claude", "codex"] as const).map((agent) => (
							<label key={agent} className="flex gap-2">
								<input
									type="checkbox"
									className="accent-primary focus-visible:outline-2 focus-visible:outline-primary"
									checked={draft.defaults[agent]}
									onChange={(e) =>
										change({
											defaults: {
												...draft.defaults,
												[agent]: e.target.checked,
											},
										})
									}
								/>
								Padrão {agent === "claude" ? "Claude" : "Codex"}
							</label>
						))}
					</div>
				)}
			</fieldset>
			<p className="text-xs text-muted-foreground">
				Codex pode executar ferramentas dos servidores selecionados sem
				confirmação a cada chamada. Claude mantém sua autorização por
				ferramenta.
			</p>
			<ExtensionError error={error} />
			<div className="sticky bottom-0 flex flex-wrap gap-2 bg-background py-2">
				<Button size="sm" disabled={busy} onClick={() => void save()}>
					Salvar servidor
				</Button>
				<Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
					Cancelar edição
				</Button>
				{saved && (
					<span
						role="status"
						className="self-center text-xs text-muted-foreground"
					>
						Servidor salvo
					</span>
				)}
			</div>
			{oauth && (
				<div className="space-y-2 border-t pt-3">
					<p role="status" className="text-xs">
						{dirty
							? "Salve a configuração para consultar a conexão."
							: states[connection.state]}
						{connection.message && ` — ${connection.message}`}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={dirty || busy}
							onClick={() =>
								void action(async () => {
									const r = await rpc.request.agentMcpRegistration({
										id: draft.id,
									});
									if (mounted.current) setRegistration(r);
								})
							}
						>
							Obter URI de registro
						</Button>
						<Button
							size="sm"
							disabled={
								dirty ||
								busy ||
								["connecting", "waiting"].includes(connection.state)
							}
							onClick={() =>
								void action(async () => {
									const r = await rpc.request.agentMcpConnect({ id: draft.id });
									if (mounted.current) {
										setConnection(r);
										setDraft((d) => ({ ...d }));
									}
								})
							}
						>
							Conectar no navegador
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={
								dirty ||
								busy ||
								!["connecting", "waiting"].includes(connection.state)
							}
							onClick={() =>
								void action(async () => {
									await rpc.request.agentMcpCancel({ id: draft.id });
									if (mounted.current) setConnection({ state: "cancelled" });
									setDraft((d) => ({ ...d }));
								})
							}
						>
							Cancelar conexão
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={dirty || busy}
							onClick={() =>
								void action(async () => {
									await rpc.request.agentMcpDisconnect({ id: draft.id });
									if (mounted.current) setConnection({ state: "disconnected" });
									setDraft((d) => ({ ...d }));
								})
							}
						>
							Desconectar
						</Button>
					</div>
					{registration && (
						<div className="space-y-2 text-xs">
							<p className="break-all">Emissor: {registration.issuer}</p>
							<p>
								Registre esta URI exata como redirecionamento loopback nativo,
								permitindo porta variável:
							</p>
							<Input
								aria-label="URI de redirecionamento"
								readOnly
								value={registration.redirectUri}
							/>
							<Button
								size="sm"
								variant="outline"
								onClick={() =>
									void action(async () => {
										await navigator.clipboard.writeText(
											registration.redirectUri,
										);
									})
								}
							>
								Copiar URI
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() =>
									change({
										auth: {
											...oauth,
											issuer: registration.issuer,
											resource: registration.resource,
										},
									})
								}
							>
								Fixar emissor e recurso
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
