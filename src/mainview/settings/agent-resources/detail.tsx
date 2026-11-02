import { ArrowLeft } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Detail navigation stays inside the workspace's one scroll owner. */
export function useResourceDetail<T extends { id: string }>() {
	const ref = useRef<HTMLDivElement>(null);
	const [detail, setDetail] = useState<T | null>(null);
	const listScroll = useRef(0);
	const returnId = useRef<string | null>(null);
	useLayoutEffect(() => {
		const scroll = ref.current?.closest<HTMLElement>("[data-resource-scroll]");
		if (detail) {
			if (scroll) scroll.scrollTop = 0;
			ref.current
				?.querySelector<HTMLButtonElement>("[data-resource-back]")
				?.focus({ preventScroll: true });
		} else if (returnId.current) {
			if (scroll) scroll.scrollTop = listScroll.current;
			const button = Array.from(
				ref.current?.querySelectorAll<HTMLButtonElement>(
					"[data-resource-id]",
				) ?? [],
			).find((b) => b.dataset.resourceId === returnId.current);
			button?.focus({ preventScroll: true });
			returnId.current = null;
		}
	}, [detail]);
	return {
		ref,
		detail,
		open: (value: T) => {
			listScroll.current =
				ref.current?.closest<HTMLElement>("[data-resource-scroll]")
					?.scrollTop ?? 0;
			setDetail(value);
		},
		back: () => {
			returnId.current = detail?.id ?? null;
			setDetail(null);
		},
		reset: () => {
			returnId.current = null;
			listScroll.current = 0;
			setDetail(null);
			const scroll = ref.current?.closest<HTMLElement>(
				"[data-resource-scroll]",
			);
			if (scroll) scroll.scrollTop = 0;
		},
	};
}
export function ResourceDetail({
	name,
	backLabel,
	onBack,
	busy,
	actions,
	children,
}: {
	name: string;
	backLabel: string;
	onBack: () => void;
	busy: boolean;
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<article className="space-y-4" aria-label={`Detalhes de ${name}`}>
			<header className="sticky top-0 z-10 -mx-1 border-b bg-background/95 px-1 pb-3 backdrop-blur-md">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					data-resource-back
					disabled={busy}
					onClick={onBack}
				>
					<ArrowLeft className="h-4 w-4" />
					{backLabel}
				</Button>
				<h3 className="mt-2 break-words text-base font-semibold">{name}</h3>
			</header>
			<div className="space-y-3 text-sm">{children}</div>
			{actions && (
				<footer className="sticky bottom-0 z-10 -mx-1 space-y-2 border-t bg-background/95 px-1 py-3 backdrop-blur-md">
					{actions}
				</footer>
			)}
		</article>
	);
}
export function UninstallResource({
	name,
	busy,
	onConfirm,
}: {
	name: string;
	busy: boolean;
	onConfirm: () => void;
}) {
	const [confirm, setConfirm] = useState(false);
	return confirm ? (
		<div className="space-y-2">
			<p className="text-xs text-muted-foreground">
				Desinstalar {name} remove o recurso da biblioteca compartilhada de
				Claude e Codex. Conversas existentes mantêm suas cópias.
			</p>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					size="sm"
					variant="destructive"
					disabled={busy}
					onClick={onConfirm}
				>
					Confirmar desinstalação
				</Button>
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={busy}
					onClick={() => setConfirm(false)}
				>
					Manter instalado
				</Button>
			</div>
		</div>
	) : (
		<Button
			type="button"
			size="sm"
			variant="outline"
			disabled={busy}
			onClick={() => setConfirm(true)}
		>
			Desinstalar da biblioteca
		</Button>
	);
}
