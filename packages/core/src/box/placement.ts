import { and, count, inArray, isNull } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Env } from '../env.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { Machine } from '../machine/index.js';
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
	export type Placer = (request: Request) => Promise<string>;

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

		return hosts[0]!.id;
	};

	/**
	 * Place it on the fleet: a machine the fleet organisation owns.
	 *
	 * Only machines that are online — a box placed on one that is not would be a
	 * session that never starts — and, among those, the one holding the fewest
	 * boxes. That is a spread, not a scheduler: it knows nothing about how big a
	 * box is or whether it is running. It is the smallest policy that does not
	 * pile every customer onto the oldest row, and this file is still the one
	 * place a real scheduler replaces. todo(d-0014)
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
		const boxes = new Map(held.map((h) => [h.machineId, h.boxes]));
		// Stable: on a tie, the order `listByOrganisation` gives, oldest first.
		return [...online].sort((a, b) => (boxes.get(a.id) ?? 0) - (boxes.get(b.id) ?? 0))[0]!.id;
	};

	/** Place a box, using `onlyHost` unless a caller supplies its own placer. */
	export async function choose(request: Request, placer: Placer = onlyHost): Promise<string> {
		return placer(Request.parse(request));
	}
}
