import { Actor } from '@nestri/core/actor';
import { BoxTier } from '@nestri/core/box/box.sql';
import { Box } from '@nestri/core/box/index';
import { Placement } from '@nestri/core/box/placement';
import { Env } from '@nestri/core/env';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Identifier } from '@nestri/core/id';
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
					'A box on your own host (`on: "own"`, the default; refused unless you have exactly one) or on a Nestri GPU (`on: "fleet"`). You hold at most one box on Nestri GPUs; asking again is a 409.',
				responses: {
					201: {
						content: { 'application/json': { schema: Result(Box.Info) } },
						description: 'The box, placed'
					},
					400: ErrorResponses[400],
					401: ErrorResponses[401],
					404: ErrorResponses[404],
					409: ErrorResponses[409]
				}
			}),
			validator(
				'json',
				z.object({
					label: z.string().trim().min(1).max(64).default('box'),
					tier: z.enum(BoxTier.enumValues).default('sm'),
					on: z.enum(['own', 'fleet']).default('own')
				})
			),
			async (c) => {
				const { label, tier, on } = c.req.valid('json');
				const userId = Actor.userID;
				if (on === 'fleet') {
					const organisationId = Env.get().FLEET_ORGANISATION_ID;
					const held = organisationId ? await Box.onFleet({ userId, organisationId }) : null;
					if (held) {
						throw new VisibleError(
							'already_exists',
							ErrorCodes.Validation.ALREADY_EXISTS,
							`You already have a box on Nestri GPUs: ${held.id}`
						);
					}
				}
				const box = await Box.createPlaced(
					{ id: Identifier.ascending('box'), userId, label, tier },
					on === 'fleet' ? Placement.fleet : Placement.onlyHost
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
									z.array(Box.Info).meta({ description: 'Your boxes', example: [Examples.Box] })
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
