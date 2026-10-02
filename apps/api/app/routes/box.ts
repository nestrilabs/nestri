import { Actor } from '@nestri/core/actor';
import { Box } from '@nestri/core/box/index';
import { Examples } from '@nestri/core/examples';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, notPublic, Result } from '../utils';

/**
 * The caller's boxes. Read-only: a box is created by placement and its state
 * is whatever its host last reported, so the list is the whole of what a
 * person can ask here for now.
 */
export namespace BoxApi {
	export const route = new Hono().use(notPublic).get(
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
