import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Machine } from '@nestri/core/machine/index';
import { Organisation } from '@nestri/core/organisation/index';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, notPublic, Result } from '../utils';

/**
 * The organisation a caller belongs to, and the hardware it owns.
 *
 * Read-only on purpose. Organisations are made by hand and their domains are
 * verified by hand, because the thing a verified domain grants is membership —
 * and a route that mints one would be a route that hands out membership of any
 * domain somebody types. When that changes, verification is what has to be
 * built first, not this file.
 *
 * There is no organisation to name in a path: membership is derived from the
 * caller's verified address, so there is exactly one answer and asking about
 * anybody else's is not a question this API takes.
 */
export namespace OrganisationApi {
	/** The caller's organisation, or a 404 that says what that means. */
	async function mine() {
		const organisation = await Organisation.forUser(Actor.userID);
		if (!organisation) {
			throw new VisibleError(
				'not_found',
				ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
				'Your address does not belong to a verified organisation domain'
			);
		}
		return organisation;
	}

	export const route = new Hono()
		.use(notPublic)
		.get(
			'/',
			describeRoute({
				tags: ['Organisation'],
				summary: 'The organisation you belong to',
				description:
					'Derived from the domain of your verified email address. A personal address has no organisation, which is not an error in the product — it is the ordinary consumer account — but it is a 404 here because there is nothing to return.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Organisation.Info) } },
						description: 'Your organisation'
					},
					401: ErrorResponses[401],
					404: ErrorResponses[404]
				}
			}),
			async (c) => c.json({ data: await mine() })
		)
		.get(
			'/machines',
			describeRoute({
				tags: ['Organisation'],
				summary: 'The hardware your organisation owns',
				description:
					'Every host the organisation owns outright. These belong to no team and no person, which is what separates them from a host somebody brought — those appear under the team that owns them instead.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.array(Machine.Info).meta({
										description: 'The fleet',
										example: [Examples.Machine]
									})
								)
							}
						},
						description: 'The fleet'
					},
					401: ErrorResponses[401],
					404: ErrorResponses[404]
				}
			}),
			async (c) => {
				const organisation = await mine();
				return c.json({ data: await Machine.listByOrganisation(organisation.id) });
			}
		);
}
