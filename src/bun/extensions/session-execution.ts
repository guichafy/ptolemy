/** Owns pre-query shell work so Stop/switch/delete can cancel and drain it. */
export class SessionExecutions {
	private entries = new Set<{
		id: string;
		controller: AbortController;
		done: Promise<unknown>;
	}>();
	run<T>(id: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
		const entry = {
			id,
			controller: new AbortController(),
			done: Promise.resolve() as Promise<unknown>,
		};
		this.entries.add(entry);
		const done = Promise.resolve()
			.then(() => {
				entry.controller.signal.throwIfAborted();
				return action(entry.controller.signal);
			})
			.finally(() => this.entries.delete(entry));
		entry.done = done;
		return done;
	}
	abort(id?: string): boolean {
		let any = false;
		for (const e of this.entries)
			if (id === undefined || e.id === id) {
				any = true;
				e.controller.abort();
			}
		return any;
	}
	async cancel(id?: string): Promise<void> {
		this.abort(id);
		await Promise.allSettled(
			[...this.entries]
				.filter((e) => id === undefined || e.id === id)
				.map((e) => e.done),
		);
	}
	async cancelExcept(id: string): Promise<void> {
		const entries = [...this.entries].filter((e) => e.id !== id);
		for (const e of entries) e.controller.abort();
		await Promise.allSettled(entries.map((e) => e.done));
	}
}
