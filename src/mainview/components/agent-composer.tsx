import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	PromptInput,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import type { AgentKind } from "@/shared/agent-protocol";
import type { SkillSummary } from "@/shared/skills";
import { useWindowShown } from "../hooks/use-window-shown";
import { rpc } from "../providers/rpc";
import { SkillPicker } from "./skill-picker";

interface AgentComposerProps {
	agent: AgentKind;
	value: string;
	onChange: (value: string) => void;
	onCreated: () => void;
}

export function AgentComposer({
	agent,
	value,
	onChange,
	onCreated,
}: AgentComposerProps) {
	const [skills, setSkills] = useState<SkillSummary[]>([]);
	const [selected, setSelected] = useState<string[]>([]);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [configuring, setConfiguring] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const textarea = useRef<HTMLTextAreaElement>(null);
	const inFlight = useRef(false);
	const mounted = useRef(true);
	const label = agent === "claude" ? "Claude" : "Codex";
	const loadCatalog = useCallback(async () => {
		setLoading(true);
		setCatalogError(null);
		try {
			const catalog = await rpc.request.agentListSkills({ agent });
			if (!mounted.current) return;
			setSkills(catalog);
			setSelected(
				catalog
					.filter(
						(skill) =>
							skill.source.kind === "github" &&
							skill.defaultFor.includes(agent),
					)
					.map((skill) => skill.id),
			);
		} catch (err) {
			if (mounted.current)
				setCatalogError(
					err instanceof Error
						? err.message
						: "Não foi possível carregar as Skills.",
				);
		} finally {
			if (mounted.current) setLoading(false);
		}
	}, [agent]);
	useEffect(() => {
		mounted.current = true;
		void loadCatalog();
		return () => {
			mounted.current = false;
		};
	}, [loadCatalog]);
	useWindowShown(() => {
		textarea.current?.focus();
	});
	async function submit() {
		if (
			inFlight.current ||
			loading ||
			configuring ||
			catalogError ||
			!value.trim()
		)
			return;
		inFlight.current = true;
		setSubmitting(true);
		setError(null);
		try {
			await rpc.request.claudeCreateSession({
				agent,
				prompt: value.trim(),
				skillIds: selected,
			});
			if (mounted.current) onCreated();
		} catch (err) {
			if (mounted.current)
				setError(
					err instanceof Error
						? err.message
						: "Não foi possível iniciar a conversa.",
				);
		} finally {
			inFlight.current = false;
			if (mounted.current) setSubmitting(false);
		}
	}
	return (
		<fieldset
			aria-label={`Nova conversa com ${label}`}
			data-agent-composer
			className="min-w-0 border-b px-4 py-3"
			onKeyDown={(event) => {
				event.stopPropagation();
			}}
		>
			<PromptInput
				onSubmit={() => void submit()}
				className="rounded-xl border-border/70 bg-background/60 p-2.5 shadow-none"
			>
				<PromptInputTextarea
					ref={textarea}
					autoFocus
					rows={2}
					maxHeight={128}
					aria-label={`Mensagem para ${label}`}
					placeholder={`O que vamos fazer com ${label}?`}
					value={value}
					disabled={submitting}
					onChange={(event) => onChange(event.target.value)}
					onKeyDown={(event) => {
						if (
							event.nativeEvent.isComposing ||
							event.nativeEvent.keyCode === 229
						) {
							if (event.key === "Enter") event.preventDefault();
						}
					}}
					className="min-h-16 px-2 py-1.5 text-[15px]"
					autoComplete="off"
					autoCorrect="off"
					autoCapitalize="off"
				/>
				{selected.length > 0 && (
					<div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto px-2">
						{selected.map((id) => {
							const skill = skills.find((item) => item.id === id);
							return (
								<button
									key={id}
									type="button"
									disabled={submitting}
									aria-label={`Remover ${skill?.name ?? id}`}
									onClick={() =>
										setSelected((ids) => ids.filter((value) => value !== id))
									}
									className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[11px] text-primary"
								>
									{skill?.name}
									<X className="h-3 w-3" />
								</button>
							);
						})}
					</div>
				)}
				<PromptInputFooter className="justify-between p-0">
					<SkillPicker
						agent={agent}
						skills={skills}
						selected={selected}
						onSelect={setSelected}
						onBusyChange={setConfiguring}
						onImported={(skill) => {
							setSkills((items) => [...items, skill]);
							setSelected((ids) => [...ids, skill.id]);
						}}
						disabled={loading || submitting || !!catalogError}
					/>
					<div className="flex items-center gap-3">
						<span className="text-[10px] text-muted-foreground">
							⇧↵ nova linha
						</span>
						<PromptInputSubmit
							aria-label="Iniciar conversa"
							disabled={
								loading ||
								submitting ||
								configuring ||
								!!catalogError ||
								!value.trim()
							}
						/>
					</div>
				</PromptInputFooter>
			</PromptInput>
			{(error || catalogError) && (
				<div role="alert" className="mt-2 text-xs text-destructive">
					{error || catalogError}
					{catalogError && (
						<button
							type="button"
							className="ml-2 underline"
							onClick={() => void loadCatalog()}
						>
							Tentar novamente
						</button>
					)}
				</div>
			)}
		</fieldset>
	);
}
