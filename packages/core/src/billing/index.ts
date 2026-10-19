import z from 'zod';

import { Box } from '../box/index.js';
import { Env } from '../env.js';
import { fn } from '../fn.js';
import { Machine } from '../machine/index.js';
import { Team } from '../team/index.js';
import { Burn } from './burn.js';
import { Rooms } from './rooms.js';

/**
 * What a team is on, and who pays for a box.
 *
 * Plans count rooms and nothing else. The weekend trial and the rolling usage
 * windows (five hours, seven days, thirty days) used to decide here whether a
 * run could start; they no longer do, and nothing refuses a run for time spent.
 * `Limits` and `Window` are still in this directory, unused, and burn is still
 * recorded per run.
 */
export namespace Billing {
	export const State = z.object({
		teamId: z.string(),
		plan: z.string(),
		rooms: z.object({
			used: z.number().int().meta({ description: 'Cloud rooms you hold on Nestri GPUs' }),
			allowed: z.number().int().meta({ description: 'Cloud rooms your plan allows' })
		})
	});

	export type State = z.infer<typeof State>;

	/**
	 * The team that pays for a box.
	 *
	 * On a person's own hardware, the team the host is registered under. On
	 * the fleet, the hardware belongs to an organisation, which is not a
	 * billing subject — so the run is the box owner's, and is billed to their
	 * personal team, the one every account has and the one a plan is bought
	 * on.
	 */
	export const teamForBox = fn(z.string(), async (boxId) => {
		const box = await Box.fromID(boxId);
		if (!box) {
			return null;
		}
		const machine = await Machine.fromID(box.machineId);
		const teamId =
			machine?.teamId ??
			(machine?.organisationId ? ((await Team.personalFor(box.userId))?.id ?? null) : null);
		if (!machine || !teamId) {
			return null;
		}
		return {
			teamId,
			tier: box.tier as Burn.Tier,
			// Whose hardware decides the cost basis, and the machine is the only
			// thing that knows. A host an organisation owns is ours to pay for;
			// anything else is the caller's own card.
			hostClass: (machine.organisationId ? 'fleet' : 'byo') as Burn.HostClass
		};
	});

	/** How many cloud rooms a person holds: their boxes on fleet machines. */
	export async function cloudRooms(userId: string): Promise<number> {
		const organisationId = Env.get().FLEET_ORGANISATION_ID;
		if (!organisationId) return 0;
		return (await Box.onFleet({ userId, organisationId })).length;
	}

	/** The plan, and cloud rooms used against allowed, for one team and person. */
	export const state = fn(
		z.object({ teamId: z.string(), userId: z.string() }),
		async (input): Promise<State> => {
			const plan = (await Team.fromID(input.teamId))?.plan ?? 'free';
			return {
				teamId: input.teamId,
				plan,
				rooms: { used: await Billing.cloudRooms(input.userId), allowed: Rooms.allowed(plan) }
			};
		}
	);
}
