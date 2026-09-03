import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { SessionState, SessionTable } from './session.sql.js';

/**
 * One run of one box, and the unit that gets billed.
 *
 * A row appears at `POST /session`, before anything has been placed — so the
 * row *is* the job the control plane fulfils, and `requested` is a real state
 * rather than a placeholder. The ticket arrives later and changes as addresses
 * are discovered, which is why a client polls this rather than being handed a
 * value once.
 */
export namespace Session {
	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for this run',
				example: Examples.Session.id
			}),
			boxId: z.string().meta({
				description: 'The box being run',
				example: Examples.Session.boxId
			}),
			gameId: z.string().meta({
				description: 'The game this run launched',
				example: Examples.Session.gameId
			}),
			linkedAccountId: z.string().meta({
				description: 'Which linked Steam account is playing',
				example: Examples.Session.linkedAccountId
			}),
			state: z.enum(SessionState.enumValues).meta({
				description: 'Where this run is. Only `live` costs money',
				example: Examples.Session.state
			}),
			ticket: z.string().nullable().optional().meta({
				description: 'Current iroh connect ticket, or null before neshub mints one',
				example: Examples.Session.ticket
			}),
			timeStarted: z.string().nullable().optional().meta({
				description: 'When the box actually started, not when the row appeared',
				example: Examples.Session.timeStarted
			}),
			timeStopped: z.string().nullable().optional().meta({
				description: 'When this run ended',
				example: Examples.Session.timeStopped
			}),
			errorMessage: z.string().nullable().optional().meta({
				description: 'Why it failed, when it did',
				example: Examples.Session.errorMessage
			})
		})
		.meta({
			ref: 'Session',
			description: 'One live run of one box by one Steam account, and the billing unit',
			example: Examples.Session
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(
		Info.pick({ id: true, boxId: true, gameId: true, linkedAccountId: true }),
		async (input) => {
			return Database.use(async (tx) => {
				return tx
					.insert(SessionTable)
					.values({
						id: input.id,
						boxId: input.boxId,
						gameId: input.gameId,
						linkedAccountId: input.linkedAccountId
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
				.from(SessionTable)
				.where(and(eq(SessionTable.id, id), isNull(SessionTable.timeDeleted)))
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	/**
	 * The run currently occupying a box, if any.
	 *
	 * Newest first and limited to one: a box has at most one live session by
	 * construction, and if that ever stops being true this is the query that
	 * should start refusing rather than picking a winner silently.
	 */
	export const activeForBox = fn(Info.shape.boxId, async (boxId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(SessionTable)
				.where(
					and(
						eq(SessionTable.boxId, boxId),
						isNull(SessionTable.timeDeleted),
						isNull(SessionTable.timeStopped)
					)
				)
				.orderBy(desc(SessionTable.timeCreated))
				.limit(1)
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	export const listByBox = fn(Info.shape.boxId, async (boxId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(SessionTable)
				.where(and(eq(SessionTable.boxId, boxId), isNull(SessionTable.timeDeleted)))
				.orderBy(desc(SessionTable.timeCreated))
				.then((rows) => rows.map(serialize));
		});
	});

	/**
	 * Publish the current ticket.
	 *
	 * Overwrites, deliberately: a ticket is republished as addresses are
	 * discovered, so a later one for the same session is a better address for
	 * the same thing and not a second session.
	 */
	export const setTicket = fn(Info.pick({ id: true, ticket: true }), async (input) => {
		return Database.use(async (tx) => {
			return tx
				.update(SessionTable)
				.set({ ticket: input.ticket ?? null })
				.where(and(eq(SessionTable.id, input.id), isNull(SessionTable.timeDeleted)))
				.returning()
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	/**
	 * Move a run along.
	 *
	 * `live` stamps `timeStarted` and `ended`/`failed` stamp `timeStopped`, both
	 * only if unset — so a duplicate report does not extend a session someone is
	 * billed for, and metering can trust the pair.
	 */
	export const setState = fn(
		Info.pick({ id: true, state: true, errorMessage: true }),
		async (input) => {
			const now = sql`now()`;
			return Database.use(async (tx) => {
				return tx
					.update(SessionTable)
					.set({
						state: input.state,
						errorMessage: input.state === 'failed' ? (input.errorMessage ?? null) : null,
						...(input.state === 'live'
							? { timeStarted: sql`coalesce(${SessionTable.timeStarted}, ${now})` }
							: {}),
						...(input.state === 'ended' || input.state === 'failed'
							? { timeStopped: sql`coalesce(${SessionTable.timeStopped}, ${now})` }
							: {})
					})
					.where(and(eq(SessionTable.id, input.id), isNull(SessionTable.timeDeleted)))
					.returning()
					.then((rows) => {
						const row = rows.at(0);
						return row ? serialize(row) : null;
					});
			});
		}
	);

	export function serialize(input: typeof SessionTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			boxId: input.boxId,
			gameId: input.gameId,
			linkedAccountId: input.linkedAccountId,
			state: input.state as Info['state'],
			ticket: input.ticket,
			timeStarted: input.timeStarted?.toISOString() ?? null,
			timeStopped: input.timeStopped?.toISOString() ?? null,
			errorMessage: input.errorMessage
		};
	}
}
