import { Button } from "@/components/ui/button";
import { useSettings } from "./settings-context";
/** Legacy location is navigation only; all editing uses the vaulted shared registry. */
export function McpServersSection() {
	const { openDialog } = useSettings();
	return (
		<div className="space-y-2">
			<h3 className="text-sm font-semibold">Servidores MCP</h3>
			<p className="text-xs text-muted-foreground">
				Gerencie conexões compartilhadas entre Claude e Codex em Extensões.
			</p>
			<Button
				size="sm"
				variant="outline"
				onClick={() => openDialog("extensions")}
			>
				Gerenciar MCP em Extensões
			</Button>
		</div>
	);
}
