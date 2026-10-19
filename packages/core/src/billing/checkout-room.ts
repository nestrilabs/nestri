import { and, eq, isNull } from 'drizzle-orm';
import z from 'zod';

import { BoxTable } from '../box/box.sql.js';
import { Box } from '../box/index.js';
import { Placement } from '../box/placement.js';
import { Database } from '../db/index.js';
import { Env } from '../env.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { Team } from '../team/index.js';
import { Billing } from './index.js';
import { CheckoutRoomTable } from './checkout-room.sql.js';
import { Rooms } from './rooms.js';

/**
 * The room somebody paid to get.
 *
 * Pro checkout can carry the fleet GPU the person was looking at. When the
 * payment lands, that room is made for them, so the money and the thing it was
 * for arrive together rather than leaving them to find the button again.
 */
export namespace CheckoutRoom {
	/** Every model the fleet has a card of, free or not. */
	export async function knownModels(): Promise<string[]> {
		const organisationId = Env.get().FLEET_ORGANISATION_ID;
		if (!organisationId) return [];
		const cards = await Placement.fleetCards(organisationId);
		return [...new Set(cards.map((c) => c.model))];
	}

	/** Refuse a model the fleet does not have. */
	export async function assertKnown(model: string): Promise<void> {
		if (!(await knownModels()).some((m) => Rooms.sameModel(m, model))) {
			throw new VisibleError(
				'validation',
				ErrorCodes.Validation.INVALID_PARAMETER,
				`${model} is not a Nestri GPU`,
				'gpu'
			);
		}
	}

	const vendor = (pciId: string) => pciId.split(':')[0]?.toLowerCase() ?? '';

	/**
	 * Which model to use: the one asked for when a card of it is free,
	 * otherwise the closest free one — same vendor first, then nearest memory.
	 * Null when no fleet card is free.
	 */
	export function choose(
		requested: string,
		cards: readonly Placement.Card[]
	): { model: string; substituted: boolean } | null {
		const free = cards.filter((c) => c.free);
		const exact = free.find((c) => Rooms.sameModel(c.model, requested));
		if (exact) return { model: exact.model, substituted: false };
		if (free.length === 0) return null;
		const wanted = cards.find((c) => Rooms.sameModel(c.model, requested));
		const wantedVendor = wanted ? vendor(wanted.pciId) : '';
		const wantedVram = wanted?.vramMib ?? 0;
		const rank = (c: Placement.Card) => [
			vendor(c.pciId) === wantedVendor ? 0 : 1,
			Math.abs((c.vramMib ?? 0) - wantedVram)
		];
		const best = [...free].sort((a, b) => {
			const [av, ad] = rank(a)!;
			const [bv, bd] = rank(b)!;
			return av! - bv! || ad! - bd! || a.model.localeCompare(b.model);
		})[0]!;
		return { model: best.model, substituted: true };
	}

	export const Outcome = z.object({
		created: z.boolean(),
		reason: z.enum(['created', 'duplicate', 'no gpu free', 'no fleet', 'no team', 'over limit']),
		model: z.string().nullable(),
		substituted: z.boolean(),
		boxId: z.string().nullable()
	});
	export type Outcome = z.infer<typeof Outcome>;

	/**
	 * Make the room a paid subscription asked for, once.
	 *
	 * Keyed on the subscription id: a redelivery finds the row already claimed
	 * and does nothing, including when the first delivery found no GPU free.
	 */
	export const forSubscription = fn(
		z.object({ teamId: z.string(), subscriptionId: z.string(), gpu: z.string() }),
		async (input): Promise<Outcome> => {
			const none = (reason: Outcome['reason']): Outcome => ({
				created: false,
				reason,
				model: null,
				substituted: false,
				boxId: null
			});
			const organisationId = Env.get().FLEET_ORGANISATION_ID;
			const team = await Team.fromID(input.teamId);
			if (!team) return none('no team');

			return Database.transaction(async () => {
				const claimed = await Database.use((tx) =>
					tx
						.insert(CheckoutRoomTable)
						.values({
							id: Identifier.ascending('checkoutRoom'),
							teamId: input.teamId,
							subscriptionId: input.subscriptionId,
							requestedModel: input.gpu
						})
						.onConflictDoNothing()
						.returning({ id: CheckoutRoomTable.id })
						.then((r) => r[0])
				);
				if (!claimed) return none('duplicate');
				if (!organisationId) return none('no fleet');

				let picked: ReturnType<typeof choose> = null;
				const placer: Placement.Placer = async (request) => {
					picked = choose(input.gpu, await Placement.fleetCards(organisationId));
					if (!picked) {
						throw new VisibleError(
							'rate_limit',
							ErrorCodes.Server.SERVICE_UNAVAILABLE,
							'No Nestri GPU is free right now'
						);
					}
					return Placement.onFleetModel(picked.model)(request);
				};
				let overLimit = false;
				let box: Awaited<ReturnType<typeof Box.createPlaced>> | null = null;
				try {
					box = await Box.createPlaced(
						{
							id: Identifier.ascending('box'),
							userId: team.ownerId,
							label: input.gpu.slice(0, 64),
							tier: 'sm'
						},
						placer,
						async () => {
							if ((await Billing.cloudRooms(team.ownerId)) >= Rooms.allowed(team.plan)) {
								overLimit = true;
								throw Rooms.atLimit(input.gpu, team.plan);
							}
						}
					);
				} catch (err) {
					if (!(err instanceof VisibleError)) throw err;
				}
				if (!box) {
					return none(overLimit ? 'over limit' : 'no gpu free');
				}
				const final = picked as { model: string; substituted: boolean } | null;
				// A room is named after its GPU, which is not the one asked for
				// when another was put in its place.
				if (final?.substituted) {
					await Database.use((tx) =>
						tx
							.update(BoxTable)
							.set({ label: final.model.slice(0, 64) })
							.where(eq(BoxTable.id, box!.id))
					);
				}
				await Database.use((tx) =>
					tx
						.update(CheckoutRoomTable)
						.set({
							boxId: box!.id,
							placedModel: final?.model ?? input.gpu,
							substituted: final?.substituted ?? false
						})
						.where(and(eq(CheckoutRoomTable.id, claimed.id), isNull(CheckoutRoomTable.timeDeleted)))
				);
				return {
					created: true,
					reason: 'created',
					model: final?.model ?? input.gpu,
					substituted: final?.substituted ?? false,
					boxId: box.id
				};
			});
		}
	);
}
