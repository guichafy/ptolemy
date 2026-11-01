/**
 * Chat pane composed from AI Elements primitives, backed by `useAgentChat`
 * and the typed `agentEvent` stream. Default (and only) chat experience.
 */

import { Bot, Paperclip, Sparkles, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type Attachment,
	Attachments,
} from "@/components/ai-elements/attachments";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { ModelPicker } from "@/components/claude/model-picker";
import type { ProtocolModelInfo } from "@/shared/agent-protocol";
import { computeTurnStatus, type SessionState } from "../../hooks/agent-state";
import { useAgentChat } from "../../hooks/use-agent-chat";
import { describeModel } from "../../lib/model-label";
import { onAgentEvent, onOpenSession, rpc } from "../../rpc";
import { ChatHeader } from "../chat-header";
import { AgentMessageView } from "./agent-message";
import { ConfirmationQueue } from "./confirmation-queue";
import { TurnIndicator } from "./turn-indicator";

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const EMPTY_SET: ReadonlySet<string> = new Set();

function toLegacySessionState(
	state: SessionState,
): "idle" | "streaming" | "tool_running" | "error" {
	switch (state) {
		case "running":
			return "streaming";
		case "requires_action":
			return "tool_running";
		case "error":
			return "error";
		default:
			return "idle";
	}
}

async function fileToAttachment(file: File): Promise<Attachment | null> {
	if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return null;
	if (file.size > MAX_IMAGE_BYTES) return null;
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(file);
	});
	return {
		id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		dataUrl,
		mimeType: file.type,
		name: file.name,
		sizeBytes: file.size,
	};
}

export function ChatPaneV2() {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const { state, sendMessage, cancel, approveTool, rejectTool } =
		useAgentChat(sessionId);
	const [draft, setDraft] = useState("");
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [models, setModels] = useState<ProtocolModelInfo[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);
	// Until the session meta loads, assume Claude (the historical default).
	const agent = state.sessionAgent ?? "claude";

	useEffect(() => {
		let cancelled = false;
		setModels([]);
		const refresh = async () => {
			try {
				const res =
					agent === "codex"
						? await rpc.request.codexListModels()
						: await rpc.request.claudeListSupportedModels();
				if (!cancelled) setModels(res.models);
			} catch (err) {
				console.warn(`[chat-pane] list models (${agent}) failed:`, err);
			}
		};
		refresh();
		const unsubscribe = onAgentEvent((args) => {
			if (args.event.type === "models-cache-invalidated") refresh();
		});
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [agent]);

	useEffect(() => {
		onOpenSession(({ sessionId: sid }) => {
			setSessionId(sid);
			rpc.request.claudeResumeSession({ sessionId: sid }).catch((err) => {
				console.error("[chat-v2] resumeSession failed:", err);
			});
		});
	}, []);

	const handleSubmit = async () => {
		const text = draft.trim();
		if (state.sessionState === "running") {
			await cancel();
			return;
		}
		if (!text && attachments.length === 0) return;

		// Image attachments are staged client-side today; wiring them into the
		// SDK's MessageParam[] content is a follow-up (session-manager needs a
		// sendMessageParts path). For now, prefix the text with a reminder.
		const prefix =
			attachments.length > 0
				? `[${attachments.length} anexo${attachments.length > 1 ? "s" : ""} pendente${attachments.length > 1 ? "s" : ""} — envio multimodal chega em um follow-up]\n`
				: "";
		setDraft("");
		setAttachments([]);
		await sendMessage(`${prefix}${text}`);
	};

	// The composer's picker is the only model selector: it changes the
	// session model (persisted, applies from the next turn on).
	const handleModelChange = async (model: string) => {
		if (!sessionId || model === state.sessionModel) return;
		try {
			await rpc.request.claudeSetSessionModel({ sessionId, model });
		} catch (err) {
			console.error("[chat-pane] setSessionModel failed:", err);
		}
	};

	const handleFilesSelected = async (files: FileList | null) => {
		if (!files) return;
		const next: Attachment[] = [];
		for (const file of Array.from(files)) {
			const attachment = await fileToAttachment(file);
			if (attachment) next.push(attachment);
		}
		if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
	};

	const removeAttachment = (id: string) =>
		setAttachments((prev) => prev.filter((a) => a.id !== id));

	const turnStatus = computeTurnStatus(state);
	const isRunning = state.sessionState === "running";
	const status = isRunning
		? turnStatus.status === "waiting"
			? "submitted"
			: "streaming"
		: "ready";
	const hasSubmittableContent = Boolean(draft.trim()) || attachments.length > 0;
	const awaitingToolIds = useMemo<ReadonlySet<string>>(
		() =>
			state.pendingPermissions.length > 0
				? new Set(state.pendingPermissions.map((p) => p.toolCallId))
				: EMPTY_SET,
		[state.pendingPermissions],
	);
	const agentName = agent === "codex" ? "Codex" : "Claude";
	const sessionModelInfo = describeModel(
		state.sessionModel,
		state.resolvedModel,
		models,
	);
	const sessionModelLabel = sessionModelInfo?.isAlias
		? sessionModelInfo.primary
		: null;
	const isEmpty = state.messages.length === 0 && !state.currentMessage;

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<ChatHeader
				agent={agent}
				sessionId={sessionId}
				sessionState={toLegacySessionState(state.sessionState)}
				sessionModel={state.sessionModel}
				resolvedModel={state.resolvedModel}
				contextUsage={state.contextUsage}
				stats={state.stats}
				models={models}
			/>
			{agent === "claude" && <PlanModeBanner />}
			<Conversation>
				<ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-5 py-6">
					{isEmpty && (
						<ConversationEmptyState
							className="min-h-[50vh]"
							icon={
								agent === "codex" ? (
									<SquareTerminal className="size-8" />
								) : (
									<Bot className="size-8" />
								)
							}
							title={`Converse com o ${agentName}`}
							description="Digite sua mensagem abaixo para começar."
						/>
					)}
					{state.messages.map((message) => (
						<AgentMessageView
							key={message.id}
							message={message}
							models={models}
						/>
					))}
					{state.currentMessage && (
						<AgentMessageView
							key={state.currentMessage.id}
							message={state.currentMessage}
							models={models}
							isStreaming
							awaitingToolIds={awaitingToolIds}
						/>
					)}
					<TurnIndicator
						status={turnStatus.status}
						toolName={turnStatus.toolName}
						agent={agent}
					/>
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			<div className="shrink-0 bg-background px-4 pt-2 pb-4">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
					{state.lastError && !isRunning && (
						<p
							role="alert"
							className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-xs"
						>
							{state.lastError.message}
						</p>
					)}
					<ConfirmationQueue
						pending={state.pendingPermissions}
						onApprove={approveTool}
						onReject={rejectTool}
					/>
					{state.suggestions.length > 0 && !isRunning && (
						<Suggestions>
							{state.suggestions.map((suggestion) => (
								<Suggestion
									key={suggestion}
									suggestion={suggestion}
									onSuggestionClick={(s) => setDraft(s)}
								/>
							))}
						</Suggestions>
					)}
					<Attachments items={attachments} onRemove={removeAttachment} />
					<PromptInput onSubmit={handleSubmit}>
						<PromptInputBody>
							<PromptInputTextarea
								value={draft}
								onChange={(e) => setDraft(e.target.value)}
								placeholder={`Pergunte algo ao ${agentName}...`}
								disabled={state.sessionState === "error"}
								autoFocus
							/>
						</PromptInputBody>
						<PromptInputFooter>
							<PromptInputTools>
								<input
									ref={fileInputRef}
									type="file"
									accept={ACCEPTED_IMAGE_TYPES.join(",")}
									multiple
									className="hidden"
									onChange={(e) => {
										handleFilesSelected(e.target.files).catch(() => {});
										e.target.value = "";
									}}
								/>
								<PromptInputButton
									onClick={() => fileInputRef.current?.click()}
									aria-label="Anexar imagem"
								>
									<Paperclip className="size-4" />
								</PromptInputButton>
								<ModelPicker
									variant="turn-override"
									value={state.sessionModel}
									models={models}
									onChange={handleModelChange}
									disabled={state.sessionState !== "idle" || !sessionId}
									placeholder="Selecionar modelo"
									resolvedLabel={sessionModelLabel}
								/>
							</PromptInputTools>
							<PromptInputSubmit
								status={status}
								disabled={!hasSubmittableContent && status === "ready"}
							/>
						</PromptInputFooter>
					</PromptInput>
				</div>
			</div>
		</div>
	);
}

/**
 * Banner surfaced above the conversation when the session runs under
 * `permissionMode: "plan"`. Reads settings once at mount — the setting is
 * only consulted at session creation so a live update wouldn't affect the
 * current session anyway.
 */
function PlanModeBanner() {
	const [planMode, setPlanMode] = useState(false);
	useEffect(() => {
		rpc.request
			.loadSettings()
			.then((settings) =>
				setPlanMode(settings.claude.permissionMode === "plan"),
			)
			.catch(() => {});
	}, []);
	if (!planMode) return null;
	return (
		<div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-300">
			<Sparkles className="h-3 w-3" />
			<span>
				Modo Planejamento ativo — o agente apenas descreve um plano, sem
				executar ferramentas.
			</span>
		</div>
	);
}
