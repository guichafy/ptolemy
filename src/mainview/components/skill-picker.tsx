import { BookOpen, Download, Loader2, Star } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { navigateOptions } from "@/lib/keyboard-navigation";
import type { AgentKind } from "@/shared/agent-protocol";
import type { SkillSummary } from "@/shared/skills";
import { rpc } from "../providers/rpc";

export interface SkillOption {
	id: string;
	name: string;
	description: string;
	origin: string;
	checked: boolean;
	unavailableReason?: string;
	onToggle: (checked: boolean) => void;
}
interface SkillPickerProps {
	extraSkills?: SkillOption[];
	extraLoading?: boolean;
	extraError?: string | null;
	onSaveDefaults?: () => Promise<void>;
	onManage?: () => void;
	agent: AgentKind;
	skills: SkillSummary[];
	selected: string[];
	onSelect: (ids: string[]) => void;
	onImported: (skill: SkillSummary) => void;
	onBusyChange: (busy: boolean) => void;
	disabled?: boolean;
	selectionDisabled?: boolean;
}

export function SkillPicker({
	agent,
	extraSkills = [],
	extraLoading = false,
	extraError = null,
	onSaveDefaults,
	onManage,
	skills,
	selected,
	onSelect,
	onImported,
	onBusyChange,
	disabled,
	selectionDisabled = false,
}: SkillPickerProps) {
	const [url, setUrl] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	async function importSkill() {
		if (busy || !url.trim()) return;
		setBusy(true);
		onBusyChange(true);
		setError(null);
		setSaved(false);
		try {
			const skill = await rpc.request.agentImportSkill({ url: url.trim() });
			onImported(skill);
			setUrl("");
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Não foi possível importar a Skill.",
			);
		} finally {
			setBusy(false);
			onBusyChange(false);
		}
	}
	async function saveDefaults() {
		setBusy(true);
		onBusyChange(true);
		setError(null);
		setSaved(false);
		try {
			if (onSaveDefaults) await onSaveDefaults();
			else
				await rpc.request.agentSetDefaultSkills({ agent, skillIds: selected });
			setSaved(true);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Não foi possível salvar os padrões.",
			);
		} finally {
			setBusy(false);
			onBusyChange(false);
		}
	}
	const count =
		selected.filter((id) =>
			skills.some((s) => s.id === id && !s.unavailableReason),
		).length +
		extraSkills.filter((s) => s.checked && !s.unavailableReason).length;
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					aria-label={`Configurar Skills${count ? ` (${count})` : ""}`}
					className="h-8 gap-1.5 text-xs text-muted-foreground"
				>
					<BookOpen className="h-3.5 w-3.5" /> Skills{" "}
					{count > 0 && (
						<span className="rounded bg-primary/15 px-1.5 text-primary">
							{count}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				onKeyDown={navigateOptions}
				align="start"
				className="w-[380px] max-w-[calc(100vw-32px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-3"
			>
				<div className="mb-2 flex items-center justify-between">
					<h2 className="text-sm font-medium">Skills da conversa</h2>
					<span className="text-xs text-muted-foreground">
						{agent === "claude" ? "Claude" : "Codex"}
					</span>
				</div>
				<p className="mb-3 text-xs text-muted-foreground">
					Selecione as Skills disponíveis para esta conversa. A seleção fica
					salva ao iniciar.
				</p>
				<div className="max-h-72 overflow-y-auto space-y-1">
					{extraLoading && (
						<p role="status" className="text-xs text-muted-foreground">
							Consultando Skills de pacotes…
						</p>
					)}
					{extraError && (
						<p role="alert" className="text-xs text-destructive">
							{extraError}
						</p>
					)}
					{extraSkills.map((option) => (
						<label
							key={option.id}
							className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-accent"
						>
							<input
								type="checkbox"
								className="mt-0.5 accent-primary"
								aria-label={`Usar ${option.name}`}
								checked={option.checked}
								disabled={
									busy ||
									disabled ||
									selectionDisabled ||
									(!option.checked && !!option.unavailableReason)
								}
								onChange={(e) => {
									option.onToggle(e.target.checked);
									setSaved(false);
								}}
							/>
							<span className="min-w-0 break-words">
								<span className="block text-xs font-medium">{option.name}</span>
								<span className="block text-[10px] text-muted-foreground">
									{option.origin}
								</span>
								<span className="block text-xs text-muted-foreground">
									{option.description}
								</span>
								{option.unavailableReason && (
									<span className="block text-xs text-destructive">
										{option.unavailableReason}
									</span>
								)}
							</span>
						</label>
					))}
					{skills.map((skill) => (
						<label
							key={skill.id}
							className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-accent"
							title={skill.localPath}
						>
							<input
								type="checkbox"
								className="mt-0.5 accent-primary"
								aria-label={`Usar ${skill.name}`}
								checked={selected.includes(skill.id)}
								disabled={
									busy ||
									disabled ||
									selectionDisabled ||
									(!selected.includes(skill.id) && !!skill.unavailableReason)
								}
								onChange={(event) => {
									onSelect(
										event.target.checked
											? [...selected, skill.id]
											: selected.filter((id) => id !== skill.id),
									);
									setSaved(false);
								}}
							/>
							<span className="min-w-0">
								<span className="block text-xs font-medium">{skill.name}</span>
								<span className="line-clamp-2 block text-xs text-muted-foreground">
									{skill.description}
								</span>
								{skill.source.kind === "harness" && (
									<span className="block text-[10px]">
										{skill.origin === "system"
											? "Integrada ao sistema"
											: "Instalada localmente"}
									</span>
								)}
								{skill.unavailableReason && (
									<span className="block text-destructive">
										{skill.unavailableReason}
									</span>
								)}
							</span>
						</label>
					))}
					{!skills.length && !extraSkills.length && !extraLoading && (
						<p className="px-2 py-2 text-xs text-muted-foreground">
							Importe uma Skill do GitHub para começar.
						</p>
					)}
				</div>
				<div className="mt-3 border-t pt-3">
					<label
						htmlFor={`skill-url-${agent}`}
						className="mb-1.5 block text-xs font-medium"
					>
						URL da Skill no GitHub
					</label>
					<div className="flex items-center gap-2">
						<Input
							id={`skill-url-${agent}`}
							type="url"
							value={url}
							disabled={busy || disabled}
							onChange={(event) => setUrl(event.target.value)}
							placeholder="https://github.com/autor/repo/tree/main/skill"
							className="h-8 text-xs"
							autoComplete="off"
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void importSkill();
								}
							}}
						/>
						<Button
							type="button"
							size="sm"
							variant="outline"
							aria-label="Importar Skill"
							disabled={busy || disabled || !url.trim()}
							onClick={() => void importSkill()}
							className="h-8 px-2"
						>
							{busy ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Download className="h-3.5 w-3.5" />
							)}
						</Button>
					</div>
					<p className="mt-1.5 text-[10px] text-muted-foreground">
						Repositório público, pasta da Skill ou link de SKILL.md.
					</p>
				</div>
				{error && (
					<p role="alert" className="mt-2 text-xs text-destructive">
						{error}
					</p>
				)}
				<div className="mt-3 flex flex-wrap items-center justify-between gap-2">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-7 gap-1 text-xs"
						disabled={busy || disabled || selectionDisabled}
						onClick={() => void saveDefaults()}
					>
						<Star className="h-3 w-3" />
						Usar seleção como padrão
					</Button>
					{onManage && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={onManage}
						>
							Gerenciar biblioteca
						</Button>
					)}
					{saved && (
						<span role="status" className="text-xs text-muted-foreground">
							Padrão salvo
						</span>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
