import { AccessToken } from '@nestri/core/access-token/index';
import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Identifier } from '@nestri/core/id';
import { Member } from '@nestri/core/team/member';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, notPublic, Result, validator } from '../utils';

/**
 * Personal access tokens.
 *
 * The credential for anything that is not a browser: a nessh box registering
 * itself, or a script driving the API. A session JWT cannot do this job — it
 * is short-lived and cannot be revoked without rotating signing keys for
 * everyone, which is wrong for something that sits in a config file for
 * months.
 *
 * Minting requires a *user session*, deliberately. Allowing the admin token to
 * mint one for an arbitrary user would turn a credential that can read and
 * write all API data into one that can *become* any user, and that boundary is
 * the reason `Actor.userID` refuses admin at all.
 */
/**
 * Decide what a new token is scoped to.
 *
 * Team scope is the default, because a box or a script is nearly always doing
 * team work and a user-scoped token silently cannot see any of it. But the
 * default only applies when it is *unambiguous*: with several teams, guessing
 * would hand out a token reaching resources the caller did not have in mind.
 *
 * Note team scope is broader than user scope, never narrower — hence `null` as
 * an explicit way to ask for the narrow one. It still cannot exceed what the
 * user themselves may do: the grant is re-checked against live membership on
 * every request, with their own role.
 *
 * @param requested `undefined` to take the default, `null` to force user
 *                  scope, or a team id to name one.
 */
async function resolveTeamScope(requested: string | null | undefined): Promise<string | null> {
	if (requested === null) {
		return null;
	}

	if (requested !== undefined) {
		// Verified here rather than trusted from the body: a token is only ever
		// as scoped as what was checked at the moment it was made.
		const membership = await Member.findByTeamAndUser({
			teamId: requested,
			userId: Actor.userID
		});
		if (!membership) {
			throw new VisibleError(
				'forbidden',
				ErrorCodes.Permission.FORBIDDEN,
				'You are not a member of that team'
			);
		}
		return requested;
	}

	const memberships = await Member.listByUser(Actor.userID);
	if (memberships.length === 0) {
		return null;
	}
	if (memberships.length > 1) {
		throw new VisibleError(
			'validation',
			ErrorCodes.Validation.INVALID_PARAMETER,
			'You belong to several teams — name the one this token is for, or pass teamId: null to scope it to yourself',
			'teamId'
		);
	}
	return memberships[0]!.teamId;
}

export namespace AccessTokenApi {
	export const route = new Hono()
		.post(
			'/',
			notPublic,
			describeRoute({
				tags: ['AccessToken'],
				summary: 'Create a personal access token',
				description:
					'Mint a long-lived, revocable token for the calling user. The token is returned once and never again — only its digest is stored.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({
										id: z.string().meta({ example: Examples.AccessToken.id }),
										token: z.string().meta({
											description: 'Shown once. Store it now; it cannot be retrieved.'
										})
									})
								)
							}
						},
						description: 'A freshly minted token'
					},
					401: ErrorResponses[401],
					403: ErrorResponses[403]
				}
			}),
			validator(
				'json',
				z.object({
					name: z.string().min(1).max(64).meta({
						description: 'What this token is for, so it can be recognised in a list',
						example: Examples.AccessToken.name
					}),
					teamId: z.string().nullable().optional().meta({
						description:
							'Team to scope the token to. Omit to default to your team when you have exactly one; pass null to force a token scoped to you alone.'
					}),
					expiresInDays: z.number().int().min(1).max(365).optional().meta({
						description: 'Optional lifetime. Omit for a token that does not expire.'
					})
				})
			),
			async (c) => {
				const { name, teamId, expiresInDays } = c.req.valid('json');

				const actor = Actor.use();
				if (actor.type !== 'user' && actor.type !== 'member') {
					throw new VisibleError(
						'forbidden',
						ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
						'Creating an access token requires a user session'
					);
				}

				const scopedTeamId = await resolveTeamScope(teamId);

				const created = await AccessToken.create({
					id: Identifier.ascending('accessToken'),
					ownerUserId: Actor.userID,
					teamId: scopedTeamId,
					name,
					expiresInDays
				});

				return c.json({ data: { id: created.id, token: created.token } });
			}
		)
		.get(
			'/',
			notPublic,
			describeRoute({
				tags: ['AccessToken'],
				summary: 'List your access tokens',
				description: 'Returns metadata only. The token values are not stored and cannot be shown.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(z.array(AccessToken.Info)) } },
						description: 'Tokens belonging to the caller'
					},
					401: ErrorResponses[401],
					403: ErrorResponses[403]
				}
			}),
			async (c) => {
				return c.json({ data: await AccessToken.listByOwner(Actor.userID) });
			}
		)
		.delete(
			'/:id',
			notPublic,
			describeRoute({
				tags: ['AccessToken'],
				summary: 'Revoke an access token',
				description:
					'Revokes immediately. Revocation is the reason these exist rather than long-lived JWTs.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(z.object({ id: z.string() })) } },
						description: 'The token no longer works'
					},
					401: ErrorResponses[401],
					403: ErrorResponses[403],
					404: ErrorResponses[404]
				}
			}),
			async (c) => {
				// Scoped to the owner in the query itself, so revoking someone
				// else's token is a 404 rather than a permission check that
				// could be forgotten.
				const revoked = await AccessToken.revoke({
					id: c.req.param('id'),
					ownerUserId: Actor.userID
				});
				if (!revoked) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'No such token, or it is not yours'
					);
				}
				return c.json({ data: { id: revoked.id } });
			}
		);
}
