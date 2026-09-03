import { and, eq, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { BoxState, BoxTable, BoxTier } from './box.sql.js';

/**
 * A VM someone owns.
 *
 * The box is the thing with a name and a URL ([0010](../../../../.nestri/decisions/0010-the-name-is-the-interface.md),
 * [0019](../../../../.nestri/decisions/0019-box-naming.md)); a
 * {@link ../session/index.ts | session} is one run of it, and the session is
 * what costs money. Keeping them apart is what lets a box be a durable thing a
 * person owns rather than a synonym for "currently playing".
 */
export namespace Box {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the box, and its DNS label',
				example: Examples.Box.id
			}),
			userId: z.string().meta({
				description: 'The person who owns this box',
				example: Examples.Box.userId
			}),
			machineId: z.string().meta({
				description: 'The host it is placed on',
				example: Examples.Box.machineId
			}),
			label: z.string().meta({
				description: 'Editable display name. Not unique, and not the DNS label',
				example: Examples.Box.label
			}),
			tier: z.enum(BoxTier.enumValues).meta({
				description: 'Requested size, which also sets output geometry',
				example: Examples.Box.tier
			}),
			state: z.enum(BoxState.enumValues).meta({
				description: 'What the box is doing, in neslet’s vocabulary',
				example: Examples.Box.state
			}),
			stopReason: z.string().nullable().optional().meta({
				description: 'Why it stopped, verbatim from neslet. Null if it never ran',
				example: Examples.Box.stopReason
			}),
			stopClean: z.boolean().nullable().optional().meta({
				description: 'Whether that stop was clean. Null if it never ran',
				example: Examples.Box.stopClean
			})
		})
		.meta({
			ref: 'Box',
			description: 'A virtual machine owned by a person and placed on a team’s hardware',
			example: Examples.Box
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(
		Info.pick({ id: true, userId: true, machineId: true, label: true, tier: true }),
		async (input) => {
			return Database.use(async (tx) => {
				return tx
					.insert(BoxTable)
					.values({
						id: input.id,
						userId: input.userId,
						machineId: input.machineId,
						label: input.label,
						tier: input.tier
					})
					.returning()
					.then((rows) => serialize(rows[0]!));
			});
		}
	);

	export const fromID = fn(Info.shape.id, async (id) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(BoxTable)
				.where(and(eq(BoxTable.id, id), isNull(BoxTable.timeDeleted)))
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	export const listByUser = fn(Info.shape.userId, async (userId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(BoxTable)
				.where(and(eq(BoxTable.userId, userId), isNull(BoxTable.timeDeleted)))
				.orderBy(BoxTable.timeCreated)
				.then((rows) => rows.map(serialize));
		});
	});

	export const listByMachine = fn(Info.shape.machineId, async (machineId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(BoxTable)
				.where(and(eq(BoxTable.machineId, machineId), isNull(BoxTable.timeDeleted)))
				.orderBy(BoxTable.timeCreated)
				.then((rows) => rows.map(serialize));
		});
	});

	/**
	 * Record what `neslet` says a box is doing.
	 *
	 * The stop reason is cleared on any state that is not `stopped`, so a box
	 * that ran, faulted, and was started again does not keep explaining a
	 * failure it has since recovered from.
	 */
	export const setState = fn(
		Info.pick({ id: true, state: true, stopReason: true, stopClean: true }),
		async (input) => {
			const stopped = input.state === 'stopped';
			return Database.use(async (tx) => {
				return tx
					.update(BoxTable)
					.set({
						state: input.state,
						stopReason: stopped ? (input.stopReason ?? null) : null,
						stopClean: stopped ? (input.stopClean ?? null) : null
					})
					.where(and(eq(BoxTable.id, input.id), isNull(BoxTable.timeDeleted)))
					.returning()
					.then((rows) => {
						const row = rows.at(0);
						return row ? serialize(row) : null;
					});
			});
		}
	);

	export const rename = fn(Info.pick({ id: true, userId: true, label: true }), async (input) => {
		return Database.use(async (tx) => {
			return tx
				.update(BoxTable)
				.set({ label: input.label })
				.where(
					and(
						eq(BoxTable.id, input.id),
						// Owner-scoped in the query, so somebody else's box is a miss
						// rather than a permission check that could be forgotten.
						eq(BoxTable.userId, input.userId),
						isNull(BoxTable.timeDeleted)
					)
				)
				.returning()
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx.update(BoxTable).set({ timeDeleted: sql`now()` }).where(eq(BoxTable.id, id));
		});
	});

	export function serialize(input: typeof BoxTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			userId: input.userId,
			machineId: input.machineId,
			label: input.label,
			tier: input.tier as Info['tier'],
			state: input.state as Info['state'],
			stopReason: input.stopReason,
			stopClean: input.stopClean
		};
	}
}
