import { ChevronDownIcon, X } from "lucide-react";
import { useState } from "react";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProtocolModelInfo } from "@/shared/agent-protocol";

export type ModelPickerVariant = "session" | "turn-override" | "default";

export interface ModelPickerProps {
	variant: ModelPickerVariant;
	value: string | null;
	models: ProtocolModelInfo[];
	onChange: (value: string) => void;
	disabled?: boolean;
	placeholder?: string;
	/**
	 * For variant "turn-override": shows a ✕ to clear the override and revert
	 * to the session default. Pass the session's default model id; when value
	 * differs from sessionDefault, the picker is rendering an override.
	 */
	sessionDefault?: string | null;
	/**
	 * Concrete model behind an alias value (e.g. `default` → `GPT-6 Astra`),
	 * shown muted next to the trigger label.
	 */
	resolvedLabel?: string | null;
	/** Label when model discovery has no entries (loading or unavailable). */
	emptyLabel?: string;
}

export function ModelPicker({
	variant,
	value,
	models,
	onChange,
	disabled,
	placeholder = "Selecionar modelo",
	sessionDefault,
	resolvedLabel,
	emptyLabel = "Carregando modelos...",
}: ModelPickerProps) {
	const [open, setOpen] = useState(false);

	if (models.length === 0) {
		return (
			<Button
				type="button"
				size="sm"
				variant="ghost"
				disabled
				className={cn("text-xs", variant === "session" && "h-6 px-2")}
				aria-label={placeholder}
			>
				{emptyLabel}
			</Button>
		);
	}

	const current = models.find((m) => m.value === value) ?? null;
	const showClear =
		variant === "turn-override" && value != null && value !== sessionDefault;
	const configuredLabel = current?.displayName ?? value ?? placeholder;
	// An alias (`default`, `sonnet`...) shows the concrete model as the label
	// and the alias as a small tag, so the button says what actually runs.
	const showsResolved = Boolean(
		resolvedLabel && resolvedLabel !== configuredLabel,
	);
	const triggerLabel = showsResolved
		? (resolvedLabel as string)
		: configuredLabel;
	const aliasTag =
		value === "default" ? "padrão" : (current?.displayName ?? value);

	const handleSelect = (modelValue: string) => {
		onChange(modelValue);
		setOpen(false);
	};

	const triggerSizing =
		variant === "session"
			? "h-6 px-2 py-0 text-xs"
			: variant === "turn-override"
				? "h-7 px-2 py-0 text-xs"
				: "h-8 px-3 text-sm";

	return (
		<div className="flex min-w-0 items-center gap-1">
			<ModelSelector open={open} onOpenChange={setOpen}>
				<ModelSelectorTrigger asChild>
					<Button
						type="button"
						variant={variant === "default" ? "outline" : "ghost"}
						disabled={disabled}
						className={cn("min-w-0 gap-1", triggerSizing)}
						aria-label={placeholder}
						title={
							showsResolved
								? `${configuredLabel}: usando ${triggerLabel}`
								: configuredLabel
						}
					>
						<span className="truncate">{triggerLabel}</span>
						{showsResolved && (
							<span className="shrink-0 rounded border border-border/80 px-1 py-px font-normal text-[9px] text-muted-foreground uppercase leading-none tracking-wide">
								{aliasTag}
							</span>
						)}
						<ChevronDownIcon className="size-3 shrink-0 opacity-60" />
					</Button>
				</ModelSelectorTrigger>
				<ModelSelectorContent title={placeholder}>
					<ModelSelectorInput placeholder="Buscar modelo..." />
					<ModelSelectorList>
						<ModelSelectorEmpty>Nenhum modelo encontrado</ModelSelectorEmpty>
						<ModelSelectorGroup>
							{models.map((m) => (
								<ModelSelectorItem
									key={m.value}
									value={m.value}
									keywords={[m.displayName, m.description]}
									onSelect={() => handleSelect(m.value)}
								>
									<div className="flex flex-col">
										<span className="font-medium">{m.displayName}</span>
										{(m.description || m.resolvesTo) && (
											<span className="text-[10px] text-muted-foreground">
												{[
													m.description,
													m.value === value && showsResolved
														? `agora: ${resolvedLabel}`
														: m.resolvesTo && `atual: ${m.resolvesTo}`,
												]
													.filter(Boolean)
													.join(" · ")}
											</span>
										)}
									</div>
								</ModelSelectorItem>
							))}
						</ModelSelectorGroup>
					</ModelSelectorList>
				</ModelSelectorContent>
			</ModelSelector>
			{showClear && sessionDefault && (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={() => onChange(sessionDefault)}
					className="h-6 w-6 p-0 text-muted-foreground"
					aria-label="Voltar ao modelo da sessão"
				>
					<X className="h-3 w-3" />
				</Button>
			)}
		</div>
	);
}
