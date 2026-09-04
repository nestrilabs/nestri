import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import z from 'zod';

import { BoxTable, BoxTier } from '../box/box.sql.js';
import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { GameTable } from '../game/game.sql.js';
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

	/**
	 * The states an agent is allowed to move a run into.
	 *
	 * `requested` is missing on purpose: it is written once, when the row is
	 * created, and nothing may put a run back there.
	 */
	export const ReportableState = z.enum(['starting', 'live', 'ended', 'failed']);

	export type ReportableState = z.infer<typeof ReportableState>;

	/**
	 * Where a run may go next, and nowhere else.
	 *
	 * `requested → live` is missing although it is the tempting shortcut:
	 * skipping `starting` means nothing ever holds the claim, and the claim is
	 * the only mutual exclusion in this design. `ended` and `failed` are
	 * terminal, so their entries are empty rather than absent — a state with no
	 * exits is a fact worth writing down.
	 */
	export const NEXT_STATES: Record<Info['state'], readonly Info['state'][]> = {
		requested: ['starting'],
		starting: ['live', 'failed'],
		live: ['ended', 'failed'],
		ended: [],
		failed: []
	};

	/**
	 * A unit of work handed to the agent that will carry it out.
	 *
	 * There is no queue: a run in state `requested` *is* the work order, and
	 * the agent that fulfils it moves that same row along. Two sources of truth
	 * for one piece of work is how a queue and a database come to disagree
	 * about whether something ran.
	 *
	 * `kind` is on the wire while there is only one value, so that a second
	 * kind is an addition rather than a redesign of the poll.
	 */
	export const Job = z
		.object({
			kind: z.literal('session.start').meta({
				description: 'What the agent is being asked to do',
				example: 'session.start'
			}),
			sessionId: z.string().meta({
				description: 'The run to report progress against',
				example: Examples.Session.id
			}),
			boxId: z.string().meta({
				description: 'The box to start',
				example: Examples.Session.boxId
			}),
			boxTier: z.enum(BoxTier.enumValues).meta({
				description: 'The size the box was asked for, which also sets output geometry',
				example: Examples.Box.tier
			}),
			gameId: z.string().meta({
				description: 'The game to launch',
				example: Examples.Session.gameId
			}),
			steamAppId: z.number().int().meta({
				description: 'The same game, in the id the store knows it by',
				example: Examples.Game.steamAppId
			}),
			linkedAccountId: z.string().meta({
				description: 'Which linked account is playing',
				example: Examples.Session.linkedAccountId
			})
		})
		.meta({
			ref: 'SessionJob',
			description: 'One run waiting to be started, as handed to the agent that will start it'
		});

	export type Job = z.infer<typeof Job>;

	/**
	 * The work waiting for one host.
	 *
	 * The scope is the join and not a filter the caller asks for: a box names
	 * the hardware it is placed on, a run reaches its hardware through its box,
	 * and so what one set of long-lived credentials can see is decided by this
	 * `where` clause rather than by whoever is holding them.
	 */
	export const listJobsForMachine = fn(z.string(), async (machineId) => {
		return Database.use(async (tx) => {
			return tx
				.select({ session: SessionTable, box: BoxTable, game: GameTable })
				.from(SessionTable)
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.innerJoin(GameTable, eq(SessionTable.gameId, GameTable.id))
				.where(
					and(
						eq(BoxTable.machineId, machineId),
						eq(SessionTable.state, 'requested'),
						isNull(SessionTable.timeDeleted),
						isNull(BoxTable.timeDeleted)
					)
				)
				.orderBy(SessionTable.timeCreated)
				.then((rows) =>
					rows.map(
						(row): Job => ({
							kind: 'session.start',
							sessionId: row.session.id,
							boxId: row.box.id,
							boxTier: row.box.tier as Job['boxTier'],
							gameId: row.game.id,
							steamAppId: row.game.steamAppId,
							linkedAccountId: row.session.linkedAccountId
						})
					)
				);
		});
	});

	/** One run, visible only to the host its box is placed on. */
	export const forMachine = fn(
		z.object({ id: Info.shape.id, machineId: z.string() }),
		async (input) => {
			return Database.use(async (tx) => {
				return tx
					.select({ session: SessionTable })
					.from(SessionTable)
					.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
					.where(
						and(
							eq(SessionTable.id, input.id),
							eq(BoxTable.machineId, input.machineId),
							isNull(SessionTable.timeDeleted),
							isNull(BoxTable.timeDeleted)
						)
					)
					.then((rows) => {
						const row = rows.at(0);
						return row ? serialize(row.session) : null;
					});
			});
		}
	);

	/** One run, visible only to the person who owns its box. */
	export const forOwner = fn(z.object({ id: Info.shape.id, userId: z.string() }), async (input) => {
		return Database.use(async (tx) => {
			return tx
				.select({ session: SessionTable })
				.from(SessionTable)
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.where(
					and(
						eq(SessionTable.id, input.id),
						eq(BoxTable.userId, input.userId),
						isNull(SessionTable.timeDeleted),
						isNull(BoxTable.timeDeleted)
					)
				)
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row.session) : null;
				});
		});
	});

	/** The boxes one host is responsible for, as a subquery to scope a write. */
	function boxesOn(tx: Parameters<Parameters<typeof Database.use>[0]>[0], machineId: string) {
		return tx
			.select({ id: BoxTable.id })
			.from(BoxTable)
			.where(and(eq(BoxTable.machineId, machineId), isNull(BoxTable.timeDeleted)));
	}

	/**
	 * Move a run from one exact state to another, or do nothing at all.
	 *
	 * This is the claim, and it is why `setState` is not enough on its own:
	 * updating on the id alone means two agents polling the same work both
	 * succeed and both start the same box. The current state is part of the
	 * `where` clause, so the database decides the winner and the loser gets
	 * null rather than a row. There is one host today, which is exactly why
	 * this would otherwise be built wrong and stay wrong.
	 *
	 * The host is in the same `where` clause. The caller checking first is not
	 * the same thing as the write being scoped, and only one of the two is
	 * still true when somebody adds a second caller.
	 */
	export const compareAndSetState = fn(
		z.object({
			id: Info.shape.id,
			machineId: z.string(),
			from: z.enum(SessionState.enumValues),
			to: z.enum(SessionState.enumValues),
			errorMessage: Info.shape.errorMessage
		}),
		async (input) => {
			const now = sql`now()`;
			return Database.use(async (tx) => {
				return tx
					.update(SessionTable)
					.set({
						state: input.to,
						errorMessage: input.to === 'failed' ? (input.errorMessage ?? null) : null,
						...(input.to === 'live'
							? { timeStarted: sql`coalesce(${SessionTable.timeStarted}, ${now})` }
							: {}),
						...(input.to === 'ended' || input.to === 'failed'
							? { timeStopped: sql`coalesce(${SessionTable.timeStopped}, ${now})` }
							: {})
					})
					.where(
						and(
							eq(SessionTable.id, input.id),
							eq(SessionTable.state, input.from),
							isNull(SessionTable.timeDeleted),
							inArray(SessionTable.boxId, boxesOn(tx, input.machineId))
						)
					)
					.returning()
					.then((rows) => {
						const row = rows.at(0);
						return row ? serialize(row) : null;
					});
			});
		}
	);

	/**
	 * What happened when an agent reported a state.
	 *
	 * Four outcomes that look alike from a distance and are not, which is the
	 * whole reason this is not a boolean:
	 *
	 * - `forbidden` — no such run, or it is not on this host. One answer for
	 *   both, so reporting states at ids cannot be used to discover them.
	 * - `unchanged` — already in that state. A retry after a lost response is
	 *   not a broken agent and must not be told it is.
	 * - `illegal` — not a transition that exists. The row does not move.
	 * - `lost` — a legal transition that something else got to first.
	 * - `moved` — it happened.
	 */
	export type TransitionOutcome = 'forbidden' | 'unchanged' | 'illegal' | 'lost' | 'moved';

	export interface TransitionResult {
		outcome: TransitionOutcome;
		session: Info | null;
	}

	export const transition = fn(
		z.object({
			id: Info.shape.id,
			machineId: z.string(),
			state: z.enum(SessionState.enumValues),
			errorMessage: Info.shape.errorMessage
		}),
		async (input): Promise<TransitionResult> => {
			const current = await forMachine({ id: input.id, machineId: input.machineId });
			if (!current) return { outcome: 'forbidden', session: null };
			if (current.state === input.state) return { outcome: 'unchanged', session: current };
			if (!NEXT_STATES[current.state].includes(input.state)) {
				return { outcome: 'illegal', session: current };
			}

			const moved = await compareAndSetState({
				id: input.id,
				machineId: input.machineId,
				from: current.state,
				to: input.state,
				errorMessage: input.errorMessage
			});
			// The state read above is not the state written below, and the gap
			// is where two agents race. Nothing moved means somebody else did.
			if (!moved) return { outcome: 'lost', session: current };
			return { outcome: 'moved', session: moved };
		}
	);

	export interface TicketResult {
		outcome: 'forbidden' | 'closed' | 'published';
		session: Info | null;
	}

	/**
	 * Publish a ticket for a run, on behalf of the host it is placed on.
	 *
	 * A ticket may appear while the state is still `starting` — it is
	 * republished as addresses are discovered, so the client polls and re-reads
	 * rather than keeping the first one. A run that has stopped is refused: an
	 * address for something that is not there can only mislead whoever is
	 * still polling.
	 */
	export const publishTicket = fn(
		z.object({
			id: Info.shape.id,
			machineId: z.string(),
			ticket: z.string().min(1)
		}),
		async (input): Promise<TicketResult> => {
			const current = await forMachine({ id: input.id, machineId: input.machineId });
			if (!current) return { outcome: 'forbidden', session: null };

			return Database.use(async (tx) => {
				return tx
					.update(SessionTable)
					.set({ ticket: input.ticket })
					.where(
						and(
							eq(SessionTable.id, input.id),
							notInArray(SessionTable.state, ['ended', 'failed']),
							isNull(SessionTable.timeDeleted),
							inArray(SessionTable.boxId, boxesOn(tx, input.machineId))
						)
					)
					.returning()
					.then((rows): TicketResult => {
						const row = rows.at(0);
						return row
							? { outcome: 'published', session: serialize(row) }
							: { outcome: 'closed', session: current };
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
