import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { CommandSuggestions, commandKeyDown } from "./command-suggestions";

test("arrows and Enter insert a command; Shift+Enter and IME stay with textarea", () => {
	const submit = vi.fn();
	const list = [
		{ name: "package:review", description: "Revisar" },
		{ name: "package:debug", description: "Depurar" },
	];
	function Fixture() {
		const [index, setIndex] = useState(0);
		const [value, setValue] = useState("/");
		return (
			<form
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<textarea
					aria-label="Mensagem"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					onKeyDown={(e) =>
						commandKeyDown(
							e,
							list,
							index,
							setIndex,
							(n) => setValue(`/${n} `),
							() => {},
						)
					}
				/>
				<CommandSuggestions commands={list} index={index} onSelect={setValue} />
			</form>
		);
	}
	render(<Fixture />);
	const input = screen.getByLabelText("Mensagem");
	fireEvent.keyDown(input, { key: "ArrowDown" });
	expect(screen.getByRole("option", { name: /package:debug/ })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	fireEvent.keyDown(input, { key: "Enter" });
	expect(input).toHaveValue("/package:debug ");
	expect(submit).not.toHaveBeenCalled();
	fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
	expect(input).toHaveValue("/package:debug ");
});
