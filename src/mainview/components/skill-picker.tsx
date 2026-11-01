import { BookOpen, Check, Download, Loader2, Star } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { AgentKind } from "@/shared/agent-protocol";
import type { SkillSummary } from "@/shared/skills";
import { rpc } from "../providers/rpc";

interface SkillPickerProps {
	agent: AgentKind;
	skills: SkillSummary[];
	selected: string[];
	onSelect: (ids: string[]) => void;
	onImported: (skill: SkillSummary) => void;
	onBusyChange: (busy: boolean) => void;
	disabled?: boolean;
}

export function SkillPicker({
	agent,
	skills,
	selected,
	onSelect,
	onImported,
	onBusyChange,
	disabled,
}: SkillPickerProps) {
	const [url, setUrl] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const native = skills.filter((skill) => skill.source.kind === "harness");
	const imported = skills.filter((skill) => skill.source.kind === "github");
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
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					aria-label={`Configurar Skills${selected.length ? ` (${selected.length})` : ""}`}
					className="h-8 gap-1.5 text-xs text-muted-foreground"
				>
					<BookOpen className="h-3.5 w-3.5" /> Skills{" "}
					{selected.length > 0 && (
						<span className="rounded bg-primary/15 px-1.5 text-primary">
							{selected.length}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				className="w-[380px] max-w-[calc(100vw-32px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-3"
				onOpenAutoFocus={(event) => event.preventDefault()}
			>
				<div className="mb-2 flex items-center justify-between">
					<h2 className="text-sm font-medium">Skills da conversa</h2>
					<span className="text-xs text-muted-foreground">
						{agent === "claude" ? "Claude" : "Codex"}
					</span>
				</div>
				<p className="mb-3 text-xs text-muted-foreground">
					As Skills nativas são gerenciadas pelo harness. Adicione outras para
					esta conversa.
				</p>
				<div className="max-h-32 overflow-y-auto space-y-1">
					{native.map((skill) => (
						<div
							key={skill.id}
							className="px-2 py-1 text-xs text-muted-foreground"
							title={skill.description}
						>
							{!skill.unavailableReason && (
								<Check className="mr-1 inline h-3 w-3" />
							)}
							{skill.name}
							<span className="ml-2 text-[10px]">
								{skill.unavailableReason ? "Indisponível" : "Do harness"}
							</span>
							{skill.unavailableReason && (
								<span className="mt-1 block text-[10px] text-destructive">
									{skill.unavailableReason}
								</span>
							)}
						</div>
					))}
					{imported.map((skill) => (
						<label
							key={skill.id}
							className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-accent"
						>
							<input
								type="checkbox"
								className="mt-0.5 accent-primary"
								aria-label={`Usar ${skill.name}`}
								checked={selected.includes(skill.id)}
								disabled={busy || disabled}
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
							</span>
						</label>
					))}
					{!imported.length && (
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
				<div className="mt-3 flex items-center justify-between gap-2">
					<Button
						type="button"
						size="sm"
						variant="ghost"
						className="h-7 gap-1 text-xs"
						disabled={busy || disabled}
						onClick={() => void saveDefaults()}
					>
						<Star className="h-3 w-3" />
						Usar seleção como padrão
					</Button>
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
