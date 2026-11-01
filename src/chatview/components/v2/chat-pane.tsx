/**
 * Chat pane composed from AI Elements primitives, backed by `useAgentChat`
 * and the typed `agentEvent` stream. Default (and only) chat experience.
 */

import { Paperclip, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	type Attachment,
	Attachments,
} from "@/components/ai-elements/attachments";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { ModelPicker } from "@/components/claude/model-picker";
import { Button } from "@/components/ui/button";
import type { ProtocolModelInfo } from "@/shared/agent-protocol";
import {
	type AgentMessage as AgentMessageType,
	computeTurnStatus,
	type SessionState,
} from "../../hooks/agent-state";
import { useAgentChat } from "../../hooks/use-agent-chat";
import { onAgentEvent, onOpenSession, rpc } from "../../rpc";
import { ChatHeader } from "../chat-header";
import { ConfirmationQueue } from "./confirmation-queue";
import { MessagePart as MessagePartRenderer } from "./message-parts";
import { TurnIndicator } from "./turn-indicator";

const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

function partKey(
	message: AgentMessageType,
	part: AgentMessageType["parts"][number],
): string {
	switch (part.kind) {
		case "text":
		case "reasoning":
			return `${message.id}:${part.kind}:${part.messageId}`;
		case "tool":
			return `${message.id}:tool:${part.toolCallId}`;
	}
}

function AgentMessageView({
	message,
	models,
}: {
	message: AgentMessageType;
	models: ProtocolModelInfo[];
}) {
	const modelLabel = message.modelUsed
		? (models.find((m) => m.value === message.modelUsed)?.displayName ??
			message.modelUsed)
		: null;
	return (
		<Message from={message.role}>
			<MessageContent role={message.role}>
				{message.parts.map((part) => (
					<MessagePartRenderer key={partKey(message, part)} part={part} />
				))}
				{modelLabel && (
					<span className="mt-1 inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
						Modelo: {modelLabel}
					</span>
				)}
			</MessageContent>
		</Message>
	);
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
	const [overrideModel, setOverrideModel] = useState<string | null>(null);
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
		const overrideForTurn = overrideModel ?? undefined;
		setOverrideModel(null); // reset BEFORE the await so the user sees the picker reset immediately
		await sendMessage(`${prefix}${text}`, { modelOverride: overrideForTurn });
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

	const messages = state.currentMessage
		? [...state.messages, state.currentMessage]
		: state.messages;
	const status = state.sessionState === "running" ? "streaming" : "ready";
	const hasSubmittableContent = Boolean(draft.trim()) || attachments.length > 0;
	const turnStatus = computeTurnStatus(state);

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<ChatHeader
				agent={agent}
				sessionId={sessionId}
				sessionState={toLegacySessionState(state.sessionState)}
				sessionModel={state.sessionModel}
				models={models}
			/>
			{agent === "claude" && <PlanModeBanner />}
			<Conversation>
				<ConversationContent>
					{messages.length === 0 && (
						<p className="m-auto text-xs text-muted-foreground">
							Inicie a conversa digitando abaixo.
						</p>
					)}
					{messages.map((message) => (
						<AgentMessageView
							key={message.id}
							message={message}
							models={models}
						/>
					))}
					<TurnIndicator
						status={turnStatus.status}
						toolName={turnStatus.toolName}
						agent={agent}
					/>
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			<div className="flex flex-col gap-2 border-t border-border/60 bg-background p-3">
				{state.lastError && state.sessionState !== "running" && (
					<p
						role="alert"
						className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive"
					>
						{state.lastError.message}
					</p>
				)}
				<ConfirmationQueue
					pending={state.pendingPermissions}
					onApprove={approveTool}
					onReject={rejectTool}
				/>
				{state.suggestions.length > 0 && (
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
					<PromptInputTextarea
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						placeholder={
							agent === "codex"
								? "Pergunte algo ao Codex..."
								: "Pergunte algo ao Claude..."
						}
						disabled={state.sessionState === "error"}
					/>
					<PromptInputToolbar>
						<ModelPicker
							variant="turn-override"
							value={overrideModel ?? state.sessionModel}
							sessionDefault={state.sessionModel}
							models={models}
							onChange={(v) =>
								setOverrideModel(v === state.sessionModel ? null : v)
							}
							disabled={state.sessionState !== "idle" || !sessionId}
							placeholder="Modelo do turno"
						/>
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
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => fileInputRef.current?.click()}
							className="h-8 w-8 p-0 text-muted-foreground"
							aria-label="Anexar imagem"
						>
							<Paperclip className="h-3.5 w-3.5" />
						</Button>
						<span className="flex-1" />
						<PromptInputSubmit
							status={status}
							disabled={!hasSubmittableContent && status !== "streaming"}
						/>
					</PromptInputToolbar>
				</PromptInput>
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
		<div className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-300">
			<Sparkles className="h-3 w-3" />
			<span>
				Modo Planejamento ativo — o agente apenas descreve um plano, sem
				executar ferramentas.
			</span>
		</div>
	);
}
