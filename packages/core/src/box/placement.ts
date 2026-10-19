import { and, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Env } from '../env.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { Machine } from '../machine/index.js';
import { MachineTable } from '../machine/machine.sql.js';
import { Rooms } from '../billing/rooms.js';
import { BoxTable, BoxTier } from './box.sql.js';

/**
 * Deciding which host a box runs on.
 *
 * This is a seam and not an algorithm. `box.machineId` is set once, when the
 * box is created, and everything downstream — a session, its job, the state
 * reports that follow — reaches the right hardware by joining through the box.
 * So there is exactly one moment where placement happens, and the value of
 * naming it now is that a real scheduler replaces this file and nothing else.
 *
 * The wrong shape, and the tempting one, is to place a box when a *run* is
 * requested. That spreads the decision across every caller that starts
 * something and leaves nowhere to put a scheduler later.
 */
export namespace Placement {
	export const Request = z.object({
		userId: z.string().meta({ description: 'Who the box is for' }),
		tier: z.enum(BoxTier.enumValues).meta({ description: 'The size that was asked for' })
	});

	export type Request = z.infer<typeof Request>;

	/**
	 * Answers "which host should run this box?" with a machine id.
	 *
	 * Asynchronous and allowed to refuse: capacity is a real answer, and a
	 * placer that cannot honour a request must say so rather than return
	 * something the insert would reject — `box.machineId` is not nullable.
	 */
	export type Placer = (request: Request) => Promise<Placed>;

	/** Where a box goes: a host, and the card on it when one was chosen. */
	export interface Placed {
		machineId: string;
		gpuPciId: string | null;
		/** The card's PCI address, when its host reports slots. */
		gpuSlot?: string | null;
	}

	/**
	 * Serialise whoever books the same thing, for the rest of the transaction.
	 * Keyed by a name (`user:<id>`, `machine:<id>`); in a transaction it is
	 * released at commit, outside one it is a no-op. Always take several in
	 * sorted order.
	 */
	export async function lock(keys: string[]) {
		for (const key of [...new Set(keys)].sort()) {
			await Database.use((tx) =>
				tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
			);
		}
	}

	/**
	 * The implementation there is hardware for: place it on the caller's host.
	 *
	 * Deliberately refuses when the answer is not forced. With no host there is
	 * nothing to place on; with several there is a choice to make and no policy
	 * to make it with, and picking the first row would be a scheduling decision
	 * taken by accident and impossible to find later. Refusing keeps the choice
	 * in this one function.
	 */
	export const onlyHost: Placer = async (request) => {
		const hosts = await Machine.listByOwner(request.userId);

		if (hosts.length === 0) {
			throw new VisibleError(
				'not_found',
				ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
				'You have no registered host to run a box on'
			);
		}
		if (hosts.length > 1) {
			// Not a caller error: the request is fine and the system cannot yet
			// answer it. An orchestrator is what closes this. todo(d-0014)
			throw new VisibleError(
				'internal',
				ErrorCodes.Server.SERVICE_UNAVAILABLE,
				'More than one host could run this box, and choosing between them is not supported yet'
			);
		}

		return { machineId: hosts[0]!.id, gpuPciId: null };
	};

	/**
	 * Place it on the fleet: a machine the fleet organisation owns.
	 *
	 * Only machines that are online — a box placed on one that is not would be a
	 * session that never starts — and, among those, the one holding the fewest
	 * boxes for each run it can hold at once (its `slots`, from its heartbeat).
	 *
	 * Per slot because a box stays on its machine for good, and a run waits for
	 * a slot on that machine even while another sits idle. Counting boxes alone
	 * put as many people on a two-slot host as on an eight-slot one, so the
	 * small one queued while the big one idled. A machine that has not said how
	 * many it holds counts as one slot, which is what it can be relied on for.
	 *
	 * Still a spread, not a scheduler: it knows nothing about how big a box is
	 * or whether it is running, and this file is still the one place a real
	 * scheduler replaces. todo(d-0014)
	 */
	export const fleet: Placer = async () => {
		const organisationId = Env.get().FLEET_ORGANISATION_ID;
		if (!organisationId) {
			throw new VisibleError(
				'internal',
				ErrorCodes.Server.SERVICE_UNAVAILABLE,
				'Nestri GPUs are not available on this deployment'
			);
		}
		const online = (await Machine.listByOrganisation(organisationId)).filter((m) =>
			Machine.isOnline(m.lastSeen ?? null)
		);
		if (online.length === 0) {
			// Capacity, not a fault: the same request succeeds once a machine is
			// back, which is what a 429 tells a caller.
			throw new VisibleError(
				'rate_limit',
				ErrorCodes.Server.SERVICE_UNAVAILABLE,
				'No Nestri GPU is free right now. Try again in a few minutes'
			);
		}
		const held = await Database.use((tx) =>
			tx
				.select({ machineId: BoxTable.machineId, boxes: count() })
				.from(BoxTable)
				.where(
					and(
						inArray(
							BoxTable.machineId,
							online.map((m) => m.id)
						),
						isNull(BoxTable.timeDeleted)
					)
				)
				.groupBy(BoxTable.machineId)
		);
		const capacity = await Database.use((tx) =>
			tx
				.select({ id: MachineTable.id, slots: MachineTable.slots })
				.from(MachineTable)
				.where(
					inArray(
						MachineTable.id,
						online.map((m) => m.id)
					)
				)
		);
		const boxes = new Map(held.map((h) => [h.machineId, h.boxes]));
		const slots = new Map(capacity.map((c) => [c.id, Math.max(1, c.slots ?? 1)]));
		const load = (id: string) => (boxes.get(id) ?? 0) / (slots.get(id) ?? 1);
		// Stable: on a tie, the order `listByOrganisation` gives, oldest first.
		return {
			machineId: [...online].sort((a, b) => load(a.id) - load(b.id))[0]!.id,
			gpuPciId: null
		};
	};

	/**
	 * Place it on a GPU of the caller's own: one of the cards a host of theirs
	 * reported. Refused when the host is not theirs or does not have that card,
	 * with the same answer for both so a stranger's host id learns nothing.
	 */
	export const onOwn =
		(target: { machineId: string; pciId: string; slot?: string }): Placer =>
		async (request) => {
			const host = (await Machine.listByOwner(request.userId)).find(
				(m) => m.id === target.machineId
			);
			const cards = (host?.gpus ?? []).filter(
				(g) => g.pciId === target.pciId && (!target.slot || g.slot === target.slot)
			);
			if (!host || cards.length === 0) {
				throw new VisibleError(
					'not_found',
					ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
					'No such GPU on a host of yours'
				);
			}
			return {
				machineId: host.id,
				gpuPciId: target.pciId,
				gpuSlot: target.slot ?? (cards.length === 1 ? (cards[0]!.slot ?? null) : null)
			};
		};

	type Gpu = NonNullable<Machine.Info['gpus']>[number];
	interface Held {
		gpuPciId: string | null;
		gpuSlot: string | null;
	}

	/**
	 * Which of a machine's cards the boxes on it hold, as booleans in `gpus`
	 * order. Boxes that name a slot hold that card; boxes that name only a
	 * model hold the first unheld card of it; boxes from before a box named a
	 * card (null) hold one card of the machine's first GPU, since all they
	 * were ever given was that.
	 */
	export function heldCards(gpus: readonly Gpu[], boxes: readonly Held[]): boolean[] {
		const taken = gpus.map(() => false);
		const take = (match: (g: Gpu) => boolean) => {
			const i = gpus.findIndex((g, n) => !taken[n] && match(g));
			if (i >= 0) taken[i] = true;
		};
		for (const b of boxes) if (b.gpuSlot) take((g) => g.slot === b.gpuSlot);
		for (const b of boxes) if (!b.gpuSlot && b.gpuPciId) take((g) => g.pciId === b.gpuPciId);
		const first = gpus[0]?.pciId;
		for (const b of boxes) if (!b.gpuSlot && !b.gpuPciId && first) take((g) => g.pciId === first);
		return taken;
	}

	export interface Card {
		machineId: string;
		pciId: string;
		slot: string | null;
		model: string;
		vramMib: number | null;
		online: boolean;
		free: boolean;
	}

	/**
	 * The fleet's GPUs, one entry per card, with whether each is free: online
	 * host, and no room on it that is not stopped.
	 */
	export async function fleetCards(organisationId: string): Promise<Card[]> {
		const machines = await Machine.listByOrganisation(organisationId);
		const rows =
			machines.length === 0
				? []
				: await Database.use((tx) =>
						tx
							.select({
								machineId: BoxTable.machineId,
								gpuPciId: BoxTable.gpuPciId,
								gpuSlot: BoxTable.gpuSlot
							})
							.from(BoxTable)
							.where(
								and(
									inArray(
										BoxTable.machineId,
										machines.map((m) => m.id)
									),
									isNull(BoxTable.timeDeleted),
									ne(BoxTable.state, 'stopped')
								)
							)
					);
		const cards: Card[] = [];
		for (const m of machines) {
			const online = Machine.isOnline(m.lastSeen ?? null);
			const gpus = m.gpus ?? [];
			const taken = heldCards(
				gpus,
				rows.filter((r) => r.machineId === m.id)
			);
			gpus.forEach((g, i) =>
				cards.push({
					machineId: m.id,
					pciId: g.pciId,
					slot: g.slot ?? null,
					model: g.model,
					vramMib: g.vramMib ?? null,
					online,
					free: online && !taken[i]
				})
			);
		}
		return cards;
	}

	function fleetOrganisation() {
		const organisationId = Env.get().FLEET_ORGANISATION_ID;
		if (!organisationId) {
			throw new VisibleError(
				'internal',
				ErrorCodes.Server.SERVICE_UNAVAILABLE,
				'Nestri GPUs are not available on this deployment'
			);
		}
		return organisationId;
	}

	/** Free cards, after taking the booking lock of every fleet machine. */
	async function lockedFreeCards(organisationId: string) {
		await lock(
			(await Machine.listByOrganisation(organisationId)).map((m) => `machine:${m.id}`)
		);
		return (await fleetCards(organisationId)).filter((c) => c.free);
	}

	/** Of free cards, the one on the machine holding the fewest boxes for its slots. */
	async function leastLoaded(free: Card[]): Promise<Card> {
		const ids = [...new Set(free.map((c) => c.machineId))];
		const counts = await Database.use((tx) =>
			tx
				.select({
					id: MachineTable.id,
					slots: MachineTable.slots,
					boxes: count(BoxTable.id)
				})
				.from(MachineTable)
				.leftJoin(
					BoxTable,
					and(eq(BoxTable.machineId, MachineTable.id), isNull(BoxTable.timeDeleted))
				)
				.where(inArray(MachineTable.id, ids))
				.groupBy(MachineTable.id)
		);
		const load = new Map(counts.map((c) => [c.id, c.boxes / Math.max(1, c.slots ?? 1)]));
		return [...free].sort((a, b) => (load.get(a.machineId) ?? 0) - (load.get(b.machineId) ?? 0))[0]!;
	}

	const placedOn = (c: Card): Placed => ({
		machineId: c.machineId,
		gpuPciId: c.pciId,
		gpuSlot: c.slot
	});

	/**
	 * Place it on a fleet GPU of one model: of the hosts with a free card of
	 * that model, the one holding the fewest boxes for its slots. Cards are
	 * booked under a per-machine lock, so two callers never get the same one.
	 */
	export const onFleetModel =
		(model: string): Placer =>
		async () => {
			const free = (await lockedFreeCards(fleetOrganisation())).filter((c) => c.model === model);
			if (free.length === 0) {
				throw new VisibleError(
					'rate_limit',
					ErrorCodes.Server.SERVICE_UNAVAILABLE,
					`No ${model} is free right now. Try again in a few minutes`
				);
			}
			return placedOn(await leastLoaded(free));
		};

	/**
	 * Place it on whichever fleet card is free and least loaded, when no model
	 * was named. With `entryOnly` (every plan but Pro) only entry models are
	 * considered. A fleet whose hosts report no cards at all (nothing to protect) falls back to
	 * {@link fleet}, which places on a machine and names no card.
	 */
	export const onFleetAny =
		(opts: { entryOnly: boolean }): Placer =>
		async (request) => {
			const organisationId = fleetOrganisation();
			const free = (await lockedFreeCards(organisationId)).filter(
				(c) => !opts.entryOnly || Rooms.isEntry(c.model)
			);
			if (free.length === 0) {
				const reported = (await fleetCards(organisationId)).length > 0;
				if (!reported) return fleet(request);
				throw new VisibleError(
					'rate_limit',
					ErrorCodes.Server.SERVICE_UNAVAILABLE,
					'No Nestri GPU is free right now. Try again in a few minutes'
				);
			}
			return placedOn(await leastLoaded(free));
		};

	/**
	 * A stopped room is about to run again: make sure a card is held for it.
	 * Its own card when still free, else a free card of the same model
	 * elsewhere, else a refusal (429, SERVICE_UNAVAILABLE). Holding is a state
	 * change to `created`, so nobody else is placed on the card meanwhile.
	 * Does nothing for a box that is not stopped or not on the fleet.
	 */
	export async function reclaim(boxId: string): Promise<void> {
		const organisationId = Env.get().FLEET_ORGANISATION_ID;
		if (!organisationId) return;
		await Database.transaction(async () => {
			const machines = await Machine.listByOrganisation(organisationId);
			await lock(machines.map((m) => `machine:${m.id}`));
			const box = await Database.use((tx) =>
				tx
					.select()
					.from(BoxTable)
					.where(and(eq(BoxTable.id, boxId), isNull(BoxTable.timeDeleted)))
					.then((r) => r[0])
			);
			if (!box || box.state !== 'stopped') return;
			const home = machines.find((m) => m.id === box.machineId);
			if (!home) return;
			const cards = await fleetCards(organisationId);
			const first = home.gpus?.[0];
			const pci = box.gpuPciId ?? first?.pciId ?? null;
			const mine = cards.find(
				(c) =>
					c.machineId === box.machineId &&
					c.free &&
					(box.gpuSlot ? c.slot === box.gpuSlot : c.pciId === pci)
			);
			const model = (home.gpus ?? []).find((g) => g.pciId === pci)?.model ?? first?.model;
			const target =
				mine ??
				(model && cards.find((c) => c.free && c.model === model
					)
					? await leastLoaded(cards.filter((c) => c.free && c.model === model))
					: null);
			if (!target) {
				throw new VisibleError(
					'rate_limit',
					ErrorCodes.Server.SERVICE_UNAVAILABLE,
					`No ${model ?? 'Nestri GPU'} is free right now. Try again in a few minutes`
				);
			}
			await Database.use((tx) =>
				tx
					.update(BoxTable)
					.set({
						state: 'created',
						stopReason: null,
						stopClean: null,
						machineId: target.machineId,
						gpuPciId: target.pciId,
						gpuSlot: target.slot
					})
					.where(eq(BoxTable.id, boxId))
			);
		});
	}

	/** Place a box, using `onlyHost` unless a caller supplies its own placer. */
	export async function choose(request: Request, placer: Placer = onlyHost): Promise<Placed> {
		return placer(Request.parse(request));
	}
}
