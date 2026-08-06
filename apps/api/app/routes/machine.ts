import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Identifier } from '@nestri/core/id';
import { Machine } from '@nestri/core/machine/index';
import { Member } from '@nestri/core/team/member';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, machineOnly, notPublic, Result, validator } from '../utils';

/**
 * Host registration.
 *
 * A box does not get to say who it is. It registers once against its owner's
 * session, is handed an id and a secret, and authenticates as itself from then
 * on — so `hostId` on a download report is something the API assigned rather
 * than a free-form string any holder of a shared secret could invent.
 */
export namespace MachineApi {
	export const route = new Hono()
		.post(
			'/register',
			notPublic,
			describeRoute({
				tags: ['Machine'],
				summary: 'Register a nessh host',
				description:
					'Exchange the calling user session for a machine id and secret. The secret is returned once and never again — it is stored only as a digest.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({
										machineId: z.string().meta({ example: Examples.Machine.id }),
										secret: z.string().meta({
											description: 'Shown once. Store it on the box; it cannot be retrieved.'
										})
									})
								)
							}
						},
						description: 'The box is registered'
					},
					401: ErrorResponses[401],
					403: ErrorResponses[403]
				}
			}),
			validator(
				'json',
				z.object({
					label: z.string().min(1).max(64).meta({
						description: 'Human-readable name for the box',
						example: Examples.Machine.label
					}),
					teamId: z.string().optional().meta({
						description: 'Register the box into a team rather than to the user alone'
					})
				})
			),
			async (c) => {
				const { label, teamId } = c.req.valid('json');

				// `notPublic` also admits admin, which has no user to own the box.
				// Registering is an act of ownership, so it needs a real one.
				const actor = Actor.use();
				if (actor.type !== 'user' && actor.type !== 'member') {
					throw new VisibleError(
						'forbidden',
						ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
						'Registering a machine requires a user session'
					);
				}

				const registered = await Machine.register({
					id: Identifier.ascending('machine'),
					ownerUserId: Actor.userID,
					teamId: teamId ?? (actor.type === 'member' ? actor.properties.teamID : null),
					label
				});

				return c.json({ data: { machineId: registered.id, secret: registered.secret } });
			}
		)
		.patch(
			'/:id',
			notPublic,
			describeRoute({
				tags: ['Machine'],
				summary: 'Move a box into a team, or out of one',
				description:
					'Scope a machine you own to a team you belong to, or pass teamId: null to make it yours alone again. This is not ownership transfer — the owner does not change.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Machine.Info) } },
						description: 'The machine, rescoped'
					},
					401: ErrorResponses[401],
					403: ErrorResponses[403],
					404: ErrorResponses[404]
				}
			}),
			validator(
				'json',
				z.object({
					teamId: z.string().nullable().meta({
						description: 'Team to scope the box to, or null to scope it to you alone'
					})
				})
			),
			async (c) => {
				const { teamId } = c.req.valid('json');

				const actor = Actor.use();
				if (actor.type !== 'user' && actor.type !== 'member') {
					throw new VisibleError(
						'forbidden',
						ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
						'Rescoping a machine requires a user session'
					);
				}

				// Verified before the write. `setTeam` scopes to the owner but
				// knows nothing about who belongs to the target team, so this is
				// the only place that check exists.
				if (teamId) {
					const membership = await Member.findByTeamAndUser({
						teamId,
						userId: Actor.userID
					});
					if (!membership) {
						throw new VisibleError(
							'forbidden',
							ErrorCodes.Permission.FORBIDDEN,
							'You are not a member of that team'
						);
					}
				}

				const machine = await Machine.setTeam({
					id: c.req.param('id'),
					ownerUserId: Actor.userID,
					teamId
				});
				if (!machine) {
					// Owner-scoped in the query, so someone else's machine is a
					// 404 rather than a 403 — no way to probe for ids.
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'No such machine, or it is not yours'
					);
				}
				return c.json({ data: machine });
			}
		)
		.get(
			'/entitlement',
			machineOnly,
			describeRoute({
				tags: ['Machine'],
				summary: 'Ask whether a user may use this box',
				description:
					'Answers for the calling machine only — the machine is taken from its credentials, never from the query, so a box cannot ask about another. Membership is read live, so removing someone from a team removes their access.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Machine.Entitlement) } },
						description: 'Whether the user may use this machine, and why'
					},
					403: ErrorResponses[403]
				}
			}),
			validator('query', z.object({ userId: z.string().min(1) })),
			async (c) => {
				const { userId } = c.req.valid('query');
				return c.json({
					data: await Machine.entitlement({ machineId: Actor.machineID, userId })
				});
			}
		)
		.get(
			'/me',
			machineOnly,
			describeRoute({
				tags: ['Machine'],
				summary: 'Describe the calling machine',
				description:
					'Returns the registration record for the credentials used. A box calls this at startup to confirm its credentials still work before relying on them.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Machine.Info) } },
						description: 'The calling machine'
					},
					403: ErrorResponses[403],
					404: ErrorResponses[404]
				}
			}),
			async (c) => {
				const machine = await Machine.fromID(Actor.machineID);
				if (!machine) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'This machine no longer exists'
					);
				}
				return c.json({ data: machine });
			}
		)
		.get(
			'/',
			notPublic,
			describeRoute({
				tags: ['Machine'],
				summary: 'List your registered hosts',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(z.array(Machine.Info)) } },
						description: 'Machines owned by the caller'
					},
					401: ErrorResponses[401],
					403: ErrorResponses[403]
				}
			}),
			async (c) => {
				return c.json({ data: await Machine.listByOwner(Actor.userID) });
			}
		);
}
