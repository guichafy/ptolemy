import { cloneElement, type ReactElement, useId } from "react";
import { Button } from "@/components/ui/button";
export const errorText = (error: unknown) =>
	error instanceof Error
		? error.message
		: "Não foi possível concluir. Tente novamente.";
export function ExtensionError({
	error,
	retry,
}: {
	error: string | null;
	retry?: () => void;
}) {
	return error ? (
		<div role="alert" className="my-2 break-words text-xs text-destructive">
			{error}
			{retry && (
				<Button variant="ghost" size="sm" onClick={retry}>
					Tentar novamente
				</Button>
			)}
		</div>
	) : null;
}
export function ExtensionField({
	label,
	children,
}: {
	label: string;
	children: ReactElement<{ id?: string }>;
}) {
	const id = useId();
	return (
		<label
			htmlFor={id}
			className="flex min-w-0 flex-col gap-1 text-xs font-medium"
		>
			{label}
			{cloneElement(children, { id })}
		</label>
	);
}

export const componentKindLabel = {
	skill: "Skill",
	command: "Comando",
	hook: "Hook",
	mcp: "MCP",
	agent: "Agente",
	other: "Outro recurso",
} as const;
