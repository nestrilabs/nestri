import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Team } from '@nestri/core/team/index';
import { Member } from '@nestri/core/team/member';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, notPublic, Result, validator } from '../utils';

/**
 * The teams a caller belongs to: read them, rename one, see who is on it.
 *
 * Every read is membership-scoped in the same way — a team you are not on is
 * a 404, never a 403, so an id cannot be probed for. Renaming takes an owner
 * or an admin, because the slug is the team's address and changing it moves
 * every link somebody saved.
 */
export namespace TeamApi {
	const Mine = Team.Info.extend({
		role: Member.Info.shape.role
	}).meta({ ref: 'TeamMembership', description: 'A team, and your role on it' });

	const Person = z
		.object({
			id: Member.Info.shape.id,
			userId: Member.Info.shape.userId,
			role: Member.Info.shape.role,
			name: z.string(),
			email: z.string().nullable()
		})
		.meta({ ref: 'TeamPerson', description: 'A member of a team, and who they are' });

	/** The caller's membership of a team, or the 404 that hides whether it exists. */
	async function membership(teamId: string) {
		const member = await Member.findByTeamAndUser({ teamId, userId: Actor.userID });
		const team = member ? await Team.fromID(teamId) : null;
		if (!member || !team) {
			throw new VisibleError(
				'not_found',
				ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
				'No such team, or you are not on it'
			);
		}
		return { member, team };
	}

	export const route = new Hono()
		.use(notPublic)
		.get(
			'/',
			describeRoute({
				tags: ['Team'],
				summary: 'Your teams',
				description:
					'Every team you are a member of, oldest membership first — so the first is your personal team, the one made when you signed up.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.array(Mine).meta({
										description: 'Your teams',
										example: [{ ...Examples.Team, role: 'owner' }]
									})
								)
							}
						},
						description: 'Your teams'
					},
					401: ErrorResponses[401]
				}
			}),
			async (c) => {
				const memberships = await Member.listByUser(Actor.userID);
				const teams = await Promise.all(
					memberships.map(async (m) => {
						const team = await Team.fromID(m.teamId);
						return team ? { ...Team.serialize(team), role: m.role } : null;
					})
				);
				return c.json({ data: teams.filter((t) => t !== null) });
			}
		)
		.patch(
			'/:id',
			describeRoute({
				tags: ['Team'],
				summary: 'Rename a team',
				description:
					'Change the name, the slug, or both. Owners and admins only. A slug another team holds is a 409.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Team.Info) } },
						description: 'The team, renamed'
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
				z
					.object({
						name: Team.Name.optional().meta({ description: 'Display name' }),
						slug: Team.Slug.optional().meta({ description: 'URL-friendly unique slug' })
					})
					.refine((b) => b.name !== undefined || b.slug !== undefined, {
						message: 'Give a name, a slug, or both'
					})
			),
			async (c) => {
				const body = c.req.valid('json');
				const { member, team } = await membership(c.req.param('id'));
				if (member.role !== 'owner' && member.role !== 'admin') {
					throw new VisibleError(
						'forbidden',
						ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
						'Only an owner or an admin can rename a team'
					);
				}
				try {
					const renamed = await Team.rename({ id: team.id, ...body });
					return c.json({ data: renamed! });
				} catch (error) {
					if (error instanceof Team.SlugTaken) {
						throw new VisibleError(
							'already_exists',
							ErrorCodes.Validation.ALREADY_EXISTS,
							'That slug is taken',
							'slug'
						);
					}
					throw error;
				}
			}
		)
		.get(
			'/:id/members',
			describeRoute({
				tags: ['Team'],
				summary: 'Who is on a team',
				description: 'Members of a team you are on, oldest first, with their name and address.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(z.array(Person)) } },
						description: 'The members'
					},
					401: ErrorResponses[401],
					404: ErrorResponses[404]
				}
			}),
			async (c) => {
				const { team } = await membership(c.req.param('id'));
				return c.json({ data: await Member.listPeople(team.id) });
			}
		);
}
