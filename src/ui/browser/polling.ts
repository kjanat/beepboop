interface Changes {
	rendered: number;
	load(signal: AbortSignal): Promise<number>;
	changed(): void;
}

/** Schedule the next snapshot only after the current request settles. */
export function pollChanges({ rendered, load, changed }: Changes): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let active: AbortController | undefined;
	let suspended = false;
	let stopped = false;
	const visible = () => !stopped && !suspended && !document.hidden;
	const cancel = () => {
		clearTimeout(timer);
		timer = undefined;
		active?.abort();
	};
	const schedule = () => {
		if (visible() && !active && timer === undefined) timer = setTimeout(poll, 5000);
	};
	async function poll() {
		timer = undefined;
		if (!visible() || active) return;
		const controller = new AbortController();
		active = controller;
		const timeout = setTimeout(() => controller.abort(), 20_000);
		try {
			const latest = await load(controller.signal);
			if (!controller.signal.aborted && visible() && latest > rendered) {
				stopped = true;
				changed();
			}
		} catch {
			// A failed or cancelled snapshot is retried on the next visible cycle.
		} finally {
			clearTimeout(timeout);
			active = undefined;
			schedule();
		}
	}
	const visibility = () => {
		if (document.hidden) cancel();
		else schedule();
	};
	const hide = () => {
		suspended = true;
		cancel();
	};
	const show = () => {
		suspended = false;
		schedule();
	};
	document.addEventListener('visibilitychange', visibility);
	window.addEventListener('pagehide', hide);
	window.addEventListener('pageshow', show);
	schedule();
	return () => {
		stopped = true;
		cancel();
		document.removeEventListener('visibilitychange', visibility);
		window.removeEventListener('pagehide', hide);
		window.removeEventListener('pageshow', show);
	};
}
