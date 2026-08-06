import { eq, and, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { TeamMemberRole, TeamMemberTable } from './member.sql.js';

export namespace Member {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the membership record',
				example: Examples.Member.id
			}),
			teamId: z.string().meta({
				description: 'The team this membership belongs to',
				example: Examples.Member.teamId
			}),
			userId: z.string().meta({
				description: 'The user who is a member of the team',
				example: Examples.Member.userId
			}),
			role: z.enum(TeamMemberRole.enumValues).meta({
				description: 'Role within the team (owner, admin, member)',
				example: Examples.Member.role
			})
		})
		.meta({
			ref: 'Member',
			description: 'Links a user to a team with a specific role',
			example: Examples.Member
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(
		Info.pick({ id: true, teamId: true, userId: true, role: true }),
		async (input) => {
			await Database.use(async (tx) => {
				await tx.insert(TeamMemberTable).values({
					id: input.id,
					teamId: input.teamId,
					userId: input.userId,
					role: input.role ?? 'member'
				});
			});
			return input.id;
		}
	);

	export const findByTeamAndUser = fn(Info.pick({ teamId: true, userId: true }), async (input) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(TeamMemberTable)
				.where(
					and(
						eq(TeamMemberTable.teamId, input.teamId),
						eq(TeamMemberTable.userId, input.userId),
						isNull(TeamMemberTable.timeDeleted)
					)
				)
				.then((rows) => rows.at(0) ?? null);
		});
	});

	export const listByTeam = fn(Info.shape.teamId, async (teamId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(TeamMemberTable)
				.where(and(eq(TeamMemberTable.teamId, teamId), isNull(TeamMemberTable.timeDeleted)))
				.orderBy(TeamMemberTable.timeCreated);
		});
	});

	export const listByUser = fn(Info.shape.userId, async (userId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(TeamMemberTable)
				.where(and(eq(TeamMemberTable.userId, userId), isNull(TeamMemberTable.timeDeleted)))
				.orderBy(TeamMemberTable.timeCreated);
		});
	});

	export const updateRole = fn(Info.pick({ id: true, role: true }), async (input) => {
		await Database.use(async (tx) => {
			await tx
				.update(TeamMemberTable)
				.set({ role: input.role })
				.where(eq(TeamMemberTable.id, input.id));
		});
	});

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(TeamMemberTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(TeamMemberTable.id, id));
		});
	});

	export function serialize(input: typeof TeamMemberTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			teamId: input.teamId,
			userId: input.userId,
			role: input.role
		};
	}
}
