import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { BoxTable } from '../box/box.sql.js';
import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { GameTable } from '../game/game.sql.js';
import { LaunchState, LaunchTable } from './launch.sql.js';
import { SessionTable } from './session.sql.js';

/**
 * One game or app inside a running box. ref(d-0085)
 *
 * The run (`Session`) is the box and the billing unit; a launch is what runs in
 * it. This module knows launches and nothing about stopping runs, so it can be
 * imported by `Session` without a cycle: everything here that can end the last
 * launch of a run says so in its result, and `Session` acts on it.
 */
export namespace Launch {
	export const Info = z
		.object({
			id: z
				.string()
				.meta({ description: 'Unique identifier for this launch', example: Examples.Launch.id }),
			gameId: z
				.string()
				.meta({ description: 'The game this launch runs', example: Examples.Launch.gameId }),
			state: z.enum(LaunchState.enumValues).meta({
				description:
					'`requested`: waiting for the host to start it in the box. `running`: started. `ended` and `failed` are over',
				example: Examples.Launch.state
			}),
			timeStarted: z.string().nullable().meta({
				description: 'When the host started it in the box',
				example: '2026-07-28T12:00:00.000Z'
			}),
			timeStopped: z.string().nullable().meta({ description: 'When it ended', example: null }),
			timeStopRequested: z.string().nullable().meta({
				description:
					'When its owner asked for it to end. It stays `running` until its host has stopped it',
				example: null
			}),
			endReason: z.string().nullable().meta({
				description: 'Why it is over, in the words of `Session.endReason`, once it is',
				example: null
			}),
			errorMessage: z
				.string()
				.nullable()
				.meta({ description: 'Why it failed, when it did', example: null })
		})
		.meta({ ref: 'Launch', description: 'One game or app started inside a run of a box' });

	export type Info = z.infer<typeof Info>;

	export const ReportableState = z.enum(['running', 'ended', 'failed']);
	export type ReportableState = z.infer<typeof ReportableState>;

	/** Where a launch may go next. `requested` is written once, at creation. */
	export const NEXT_STATES: Record<Info['state'], readonly Info['state'][]> = {
		requested: ['running', 'ended', 'failed'],
		running: ['ended', 'failed'],
		ended: [],
		failed: []
	};

	export const OPEN = ['requested', 'running'] as const;

	export function serialize(row: typeof LaunchTable.$inferSelect): Info {
		return {
			id: row.id,
			gameId: row.gameId,
			state: row.state as Info['state'],
			timeStarted: row.timeStarted?.toISOString() ?? null,
			timeStopped: row.timeStopped?.toISOString() ?? null,
			timeStopRequested: row.timeStopRequested?.toISOString() ?? null,
			endReason: row.endReason,
			errorMessage: row.errorMessage
		};
	}

	/** Every launch of one run, oldest first. */
	export const listForSession = fn(z.string(), async (sessionId) =>
		Database.use((tx) =>
			tx
				.select()
				.from(LaunchTable)
				.where(and(eq(LaunchTable.sessionId, sessionId), isNull(LaunchTable.timeDeleted)))
				.orderBy(asc(LaunchTable.timeCreated), asc(LaunchTable.id))
				.then((rows) => rows.map(serialize))
		)
	);

	/** Whether a run still has a launch that is not over. */
	export async function anyOpen(sessionId: string): Promise<boolean> {
		return Database.use((tx) =>
			tx
				.select({ id: LaunchTable.id })
				.from(LaunchTable)
				.where(
					and(
						eq(LaunchTable.sessionId, sessionId),
						inArray(LaunchTable.state, [...OPEN]),
						isNull(LaunchTable.timeDeleted)
					)
				)
				.limit(1)
				.then((rows) => rows.length > 0)
		);
	}

	/**
	 * End every launch of these runs that is not over. A launch never outlives
	 * its run, so this goes with every write that stops one.
	 */
	export async function endAllOf(sessionIds: string[], endReason: string | null) {
		if (sessionIds.length === 0) return;
		await Database.use((tx) =>
			tx
				.update(LaunchTable)
				.set({
					state: 'ended',
					timeStopped: sql`coalesce(${LaunchTable.timeStopped}, now())`,
					endReason: sql`coalesce(${LaunchTable.endReason}, ${endReason})`
				})
				.where(
					and(inArray(LaunchTable.sessionId, sessionIds), inArray(LaunchTable.state, [...OPEN]))
				)
		);
	}

	/** The run's first launch is running once the box is live: the host started it with the box. */
	export async function firstStarted(sessionId: string) {
		await Database.use((tx) =>
			tx
				.update(LaunchTable)
				.set({ state: 'running', timeStarted: sql`coalesce(${LaunchTable.timeStarted}, now())` })
				.where(
					and(
						eq(LaunchTable.sessionId, sessionId),
						eq(LaunchTable.first, true),
						eq(LaunchTable.state, 'requested')
					)
				)
		);
	}

	export async function insert(input: {
		id: string;
		sessionId: string;
		gameId: string;
		first: boolean;
	}) {
		return Database.use((tx) =>
			tx
				.insert(LaunchTable)
				.values(input)
				.returning()
				.then((rows) => serialize(rows[0]!))
		);
	}

	/** One launch of one run, as the row. */
	export async function row(sessionId: string, launchId: string) {
		return Database.use((tx) =>
			tx
				.select()
				.from(LaunchTable)
				.where(
					and(
						eq(LaunchTable.id, launchId),
						eq(LaunchTable.sessionId, sessionId),
						isNull(LaunchTable.timeDeleted)
					)
				)
				.then((rows) => rows.at(0) ?? null)
		);
	}

	/**
	 * Move a launch from one exact state to another, or do nothing. The state is
	 * in the `where`, so two writers racing get one winner.
	 */
	export async function compareAndSet(input: {
		id: string;
		from: Info['state'];
		to: Info['state'];
		endReason?: string | null;
		errorMessage?: string | null;
	}) {
		const over = input.to === 'ended' || input.to === 'failed';
		return Database.use((tx) =>
			tx
				.update(LaunchTable)
				.set({
					state: input.to,
					...(input.to === 'running'
						? { timeStarted: sql`coalesce(${LaunchTable.timeStarted}, now())` }
						: {}),
					...(over
						? {
								timeStopped: sql`coalesce(${LaunchTable.timeStopped}, now())`,
								endReason: input.endReason ?? null,
								errorMessage: input.to === 'failed' ? (input.errorMessage ?? null) : null
							}
						: {})
				})
				.where(and(eq(LaunchTable.id, input.id), eq(LaunchTable.state, input.from)))
				.returning()
				.then((rows) => (rows.at(0) ? serialize(rows[0]!) : null))
		);
	}

	export async function markStop(id: string) {
		return Database.use((tx) =>
			tx
				.update(LaunchTable)
				.set({ timeStopRequested: sql`coalesce(${LaunchTable.timeStopRequested}, now())` })
				.where(and(eq(LaunchTable.id, id), inArray(LaunchTable.state, [...OPEN])))
				.returning()
				.then((rows) => (rows.at(0) ? serialize(rows[0]!) : null))
		);
	}

	/**
	 * A launch to start in a box that is already running. The run's first
	 * launch is never one of these: the host starts it with the box.
	 */
	export const StartJob = z
		.object({
			kind: z
				.literal('launch.start')
				.meta({ description: 'What the agent is being asked to do', example: 'launch.start' }),
			sessionId: z
				.string()
				.meta({ description: 'The run the box is in', example: Examples.Session.id }),
			launchId: z.string().meta({
				description:
					'The launch to start. Report against it, and give it to the launched process as `NESTRI_LAUNCH_ID`',
				example: Examples.Launch.id
			}),
			boxId: z
				.string()
				.meta({ description: 'The running box to start it in', example: Examples.Session.boxId }),
			gameId: z
				.string()
				.meta({ description: 'The game to launch', example: Examples.Session.gameId }),
			steamAppId: z.number().int().meta({
				description: 'The same game, in the id the store knows it by',
				example: Examples.Game.steamAppId
			}),
			linkedAccountId: z.string().meta({
				description: 'Which linked account is playing',
				example: Examples.Session.linkedAccountId
			}),
			userId: z.string().meta({ description: 'Whose run it is', example: Examples.User.id })
		})
		.meta({
			ref: 'LaunchStartJob',
			description:
				'One launch to add to a running box. Handed out on every poll until the host reports the launch `running`, `ended` or `failed`'
		});

	/** A launch its owner asked to end, repeated until the host reports it over. */
	export const StopJob = z
		.object({
			kind: z
				.literal('launch.stop')
				.meta({ description: 'What the agent is being asked to do', example: 'launch.stop' }),
			sessionId: z
				.string()
				.meta({ description: 'The run the box is in', example: Examples.Session.id }),
			launchId: z.string().meta({ description: 'The launch to end', example: Examples.Launch.id }),
			boxId: z.string().meta({ description: 'The box it runs in', example: Examples.Session.boxId })
		})
		.meta({
			ref: 'LaunchStopJob',
			description:
				'One launch to end now, because its owner closed it. Handed out on every poll until the host reports it `ended` or `failed`, including for a launch the host never started'
		});

	type StartJob = z.infer<typeof StartJob>;
	type StopJob = z.infer<typeof StopJob>;

	export async function jobsForMachine(
		machineId: string
	): Promise<{ stops: StopJob[]; starts: StartJob[] }> {
		const onHost = and(
			eq(BoxTable.machineId, machineId),
			isNull(LaunchTable.timeDeleted),
			isNull(SessionTable.timeDeleted),
			isNull(BoxTable.timeDeleted)
		);
		const stops = await Database.use((tx) =>
			tx
				.select({ sessionId: SessionTable.id, launchId: LaunchTable.id, boxId: BoxTable.id })
				.from(LaunchTable)
				.innerJoin(SessionTable, eq(LaunchTable.sessionId, SessionTable.id))
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.where(
					and(
						onHost,
						inArray(SessionTable.state, ['starting', 'live']),
						inArray(LaunchTable.state, [...OPEN]),
						isNotNull(LaunchTable.timeStopRequested)
					)
				)
				.orderBy(LaunchTable.timeStopRequested)
				.then((rows) => rows.map((r): StopJob => ({ kind: 'launch.stop', ...r })))
		);
		const starts = await Database.use((tx) =>
			tx
				.select({ launch: LaunchTable, session: SessionTable, box: BoxTable, game: GameTable })
				.from(LaunchTable)
				.innerJoin(SessionTable, eq(LaunchTable.sessionId, SessionTable.id))
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.innerJoin(GameTable, eq(LaunchTable.gameId, GameTable.id))
				.where(
					and(
						onHost,
						// Only into a box that is up, and not one being stopped.
						eq(SessionTable.state, 'live'),
						isNull(SessionTable.timeStopRequested),
						eq(LaunchTable.state, 'requested'),
						eq(LaunchTable.first, false),
						isNull(LaunchTable.timeStopRequested)
					)
				)
				.orderBy(LaunchTable.timeCreated)
				.then((rows) =>
					rows.map(
						(r): StartJob => ({
							kind: 'launch.start',
							sessionId: r.session.id,
							launchId: r.launch.id,
							boxId: r.box.id,
							gameId: r.game.id,
							steamAppId: r.game.steamAppId,
							linkedAccountId: r.session.linkedAccountId,
							userId: r.box.userId
						})
					)
				)
		);
		return { stops, starts };
	}
}
