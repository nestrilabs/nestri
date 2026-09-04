import z from 'zod';

import { ErrorCodes, VisibleError } from '../error.js';
import { Machine } from '../machine/index.js';
import { BoxTier } from './box.sql.js';

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
			// answer it. An orchestrator is what closes this. todo(d-0048)
			throw new VisibleError(
				'internal',
				ErrorCodes.Server.SERVICE_UNAVAILABLE,
				'More than one host could run this box, and choosing between them is not supported yet'
			);
		}

		return hosts[0]!.id;
	};

	/** Place a box, using `onlyHost` unless a caller supplies its own placer. */
	export async function choose(request: Request, placer: Placer = onlyHost): Promise<string> {
		return placer(Request.parse(request));
	}
}
