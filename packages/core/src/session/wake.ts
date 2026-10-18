import { eq } from 'drizzle-orm';

import { BoxTable } from '../box/box.sql.js';
import { Database } from '../db/index.js';

/**
 * Waking a host that is waiting for work.
 *
 * A host holds `GET /machine/jobs?wait=` open when there is nothing for it.
 * Whatever creates or changes work for a machine calls {@link wake} after the
 * write has committed, and the held call looks again at once.
 *
 * In this process only. A second API process would not hear it, which is why a
 * held call also looks again every {@link RECHECK_MS} on its own: a wake that
 * lands in another process costs a host a few seconds, never the job. The
 * `redis` package is a dependency of the API but nothing uses it and no
 * deployment configures one, so a shared channel is left until there is a
 * second process to share it between.
 */
export namespace JobWake {
	/** How often a held call looks again with nobody having woken it. */
	export const RECHECK_MS = 5_000;

	const waiting = new Map<string, Set<() => void>>();

	/** Tell every call held for this machine to look again. */
	export function wake(machineId: string) {
		const set = waiting.get(machineId);
		if (!set) return;
		waiting.delete(machineId);
		for (const resolve of set) resolve();
	}

	/**
	 * Wake the machine a box is placed on. Looked up, because the places that
	 * change a run know its box and not its host. Never throws: a failed
	 * lookup must not fail the write it follows, and the recheck covers it.
	 */
	export async function wakeBox(boxId: string) {
		try {
			const machineId = await Database.use((tx) =>
				tx
					.select({ machineId: BoxTable.machineId })
					.from(BoxTable)
					.where(eq(BoxTable.id, boxId))
					.then((rows) => rows[0]?.machineId ?? null)
			);
			if (machineId) wake(machineId);
		} catch (err) {
			console.error('[jobs] could not wake the host for a box:', err);
		}
	}

	/**
	 * Start listening for a wake. Taken *before* the caller reads the work, so
	 * a wake between the read and the wait is not lost.
	 */
	export function listen(machineId: string) {
		let done!: () => void;
		const woken = new Promise<void>((resolve) => (done = resolve));
		let set = waiting.get(machineId);
		if (!set) waiting.set(machineId, (set = new Set()));
		set.add(done);

		return {
			/** Resolves on a wake, after `ms`, or when `signal` aborts. */
			async until(ms: number, signal?: AbortSignal) {
				let timer: ReturnType<typeof setTimeout> | undefined;
				let onAbort: (() => void) | undefined;
				await Promise.race([
					woken,
					new Promise<void>((resolve) => (timer = setTimeout(resolve, ms))),
					new Promise<void>((resolve) => {
						if (!signal) return;
						onAbort = () => resolve();
						if (signal.aborted) resolve();
						else signal.addEventListener('abort', onAbort, { once: true });
					})
				]);
				clearTimeout(timer);
				if (signal && onAbort) signal.removeEventListener('abort', onAbort);
			},
			cancel() {
				const current = waiting.get(machineId);
				current?.delete(done);
				if (current?.size === 0) waiting.delete(machineId);
			}
		};
	}

	/** How many calls are held, for tests. */
	export function held(machineId: string) {
		return waiting.get(machineId)?.size ?? 0;
	}
}
