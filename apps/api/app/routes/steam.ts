import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Steam } from '@nestri/core/steam/index';
import { LinkedAccount } from '@nestri/core/user/linked-account';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, notPublic, Result, validator } from '../utils';

export namespace SteamApi {
	export const route = new Hono()
		.use(notPublic)
		.get(
			'/linked',
			describeRoute({
				tags: ['Steam'],
				summary: 'Get your linked Steam account',
				description: 'The Steam account linked to the authenticated user, or null if none.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z
										.union([LinkedAccount.Info, z.null()])
										.meta({
											description: 'The linked Steam account, or null',
											example: Examples.LinkedAccount
										})
								)
							}
						},
						description: 'Linked Steam account'
					},
					401: ErrorResponses[401],
					429: ErrorResponses[429]
				}
			}),
			async (c) => {
				const linked = await LinkedAccount.findSteamByUser(Actor.userID);
				return c.json({ data: linked ? LinkedAccount.serialize(linked) : null });
			}
		)
		.post(
			'/unlink',
			describeRoute({
				tags: ['Steam'],
				summary: 'Unlink your Steam account',
				description: 'Detach the Steam account from the authenticated user.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({ unlinked: z.boolean() })
								)
							}
						},
						description: 'Steam account unlinked'
					},
					401: ErrorResponses[401],
					404: ErrorResponses[404],
					429: ErrorResponses[429]
				}
			}),
			async (c) => {
				const linked = await LinkedAccount.findSteamByUser(Actor.userID);
				if (!linked) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'No Steam account is linked to this user'
					);
				}
				await LinkedAccount.remove(linked.id);
				return c.json({ data: { unlinked: true } });
			}
		)
		.post(
			'/link',
		describeRoute({
			tags: ['Steam'],
			summary: 'Link a Steam account',
			description: 'Link a Steam account to a user (admin) or yourself (user)',
			responses: {
				200: {
					content: {
						'application/json': {
							schema: Result(
								z.object({
									linkedAccountId: z.string().meta({
										description: 'The ID of the linked account',
										example: Examples.LinkedAccount.id
									}),
									steamId: z.string().meta({
										description: 'The Steam ID that was linked',
										example: '76561197960287930'
									})
								})
							)
						}
					},
					description: 'Steam account linked'
				},
				400: ErrorResponses[400],
				401: ErrorResponses[401],
				403: ErrorResponses[403],
				429: ErrorResponses[429]
			}
		}),
		validator(
			'json',
			z.object({
				steamId: z.string().min(1).meta({
					description: 'Steam ID to link',
					example: '76561197960287930'
				}),
				userId: z.string().optional().meta({
					description: 'User ID to link to (admin only; omitted when linking your own account)',
					example: 'usr_XXXXXXXXXXXXXXXXXXXXXXXXX'
				}),
				profile: z
					.record(z.string(), z.unknown())
					.optional()
					.meta({
						description: 'Steam profile data',
						example: { personaname: 'Player', avatarfull: 'https://...' }
					})
			})
		),
		async (c) => {
			const body = c.req.valid('json');
			const actor = Actor.use();

			if (body.userId && actor.type !== 'admin') {
				throw new VisibleError(
					'forbidden',
					ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
					'Only admin can link a Steam account for another user'
				);
			}

			const linkedAccountID = await Steam.link({
				steamId: body.steamId,
				profile: body.profile,
				userId: body.userId
			});
			return c.json({
				data: { linkedAccountId: linkedAccountID, steamId: body.steamId }
			});
		}
	);
}
