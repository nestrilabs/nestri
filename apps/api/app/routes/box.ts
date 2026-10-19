import { Actor } from '@nestri/core/actor';
import { BoxTier } from '@nestri/core/box/box.sql';
import { Box } from '@nestri/core/box/index';
import { Placement } from '@nestri/core/box/placement';
import { Billing } from '@nestri/core/billing/index';
import { Rooms } from '@nestri/core/billing/rooms';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Identifier } from '@nestri/core/id';
import { Team } from '@nestri/core/team/index';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, notPublic, Result, validator } from '../utils';

/**
 * The caller's boxes. A box is created here and placed once — on your own
 * host, or on the fleet — and its state is whatever its host last reported.
 */
export namespace BoxApi {
	export const route = new Hono()
		.use(notPublic)
		.post(
			'/',
			describeRoute({
				tags: ['Box'],
				summary: 'Create a box',
				description:
					'A room on a GPU. `{ on: "own", machineId, pciId }` puts it on one of your own GPUs (unlimited). `{ on: "fleet", model }` puts it on a Nestri GPU of that model; free allows 1 cloud room on entry models, Pro 3 on any. Over that, 403 with code `room_limit` or `gpu_needs_pro`. Without `machineId` an own room needs exactly one registered host, and a fleet room without `model` takes the least-loaded machine.',
				responses: {
					201: {
						content: { 'application/json': { schema: Result(Box.Info) } },
						description: 'The box, placed'
					},
					400: ErrorResponses[400],
					401: ErrorResponses[401],
					403: ErrorResponses[403],
					404: ErrorResponses[404],
					409: ErrorResponses[409]
				}
			}),
			validator(
				'json',
				z.object({
					label: z.string().trim().min(1).max(64).default('box'),
					tier: z.enum(BoxTier.enumValues).default('md'),
					on: z.enum(['own', 'fleet']).default('own'),
					machineId: z.string().optional().meta({
						description: 'With `on: "own"`: the host holding the GPU. Needs `pciId`'
					}),
					pciId: z.string().optional().meta({
						description: 'With `on: "own"`: the GPU on that host, as `GET /location` lists it'
					}),
					slot: z.string().optional().meta({
						description:
							'With `on: "own"`: the card’s PCI address, to tell apart cards of one model'
					}),
					model: z.string().optional().meta({
						description: 'With `on: "fleet"`: the GPU model, as `GET /location` lists it'
					})
				})
			),
			async (c) => {
				const { label, tier, on, machineId, pciId, slot, model } = c.req.valid('json');
				const userId = Actor.userID;
				if (on === 'own' && Boolean(machineId) !== Boolean(pciId)) {
					throw new VisibleError(
						'validation',
						ErrorCodes.Validation.MISSING_REQUIRED_FIELD,
						'Name both `machineId` and `pciId`, or neither',
						machineId ? 'pciId' : 'machineId'
					);
				}
				let guard: (() => Promise<void>) | undefined;
				let placer: Placement.Placer;
				if (on === 'fleet') {
					// Plans count cloud rooms; your own GPUs are never limited.
					const team = await Team.personalFor(userId);
					const plan = team?.plan ?? 'free';
					if (model && !Rooms.mayUseModel(plan, model)) {
						throw Rooms.needsPro(model);
					}
					// Runs inside the creation transaction, under the person's lock.
					guard = async () => {
						if ((await Billing.cloudRooms(userId)) >= Rooms.allowed(plan)) {
							throw Rooms.atLimit(model ?? null, plan);
						}
					};
					placer = model
						? Placement.onFleetModel(model)
						: Placement.onFleetAny({ entryOnly: !Rooms.isPro(plan) });
				} else {
					placer =
						machineId && pciId
							? Placement.onOwn({ machineId, pciId, slot })
							: Placement.onlyHost;
				}
				const box = await Box.createPlaced(
					{ id: Identifier.ascending('box'), userId, label, tier },
					placer,
					guard
				);
				return c.json({ data: box }, 201);
			}
		)
		.get(
			'/',
			describeRoute({
				tags: ['Box'],
				summary: 'Your boxes',
				description:
					'Every box you own, oldest first, with its state and — for one that stopped — why, as its host reported it.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.array(Box.Info).meta({
										description: 'Your boxes',
										example: [Examples.Box]
									})
								)
							}
						},
						description: 'Your boxes'
					},
					401: ErrorResponses[401]
				}
			}),
			async (c) => c.json({ data: await Box.listByUser(Actor.userID) })
		);
}
