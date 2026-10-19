import { Actor } from '@nestri/core/actor';
import { Location } from '@nestri/core/box/location';
import { Team } from '@nestri/core/team/index';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

import { ErrorResponses, notPublic, Result } from '../utils';

/** Where a room can be created. */
export namespace LocationApi {
	export const route = new Hono().use(notPublic).get(
		'/',
		describeRoute({
			tags: ['Location'],
			summary: 'GPUs a room can go on',
			description:
				'Your own GPUs, one entry per card your hosts report, and the Nestri GPUs grouped by model. For each model, `available` says whether one is free now, `entry` whether it is an entry model, and `allowed` whether your plan may create a room on it.',
			responses: {
				200: {
					content: { 'application/json': { schema: Result(Location.Info) } },
					description: 'Your locations'
				},
				401: ErrorResponses[401]
			}
		}),
		async (c) => {
			const userId = Actor.userID;
			const plan = (await Team.personalFor(userId))?.plan ?? 'free';
			return c.json({ data: await Location.list({ userId, plan }) });
		}
	);
}
