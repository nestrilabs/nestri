import { and, count, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Env } from '../env.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { Machine } from '../machine/index.js';
import { MachineTable } from '../machine/machine.sql.js';
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
		(target: { machineId: string; pciId: string }): Placer =>
		async (request) => {
			const host = (await Machine.listByOwner(request.userId)).find(
				(m) => m.id === target.machineId
			);
			if (!host || !host.gpus?.some((g) => g.pciId === target.pciId)) {
				throw new VisibleError(
					'not_found',
					ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
					'No such GPU on a host of yours'
				);
			}
			return { machineId: host.id, gpuPciId: target.pciId };
		};

	/**
	 * The fleet's GPUs, one entry per card, with whether each is free: online
	 * host, and no room on it that is not stopped. Cards of one model on one
	 * host that share a `vendor:device` id are told apart only by count.
	 */
	export async function fleetCards(organisationId: string) {
		const machines = await Machine.listByOrganisation(organisationId);
		const pinned = await Database.use((tx) =>
			tx
				.select({
					machineId: BoxTable.machineId,
					pci: BoxTable.gpuPciId,
					held: count()
				})
				.from(BoxTable)
				.where(
					and(
						inArray(
							BoxTable.machineId,
							machines.map((m) => m.id)
						),
						isNull(BoxTable.timeDeleted),
						ne(BoxTable.state, 'stopped'),
						isNotNull(BoxTable.gpuPciId)
					)
				)
				.groupBy(BoxTable.machineId, BoxTable.gpuPciId)
		);
		const held = new Map(pinned.map((p) => [`${p.machineId}/${p.pci}`, p.held]));
		const cards: {
			machineId: string;
			pciId: string;
			model: string;
			vramMib: number | null;
			online: boolean;
			free: boolean;
		}[] = [];
		for (const m of machines) {
			const online = Machine.isOnline(m.lastSeen ?? null);
			const taken = new Map<string, number>();
			for (const g of m.gpus ?? []) {
				const seen = taken.get(g.pciId) ?? 0;
				taken.set(g.pciId, seen + 1);
				cards.push({
					machineId: m.id,
					pciId: g.pciId,
					model: g.model,
					vramMib: g.vramMib ?? null,
					online,
					// The n-th identical card is free when fewer than n rooms hold that id.
					free: online && (held.get(`${m.id}/${g.pciId}`) ?? 0) < seen + 1
				});
			}
		}
		return cards;
	}

	/**
	 * Place it on a fleet GPU of one model: of the hosts with a free card of
	 * that model, the one holding the fewest boxes for its slots.
	 */
	export const onFleetModel =
		(model: string): Placer =>
		async () => {
			const organisationId = Env.get().FLEET_ORGANISATION_ID;
			if (!organisationId) {
				throw new VisibleError(
					'internal',
					ErrorCodes.Server.SERVICE_UNAVAILABLE,
					'Nestri GPUs are not available on this deployment'
				);
			}
			const free = (await fleetCards(organisationId)).filter((c) => c.model === model && c.free);
			if (free.length === 0) {
				throw new VisibleError(
					'rate_limit',
					ErrorCodes.Server.SERVICE_UNAVAILABLE,
					`No ${model} is free right now. Try again in a few minutes`
				);
			}
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
			const pick = [...free].sort(
				(a, b) => (load.get(a.machineId) ?? 0) - (load.get(b.machineId) ?? 0)
			)[0]!;
			return { machineId: pick.machineId, gpuPciId: pick.pciId };
		};

	/** Place a box, using `onlyHost` unless a caller supplies its own placer. */
	export async function choose(request: Request, placer: Placer = onlyHost): Promise<Placed> {
		return placer(Request.parse(request));
	}
}
