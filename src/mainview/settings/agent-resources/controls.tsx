import { type ReactNode, useState } from "react";
export function ResourceRow({
	name,
	description,
	origin,
	checked,
	disabled,
	onChange,
	children,
	unavailableReason,
}: {
	name: string;
	description?: string;
	origin?: string;
	checked: boolean;
	disabled?: boolean;
	onChange: (checked: boolean) => void;
	children?: ReactNode;
	unavailableReason?: string;
}) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div className="resource-row">
			<label className="flex min-w-0 items-start gap-3">
				<input
					type="checkbox"
					aria-label={`Usar ${name}`}
					checked={checked}
					disabled={disabled}
					onChange={(e) => onChange(e.target.checked)}
					className="mt-1 shrink-0 accent-primary"
				/>
				<span className="min-w-0 flex-1">
					<span className="block break-words text-sm font-medium">{name}</span>
					{origin && (
						<span className="mt-0.5 block text-xs text-muted-foreground">
							{origin}
						</span>
					)}
				</span>
			</label>
			{unavailableReason && (
				<p className="mt-1 pl-7 text-xs text-muted-foreground">
					{unavailableReason}
				</p>
			)}
			{description && (
				<div className="mt-1 pl-7 text-xs text-muted-foreground">
					<button
						type="button"
						aria-expanded={expanded}
						onClick={() => setExpanded((value) => !value)}
						className="text-left hover:underline"
					>
						Detalhes
					</button>
					{expanded && (
						<p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">
							{description}
						</p>
					)}
				</div>
			)}

			{children}
		</div>
	);
}
