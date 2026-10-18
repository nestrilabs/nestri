import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Burn } from '../billing/burn.js';
import { Billing } from '../billing/index.js';
import { BoxTable, BoxTier } from '../box/box.sql.js';
import { Box } from '../box/index.js';
import { Database } from '../db/index.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { GameTable } from '../game/game.sql.js';
import { Identifier } from '../id.js';
import { MachineTable } from '../machine/machine.sql.js';
import { Trial } from '../trial/index.js';
import { Launch } from './launch.js';
import { LaunchTable } from './launch.sql.js';
import { SessionState, SessionTable } from './session.sql.js';
import { JobWake } from './wake.js';

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
	/**
	 * One wording for "that box is busy", however it was discovered.
	 *
	 * Both the read in {@link activeForBox} and the unique index behind
	 * {@link request} report it, and a caller must not be able to tell which,
	 * because that would only tell it how close the race was.
	 */
	export const BOX_BUSY = 'That box already has a run that has not stopped';

	/**
	 * A run waiting for a slot on its host.
	 *
	 * Runs on Nestri GPUs that are paid for go ahead of free-weekend runs, and
	 * within each, first come first served. That reorders a free player, so it
	 * is said rather than done quietly: `paidFirst` is true when a paid run that
	 * asked after this one is ahead of it.
	 */
	export const Queue = z.object({
		position: z.number().int().min(1).meta({ description: 'Place in line, 1 is next', example: 3 }),
		paidFirst: z.boolean().meta({
			description: 'Whether a paid run that asked later has gone ahead of this one',
			example: false
		})
	});

	/**
	 * A waiting run nobody has asked after for this long has been abandoned —
	 * the app was closed — and leaves the line. A client polls every few
	 * seconds while it waits, so a minute is many missed polls, not one.
	 */
	export const ABANDONED_AFTER_SECONDS = 60;

	/**
	 * Why a run is over.
	 *
	 * `ended` and `failed` say how a run finished, not why, and a stop its
	 * owner asked for, a free weekend running out and a game quitting on its
	 * own all read `ended` without this. Whoever ends the run writes it: the
	 * control plane for the two endings it decides itself, `user` on a run
	 * nobody had claimed and `left_queue`, and the host agent for everything
	 * else, in its terminal report. ref(d-0083)
	 */
	export const EndReason = z
		.enum([
			'user',
			'window',
			'hours',
			'idle',
			'left_queue',
			'game_exited',
			'launch_failed',
			'host_stopped',
			'host_restart'
		])
		.meta({
			description:
				'Why a run is over. `user`: its owner asked. `window`: the free weekend closed. `hours`: this weekend’s free hours are used. `idle`: nobody was connected to it. `left_queue`: it waited for a slot and nobody asked after it. `game_exited`: the game quit on its own. `launch_failed`: it never got as far as playing. `host_stopped`: its host ended it for a reason of its own. `host_restart`: its host restarted and the run did not survive it',
			example: 'user'
		});

	export type EndReason = z.infer<typeof EndReason>;

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
				description:
					'Current connect ticket. Null before one has been minted, and null again once the run has stopped — a run that is not there has no address',
				example: Examples.Session.ticket
			}),
			tier: z.enum(BoxTier.enumValues).nullable().optional().meta({
				description: 'The size this run was asked for. Null runs at the size of its box',
				example: 'md'
			}),
			timeClaimed: z.string().nullable().optional().meta({
				description:
					'When its host took the run on. Null while it waits for one, and for a run that never had one',
				example: Examples.Session.timeClaimed
			}),
			timeStarted: z.string().nullable().optional().meta({
				description: 'When the box actually started, not when the row appeared',
				example: Examples.Session.timeStarted
			}),
			timeStopped: z.string().nullable().optional().meta({
				description: 'When this run ended',
				example: Examples.Session.timeStopped
			}),
			timeStopRequested: z.string().nullable().optional().meta({
				description:
					'When the owner asked for this run to end. The run stays `live` until its host has stopped it',
				example: null
			}),
			trial: z.boolean().optional().meta({
				description:
					'Whether this run is on Nestri GPUs under the free weekend rather than a plan. A trial run is stopped when its hours or its window run out',
				example: false
			}),
			errorMessage: z.string().nullable().optional().meta({
				description: 'Why it failed, when it did',
				example: Examples.Session.errorMessage
			}),
			endReason: EndReason.nullable().optional().meta({
				description:
					'Why this run is over, once it is. Null while it runs, and for a run whose host did not say',
				example: Examples.Session.endReason
			}),
			launches: Launch.Info.array().optional().meta({
				description:
					'What runs in the box, oldest first: the first is the launch the run was asked for with. The run is stopped when the last of them is over'
			}),
			queue: Queue.nullable().optional().meta({
				description:
					'Where this run is in line for its host, while every slot there is taken. Null once it is not waiting'
			})
		})
		.meta({
			ref: 'Session',
			description: 'One live run of one box by one Steam account, and the billing unit',
			example: Examples.Session
		});

	export type Info = z.infer<typeof Info>;

	export const create = fn(
		Info.pick({ id: true, boxId: true, gameId: true, linkedAccountId: true, tier: true }).extend({
			trial: z.boolean().optional()
		}),
		async (input) => {
			// The run and its first launch are one write: a run with nothing to
			// launch in it would never be stopped by its last launch ending.
			// ref(d-0085)
			return Database.transaction(async (tx) => {
				const session = await tx
					.insert(SessionTable)
					.values({
						id: input.id,
						boxId: input.boxId,
						gameId: input.gameId,
						linkedAccountId: input.linkedAccountId,
						tier: input.tier ?? null,
						trial: input.trial ?? false
					})
					.returning()
					.then((rows) => serialize(rows[0]!));
				const first = await Launch.insert({
					id: Identifier.ascending('launch'),
					sessionId: session.id,
					gameId: session.gameId,
					first: true
				});
				// A run waiting is work for its host. After the commit, so the
				// host's next look finds the row.
				await Database.effect(() => JobWake.wakeBox(input.boxId));
				return { ...session, launches: [first] };
			});
		}
	);

	/** Postgres refusing a second row for the same key. */
	function isUniqueViolation(err: unknown): boolean {
		const e = err as { code?: string; cause?: { code?: string } };
		return e?.code === '23505' || e?.cause?.code === '23505';
	}

	/**
	 * Ask for a run of a box, and let the database refuse a second one.
	 *
	 * The same argument as {@link compareAndSetState}, one step earlier. A
	 * caller reading {@link activeForBox} first and the insert being refused
	 * are different properties: the read is a nicer error message, the unique
	 * index is the invariant. Two requests that both read "nothing is running"
	 * before either inserts each get a row, and the host is then handed the
	 * same box to start twice — which is exactly what the state claim exists
	 * to prevent.
	 *
	 * The refusal is the same 409 a caller gets from the read, and worded
	 * identically, because from outside they are the same fact and which one
	 * answered is a timing detail.
	 */
	export const request = fn(
		Info.pick({ id: true, boxId: true, gameId: true, linkedAccountId: true, tier: true }).extend({
			trial: z.boolean().optional()
		}),
		async (input) => {
			try {
				return await create(input);
			} catch (err) {
				if (isUniqueViolation(err)) {
					throw new VisibleError('already_exists', ErrorCodes.Validation.INVALID_STATE, BOX_BUSY);
				}
				throw err;
			}
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
	 * At most one row can match: `session_box_active_unique` is a unique index
	 * on this exact predicate, so "newest first, limited to one" describes the
	 * query and not a choice being made. Reading this before inserting gives a
	 * caller a better message than a constraint violation; it is not what makes
	 * the answer single. See {@link request}.
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
	 * billed for, and metering can trust the pair. A reason is kept only for a
	 * run that is over, as an error message is kept only for one that failed.
	 */
	export const setState = fn(
		Info.pick({ id: true, state: true, errorMessage: true, endReason: true }),
		async (input) => {
			const now = sql`now()`;
			return Database.use(async (tx) => {
				const row = await tx
					.update(SessionTable)
					.set({
						state: input.state,
						errorMessage: input.state === 'failed' ? (input.errorMessage ?? null) : null,
						endReason:
							input.state === 'ended' || input.state === 'failed'
								? (input.endReason ?? null)
								: null,
						...(input.state === 'live'
							? { timeStarted: sql`coalesce(${SessionTable.timeStarted}, ${now})` }
							: {}),
						...(input.state === 'ended' || input.state === 'failed'
							? {
									timeStopped: sql`coalesce(${SessionTable.timeStopped}, ${now})`,
									// A stopped run has no address, whichever writer
									// stopped it.
									ticket: null
								}
							: {})
					})
					.where(and(eq(SessionTable.id, input.id), isNull(SessionTable.timeDeleted)))
					.returning()
					.then((rows) => {
						const row = rows.at(0);
						return row ? serialize(row) : null;
					});
				if (row) await launchesFollow(row);
				return row;
			});
		}
	);

	/**
	 * What a run's state means for the launches in it: the first is running
	 * once the box is live, and none outlives the run. ref(d-0085)
	 */
	async function launchesFollow(run: Info) {
		if (run.state === 'live') await Launch.firstStarted(run.id);
		if (run.state === 'ended' || run.state === 'failed') {
			await Launch.endAllOf([run.id], run.endReason ?? null);
		}
	}

	/**
	 * The states an agent is allowed to move a run into.
	 *
	 * `requested` is missing on purpose: it is written once, when the row is
	 * created, and nothing may put a run back there.
	 */
	/**
	 * The holder of a claim, as the agent minted it.
	 *
	 * Opaque here on purpose: this end never generates one, never parses one
	 * and never shows one to anybody. The only property it needs is that two
	 * attempts cannot present the same value, and no length check can prove
	 * that — the floor exists to refuse something obviously degenerate, not to
	 * measure entropy. 22 characters is 128 bits at the tightest encoding
	 * anyone would reasonably use.
	 */
	export const ClaimToken = z.string().min(22).max(255);

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
	 *
	 * `starting → ended` is a run stopped before it went live — the person
	 * stopping it while its game downloads, say. Nothing failed, so `failed`
	 * would be a lie, and it never reached `live`, so it was never billed.
	 */
	export const NEXT_STATES: Record<Info['state'], readonly Info['state'][]> = {
		requested: ['starting'],
		starting: ['live', 'ended', 'failed'],
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
	export const StartJob = z
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
			}),
			userId: z.string().meta({
				description: 'Whose run it is: the box owner, whose Steam sign-in on this host plays it',
				example: Examples.User.id
			}),
			launchId: z.string().nullable().meta({
				description:
					'The run’s first launch: the game above. Report its exit against it, and give it to the launched process as `NESTRI_LAUNCH_ID`. Null only for a run older than launches',
				example: Examples.Launch.id
			})
		})
		.meta({
			ref: 'SessionJob',
			description: 'One run waiting to be started, as handed to the agent that will start it'
		});

	/**
	 * A run the agent must end now, because its owner asked or the terms it
	 * started under have run out. The agent ends it as it would end any run and reports `ended`;
	 * the job repeats on every poll until it does.
	 */
	export const StopJob = z
		.object({
			kind: z.literal('session.stop').meta({
				description: 'What the agent is being asked to do',
				example: 'session.stop'
			}),
			sessionId: z.string().meta({
				description: 'The run to end',
				example: Examples.Session.id
			}),
			boxId: z.string().meta({
				description: 'The box it runs in',
				example: Examples.Session.boxId
			}),
			reason: z.enum(['user', 'window', 'hours']).meta({
				description:
					'`user`: its owner asked. `window`: the free weekend closed. `hours`: this weekend’s free hours are used',
				example: 'hours'
			})
		})
		.meta({
			ref: 'SessionStopJob',
			description: 'One run to end now, as handed to the agent running it'
		});

	export const Job = z.discriminatedUnion('kind', [
		StartJob,
		StopJob,
		Launch.StartJob,
		Launch.StopJob
	]);

	export type Job = z.infer<typeof Job>;

	/**
	 * The work waiting for one host.
	 *
	 * The scope is the join and not a filter the caller asks for: a box names
	 * the hardware it is placed on, a run reaches its hardware through its box,
	 * and so what one set of long-lived credentials can see is decided by this
	 * `where` clause rather than by whoever is holding them.
	 */
	export const listJobsForMachine = fn(z.string(), async (machineId): Promise<Job[]> => {
		const asked = await Database.use((tx) =>
			tx
				.select({ sessionId: SessionTable.id, boxId: BoxTable.id })
				.from(SessionTable)
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.where(
					and(
						eq(BoxTable.machineId, machineId),
						inArray(SessionTable.state, ['starting', 'live']),
						isNotNull(SessionTable.timeStopRequested),
						isNull(SessionTable.timeDeleted),
						isNull(BoxTable.timeDeleted)
					)
				)
				.orderBy(SessionTable.timeStopRequested)
		);
		// One stop per run: when the owner asked and the trial also ran out,
		// the owner's reason is the one the run ended for.
		const seen = new Set(asked.map((r) => r.sessionId));
		const stops: Job[] = [
			...asked.map((run): Job => ({ kind: 'session.stop', ...run, reason: 'user' })),
			...(await Trial.overdue(machineId))
				.filter((run) => !seen.has(run.sessionId))
				.map((run): Job => ({ kind: 'session.stop', ...run }))
		];
		await leaveAbandoned(machineId);
		const free = await freeSlots(machineId);
		const starts = await Database.use(async (tx) => {
			return (
				tx
					.select({
						session: SessionTable,
						box: BoxTable,
						game: GameTable,
						launchId: LaunchTable.id
					})
					.from(SessionTable)
					.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
					.innerJoin(GameTable, eq(SessionTable.gameId, GameTable.id))
					.leftJoin(
						LaunchTable,
						and(eq(LaunchTable.sessionId, SessionTable.id), eq(LaunchTable.first, true))
					)
					.where(
						and(
							eq(BoxTable.machineId, machineId),
							eq(SessionTable.state, 'requested'),
							isNull(SessionTable.timeDeleted),
							isNull(BoxTable.timeDeleted)
						)
					)
					// Paid ahead of free, then first come first served. See {@link Queue}.
					.orderBy(SessionTable.trial, SessionTable.timeCreated)
					.limit(free)
					.then((rows) =>
						rows.map(
							(row): Job => ({
								kind: 'session.start',
								sessionId: row.session.id,
								boxId: row.box.id,
								// The run's own size when it was given one.
								boxTier: (row.session.tier ?? row.box.tier) as z.infer<typeof StartJob>['boxTier'],
								gameId: row.game.id,
								steamAppId: row.game.steamAppId,
								linkedAccountId: row.session.linkedAccountId,
								userId: row.box.userId,
								launchId: row.launchId
							})
						)
					)
			);
		});
		// Launch work after run work: ending a run ends its launches, and a
		// launch is only added to a box that is already up. ref(d-0085)
		const launches = await Launch.jobsForMachine(machineId);
		return [...stops, ...launches.stops, ...starts, ...launches.starts];
	});

	/**
	 * {@link listJobsForMachine}, held open when there is nothing.
	 *
	 * Answers at once when there is work. Otherwise waits for a wake (see
	 * {@link JobWake}) for up to `waitMs`, looking again on every wake and every
	 * {@link JobWake.RECHECK_MS}, and answers empty at the deadline. The wake
	 * is listened for before each look, so one that lands between the look and
	 * the wait is not lost. `signal` ends the wait early, when the host has
	 * hung up. No database connection is held while waiting.
	 */
	export async function holdJobsForMachine(
		machineId: string,
		options: { waitMs: number; signal?: AbortSignal }
	): Promise<Job[]> {
		const deadline = Date.now() + options.waitMs;
		for (;;) {
			const listener = JobWake.listen(machineId);
			try {
				const jobs = await listJobsForMachine(machineId);
				const remaining = deadline - Date.now();
				if (jobs.length > 0 || remaining <= 0 || options.signal?.aborted) return jobs;
				await listener.until(Math.min(remaining, JobWake.RECHECK_MS), options.signal);
			} finally {
				listener.cancel();
			}
		}
	}

	/** The runs a host is holding: claimed and not yet over. */
	const holding = (machineId: string) =>
		Database.use((tx) =>
			tx
				.select({ n: count() })
				.from(SessionTable)
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.where(
					and(
						eq(BoxTable.machineId, machineId),
						inArray(SessionTable.state, ['starting', 'live']),
						isNull(SessionTable.timeStopped),
						isNull(SessionTable.timeDeleted)
					)
				)
				.then((rows) => rows[0]?.n ?? 0)
		);

	/**
	 * How many waiting runs a host may be handed now.
	 *
	 * Its own count of slots, less what it already holds. A host that has not
	 * said how many it holds is handed every waiting run, as before there was a
	 * line; a run it cannot hold fails there, which is what it did then.
	 */
	export const freeSlots = fn(z.string(), async (machineId) => {
		const slots = await Database.use((tx) =>
			tx
				.select({ slots: MachineTable.slots })
				.from(MachineTable)
				.where(eq(MachineTable.id, machineId))
				.then((rows) => rows[0]?.slots ?? null)
		);
		if (slots === null) return 1000;
		return Math.max(0, slots - (await holding(machineId)));
	});

	/**
	 * End the waiting runs on a host that nobody has asked after. See
	 * {@link ABANDONED_AFTER_SECONDS}. Only waiting runs: a run that has a slot
	 * is ended by its host, never from here.
	 */
	export const leaveAbandoned = fn(z.string(), async (machineId) => {
		const left = await Database.use((tx) =>
			tx
				.update(SessionTable)
				.set({
					state: 'ended',
					timeStopped: sql`now()`,
					errorMessage: 'Left the queue',
					endReason: 'left_queue' satisfies EndReason
				})
				.where(
					and(
						eq(SessionTable.state, 'requested'),
						isNull(SessionTable.timeDeleted),
						inArray(
							SessionTable.boxId,
							tx.select({ id: BoxTable.id }).from(BoxTable).where(eq(BoxTable.machineId, machineId))
						),
						sql`coalesce(${SessionTable.timeSeen}, ${SessionTable.timeCreated}) < now() - make_interval(secs => ${ABANDONED_AFTER_SECONDS})`
					)
				)
				.returning({ id: SessionTable.id })
		);
		await Launch.endAllOf(
			left.map((r) => r.id),
			'left_queue'
		);
	});

	/**
	 * Where a waiting run is in line, or null when it is not waiting.
	 *
	 * Ahead of it: every waiting run on the same host that the host would be
	 * handed first — paid before free, then older first. Reading it also marks
	 * the run as asked after, which is what keeps it in line.
	 */
	export const queueFor = fn(z.string(), async (id): Promise<z.infer<typeof Queue> | null> => {
		return Database.use(async (tx) => {
			const mine = await tx
				.update(SessionTable)
				.set({ timeSeen: sql`now()` })
				.where(and(eq(SessionTable.id, id), eq(SessionTable.state, 'requested')))
				.returning()
				.then((rows) => rows.at(0));
			if (!mine) return null;
			const machine = await tx
				.select({ machineId: BoxTable.machineId })
				.from(BoxTable)
				.where(eq(BoxTable.id, mine.boxId))
				.then((rows) => rows[0]!.machineId);
			const waiting = await tx
				.select({ trial: SessionTable.trial, timeCreated: SessionTable.timeCreated })
				.from(SessionTable)
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.where(
					and(
						eq(BoxTable.machineId, machine),
						eq(SessionTable.state, 'requested'),
						isNull(SessionTable.timeDeleted),
						isNull(BoxTable.timeDeleted)
					)
				);
			const before = (r: { trial: boolean; timeCreated: Date }) =>
				r.trial !== mine.trial ? !r.trial : r.timeCreated < mine.timeCreated;
			return {
				position: waiting.filter(before).length + 1,
				paidFirst: mine.trial && waiting.some((r) => !r.trial && r.timeCreated > mine.timeCreated)
			};
		});
	});

	/**
	 * The same run as {@link forMachine}, as the row rather than as the shape
	 * that goes out.
	 *
	 * The claim holder is not in {@link Info} and must not be: `serialize` is
	 * what every caller of this resource is answered with, a token in it would
	 * reach the person's own `GET /session/:id`, and holding one permits
	 * writing to a run. So the two callers that compare a holder read the row,
	 * and nothing that leaves this file ever carries the column.
	 */
	const rowForMachine = async (id: string, machineId: string) => {
		return Database.use(async (tx) => {
			return tx
				.select({ session: SessionTable })
				.from(SessionTable)
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.where(
					and(
						eq(SessionTable.id, id),
						eq(BoxTable.machineId, machineId),
						isNull(SessionTable.timeDeleted),
						isNull(BoxTable.timeDeleted)
					)
				)
				.then((rows) => rows.at(0)?.session ?? null);
		});
	};

	/** One run, visible only to the host its box is placed on. */
	export const forMachine = fn(
		z.object({ id: Info.shape.id, machineId: z.string() }),
		async (input) => {
			const row = await rowForMachine(input.id, input.machineId);
			return row ? serialize(row) : null;
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

	/**
	 * The runs of someone's boxes that have not stopped, newest first.
	 *
	 * At most one per box, by the same index {@link activeForBox} leans on. A
	 * client reads this to tell "your box is busy" apart from "your box is
	 * busy with the game you just asked for", which it can rejoin rather than
	 * stop.
	 */
	export const activeForOwner = fn(z.string(), async (userId) => {
		return Database.use(async (tx) => {
			return tx
				.select({ session: SessionTable })
				.from(SessionTable)
				.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
				.where(
					and(
						eq(BoxTable.userId, userId),
						isNull(SessionTable.timeDeleted),
						isNull(SessionTable.timeStopped),
						isNull(BoxTable.timeDeleted)
					)
				)
				.orderBy(desc(SessionTable.timeCreated))
				.then((rows) => rows.map((row) => serialize(row.session)));
		});
	});

	/**
	 * The owner asks for a run to end.
	 *
	 * A run nobody has claimed yet ends here and now: no host holds it, so
	 * there is nothing to stop and it never cost anything. One a host holds is
	 * only marked, and the host is handed a stop on its next poll; it stays
	 * `starting` or `live` until the host reports it ended, because only the
	 * host knows when the box is gone. Asking twice is the same request, and
	 * asking of a run already over changes nothing.
	 *
	 * Null when the run is not there or not this person's.
	 */
	export const requestStop = fn(
		z.object({ id: Info.shape.id, userId: z.string() }),
		async (input) => {
			return stopRun(input.id, input.userId);
		}
	);

	/**
	 * The one way a run is asked to end, whoever asks: its owner, or the last
	 * of its launches being over. Scoped to an owner when one is given.
	 */
	async function stopRun(id: string, userId: string | null) {
		return Database.transaction(async (tx) => {
			const mine = tx
				.select({ id: BoxTable.id })
				.from(BoxTable)
				.where(
					and(
						userId === null ? undefined : eq(BoxTable.userId, userId),
						isNull(BoxTable.timeDeleted)
					)
				);
			const scope = and(
				eq(SessionTable.id, id),
				inArray(SessionTable.boxId, mine),
				isNull(SessionTable.timeDeleted)
			);
			// Unclaimed: the state is in the `where`, so a host claiming it at
			// the same moment wins or loses cleanly, never both.
			const [cancelled] = await tx
				.update(SessionTable)
				.set({
					state: 'ended',
					timeStopRequested: sql`now()`,
					timeStopped: sql`now()`,
					endReason: 'user' satisfies EndReason
				})
				.where(and(scope, eq(SessionTable.state, 'requested')))
				.returning();
			if (cancelled) {
				await Launch.endAllOf([cancelled.id], 'user');
				return serialize(cancelled);
			}
			const [marked] = await tx
				.update(SessionTable)
				.set({ timeStopRequested: sql`coalesce(${SessionTable.timeStopRequested}, now())` })
				.where(and(scope, inArray(SessionTable.state, ['starting', 'live'])))
				.returning();
			if (marked) {
				await Database.effect(() => JobWake.wakeBox(marked.boxId));
				return serialize(marked);
			}
			const [over] = await tx.select().from(SessionTable).where(scope);
			return over ? serialize(over) : null;
		});
	}

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
			claimToken: ClaimToken,
			errorMessage: Info.shape.errorMessage,
			endReason: Info.shape.endReason
		}),
		async (input) => {
			const now = sql`now()`;
			// The claim is the one transition that takes the holder rather than
			// presenting it, and it is exactly this pair — derived rather than
			// passed, because a flag that can disagree with the states either
			// side of it is a flag that eventually will.
			const isClaim = input.from === 'requested' && input.to === 'starting';
			return Database.use(async (tx) => {
				return tx
					.update(SessionTable)
					.set({
						state: input.to,
						// Taken on the claim and never written again: a terminal row
						// still records which attempt ran it, and a holder that goes
						// back to null lets a settled claim be replayed. The time is
						// taken with it, so a run's bring-up can be measured from
						// the moment a host had it rather than from when it asked.
						...(isClaim ? { claimToken: input.claimToken, timeClaimed: now } : {}),
						errorMessage: input.to === 'failed' ? (input.errorMessage ?? null) : null,
						// Only a run that is over has a reason to be over. Null when
						// the report carries none, which is every report from a
						// host agent that predates the field.
						endReason:
							input.to === 'ended' || input.to === 'failed' ? (input.endReason ?? null) : null,
						...(input.to === 'live'
							? { timeStarted: sql`coalesce(${SessionTable.timeStarted}, ${now})` }
							: {}),
						...(input.to === 'ended' || input.to === 'failed'
							? {
									timeStopped: sql`coalesce(${SessionTable.timeStopped}, ${now})`,
									// A stopped run has no address. Publishing one is
									// already refused, so keeping the last one would
									// leave the only readable ticket for a dead run
									// being the one nothing may replace — and a client
									// that polls would dial it.
									ticket: null
								}
							: {})
					})
					.where(
						and(
							eq(SessionTable.id, input.id),
							eq(SessionTable.state, input.from),
							// The holder is in the write and not only in the read
							// above it. Taking a claim requires there to be none;
							// everything after requires this caller to hold it. Two
							// agents that both read an unheld row still leave here
							// with one winner, because the second one's `where` no
							// longer matches.
							isClaim
								? isNull(SessionTable.claimToken)
								: eq(SessionTable.claimToken, input.claimToken),
							isNull(SessionTable.timeDeleted),
							inArray(SessionTable.boxId, boxesOn(tx, input.machineId))
						)
					)
					.returning()
					.then(async (rows) => {
						const row = rows.at(0);
						// A run that is over frees a slot, and a run waiting for
						// one is work the host can now be handed.
						if (row && (input.to === 'ended' || input.to === 'failed')) {
							await Database.effect(() => JobWake.wakeBox(row.boxId));
						}
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
	 * - `notHolder` — a report from an attempt that does not hold this run,
	 *   which is also what a second attempt to claim one looks like: taking
	 *   the claim and leaving `requested` are a single write, so by the time
	 *   a rival arrives the run is `starting` and held, and there is no
	 *   separate answer to give it. Distinct from `lost` because only one of
	 *   them is a race — this one is decided by the request, and is the answer
	 *   whatever state the run is in, including the state being reported.
	 * - `lost` — a legal transition that something else got to first.
	 * - `moved` — it happened.
	 */
	export type TransitionOutcome =
		| 'forbidden'
		| 'unchanged'
		| 'illegal'
		| 'notHolder'
		| 'lost'
		| 'moved';

	export interface TransitionResult {
		outcome: TransitionOutcome;
		session: Info | null;
	}

	/**
	 * What a run reaching a state means for the box underneath it.
	 *
	 * The box has its own three states and nothing was writing them, so a box
	 * read `created` while a run on it was `live` — the screens that show a
	 * person what their hardware is doing would all have been wrong. The two
	 * state machines are not the same shape and should not be: a box has no
	 * `starting`, deliberately, because that transition is synchronous from
	 * the agent's side and a state nobody sets is a state that lies. So only
	 * the states that mean something to the box are mapped, and `requested`
	 * and `starting` map to nothing at all.
	 *
	 * `failed` is a `stopped` box that did not stop cleanly, which is the
	 * distinction `stopClean` exists for: "it is not running" and "it faulted"
	 * are different facts and the difference lives in the reason.
	 */
	function boxStateFor(
		run: Info
	): { state: 'running' | 'stopped'; stopReason: string | null; stopClean: boolean | null } | null {
		switch (run.state) {
			case 'live':
				return { state: 'running', stopReason: null, stopClean: null };
			case 'ended':
				return { state: 'stopped', stopReason: null, stopClean: true };
			case 'failed':
				// The run's own reason, so a box explains its stop in the words
				// the agent used rather than in a second wording of one event.
				return { state: 'stopped', stopReason: run.errorMessage ?? null, stopClean: false };
			default:
				return null;
		}
	}

	export const transition = fn(
		z.object({
			id: Info.shape.id,
			machineId: z.string(),
			state: z.enum(SessionState.enumValues),
			claimToken: ClaimToken,
			errorMessage: Info.shape.errorMessage,
			endReason: Info.shape.endReason
		}),
		async (input): Promise<TransitionResult> => {
			// One transaction, because "this run is live" and "the box under it
			// is running" are one fact written to two tables. Committing the
			// first without the second is how a box gets stuck `running` with
			// nothing running on it, and nothing here would ever correct it.
			return Database.transaction(async (): Promise<TransitionResult> => {
				const row = await rowForMachine(input.id, input.machineId);
				if (!row) return { outcome: 'forbidden', session: null };
				const current = serialize(row);

				const isClaim = current.state === 'requested' && input.state === 'starting';
				if (isClaim) {
					// A `requested` run has no holder, because the two are written
					// together — so this is an invariant guard and not a case the
					// endpoint can produce. A rival never sees `requested`; it sees
					// `starting` and is answered below.
					if (row.claimToken !== null) return { outcome: 'notHolder', session: current };
				} else {
					const same = current.state === input.state;
					// Legality first, because it is a property of the run and not
					// of the caller: `requested → live` is the same mistake whoever
					// makes it, and answering it with the holder would hide from an
					// agent that it skipped the claim entirely.
					if (!same && !NEXT_STATES[current.state].includes(input.state)) {
						return { outcome: 'illegal', session: current };
					}
					// Then the holder, and it comes before `unchanged` — that order
					// is the whole point of the column. The same state reported by a
					// different attempt is a lost race, not a retry, and nothing
					// else in the request can tell those two apart.
					if (row.claimToken !== input.claimToken) {
						return { outcome: 'notHolder', session: current };
					}
					if (same) return { outcome: 'unchanged', session: current };
				}

				const moved = await compareAndSetState({
					id: input.id,
					machineId: input.machineId,
					from: current.state,
					to: input.state,
					claimToken: input.claimToken,
					errorMessage: input.errorMessage,
					endReason: input.endReason
				});
				// The state read above is not the state written below, and the
				// gap is where two agents race. Nothing moved means somebody
				// else did — and then the box is that caller's to update, not
				// this one's.
				if (!moved) return { outcome: 'lost', session: current };

				const box = boxStateFor(moved);
				if (box) {
					await Box.setState({ id: moved.boxId, ...box });
				}
				await launchesFollow(moved);

				// Burn follows the run's state, in the same transaction that
				// moved it. A session that went live without its meter starting
				// is free hardware; one that ended without its meter stopping
				// bills forever. Both are silent, so neither may be a second
				// write that might not happen.
				//
				// `live` is where it starts rather than `starting`, because what
				// is billed is an envelope actually held — a box that never
				// finished coming up held nothing.
				// Who pays is `Billing.teamForBox`'s answer and nobody else's: the
				// host's team on someone's own hardware, the box owner's personal
				// team on the fleet.
				// A trial run is counted by the trial, from the run's own times,
				// and not against the plan's allowance it is not drawing on.
				const payer = moved.trial ? null : await Billing.teamForBox(moved.boxId);
				if (payer) {
					if (current.state !== 'live' && moved.state === 'live') {
						// The rate is fixed here, from what this run actually is:
						// the size it holds, and whose card it holds it on. Both
						// are settled before the run starts, which is what lets a
						// person be told the cost before committing to it.
						await Burn.start({
							teamId: payer.teamId,
							sessionId: moved.id,
							tier: moved.tier ?? payer.tier,
							hostClass: payer.hostClass
						});
					} else if (
						ACCRUING.includes(current.state as (typeof ACCRUING)[number]) &&
						!ACCRUING.includes(moved.state as (typeof ACCRUING)[number])
					) {
						await Burn.stop({ teamId: payer.teamId, sessionId: moved.id });
					}
				}

				return { outcome: 'moved', session: moved };
			});
		}
	);

	export interface TicketResult {
		outcome: 'forbidden' | 'unclaimed' | 'notHolder' | 'closed' | 'published';
		session: Info | null;
	}

	/**
	 * The states a run can have an address in.
	 *
	 * `starting` is in and `requested` is out, which is the whole distinction:
	 * a ticket is the address of something being brought up, so publishing one
	 * means the host has taken the work. It cannot have an address for a run it
	 * has not claimed, and the terminal states are out because a run that is
	 * not there has no address at all.
	 */
	const ADDRESSABLE = ['starting', 'live'] as const;

	/**
	 * The states in which a run is spending.
	 *
	 * Only `live`. A run that is being brought up holds nothing yet, and the
	 * terminal states hold nothing any more — so this is a list of one, written
	 * as a list because the question it answers is "is this run costing
	 * anything?" and that will not always have one answer.
	 */
	const ACCRUING = ['live'] as const;

	/**
	 * Publish a ticket for a run, on behalf of the host it is placed on.
	 *
	 * A ticket may appear while the state is still `starting` — it is
	 * republished as addresses are discovered, so the client polls and re-reads
	 * rather than keeping the first one. Outside {@link ADDRESSABLE} it is
	 * refused, and the two refusals are separate answers because they are
	 * different mistakes: a run not yet claimed is an agent that skipped a
	 * step, and a run that stopped is one that has nothing left to reach.
	 *
	 * Held to the claim for a worse reason than the double start. A losing
	 * attempt that could publish here would overwrite the winner's address
	 * with its own; the client re-reads rather than caching, so it would take
	 * the new one and connect, successfully, to a box nobody is running. Two
	 * boxes started is waste, and it is visible. A working client pointed at
	 * the wrong machine looks exactly like everything having worked.
	 */
	export const publishTicket = fn(
		z.object({
			id: Info.shape.id,
			machineId: z.string(),
			claimToken: ClaimToken,
			ticket: z.string().min(1)
		}),
		async (input): Promise<TicketResult> => {
			const row = await rowForMachine(input.id, input.machineId);
			if (!row) return { outcome: 'forbidden', session: null };
			const current = serialize(row);
			// Before the holder, because a run nobody has claimed has no holder
			// to fail against and "claim it first" is the answer that helps.
			if (current.state === 'requested') return { outcome: 'unclaimed', session: current };
			if (row.claimToken !== input.claimToken) {
				return { outcome: 'notHolder', session: current };
			}

			return Database.use(async (tx) => {
				return tx
					.update(SessionTable)
					.set({ ticket: input.ticket })
					.where(
						and(
							eq(SessionTable.id, input.id),
							// The state and the holder are in the write and not only
							// in the checks above it, so a run that stops underneath
							// this call does not acquire an address on the way out,
							// and neither does one whose claim moved.
							inArray(SessionTable.state, [...ADDRESSABLE]),
							eq(SessionTable.claimToken, input.claimToken),
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

	/**
	 * The states a run takes another launch in: claimed by its host and not
	 * being stopped. A run still waiting for a host has its first launch and
	 * nothing more yet. ref(d-0085)
	 */
	const TAKES_LAUNCHES = ['starting', 'live'] as const;

	export type AddLaunchResult =
		| { outcome: 'notFound' }
		| { outcome: 'notRunning'; session: Info }
		| { outcome: 'hostTooOld' }
		| { outcome: 'created'; launch: Launch.Info }
		| { outcome: 'existing'; launch: Launch.Info };

	/**
	 * Add a launch to a run that is going. The library and account checks are
	 * the caller's, as they are for the run itself; billing is not asked again,
	 * because a launch is not a run and costs nothing of its own.
	 */
	export const addLaunch = fn(
		z.object({ sessionId: z.string(), userId: z.string(), gameId: z.string() }),
		async (input): Promise<AddLaunchResult> => {
			return Database.transaction(async (tx) => {
				// Locked, so a stop or an end racing this either lands first and
				// the launch is refused, or lands after and ends it with the run.
				const [row] = await tx
					.select({ session: SessionTable })
					.from(SessionTable)
					.innerJoin(BoxTable, eq(SessionTable.boxId, BoxTable.id))
					.where(
						and(
							eq(SessionTable.id, input.sessionId),
							eq(BoxTable.userId, input.userId),
							isNull(SessionTable.timeDeleted),
							isNull(BoxTable.timeDeleted)
						)
					)
					.for('update', { of: SessionTable });
				if (!row) return { outcome: 'notFound' };
				const run = row.session;
				if (
					!TAKES_LAUNCHES.includes(run.state as (typeof TAKES_LAUNCHES)[number]) ||
					run.timeStopped !== null ||
					run.timeStopRequested !== null
				) {
					return { outcome: 'notRunning', session: serialize(run) };
				}
				if (!(await Launch.hostTakesLaunches(run.id))) return { outcome: 'hostTooOld' };
				// The same game asked for twice (two windows, or a retry after a
				// lost reply) is one launch: under the run's lock the first add
				// has committed, so the second finds it and gets it back.
				const open = (await Launch.listForSession(run.id)).find(
					(l) =>
						l.gameId === input.gameId &&
						(Launch.OPEN as readonly string[]).includes(l.state) &&
						l.timeStopRequested === null
				);
				if (open) return { outcome: 'existing', launch: open };
				const launch = await Launch.insert({
					id: Identifier.ascending('launch'),
					sessionId: run.id,
					gameId: input.gameId,
					first: false
				});
				await Database.effect(() => JobWake.wakeBox(run.boxId));
				return { outcome: 'created', launch };
			});
		}
	);

	/**
	 * Stop the run when nothing is left running in it: the last window closed
	 * is the person saying they are done. The same stop its owner asks for.
	 * ref(d-0085)
	 */
	async function stopIfEmpty(sessionId: string) {
		// One transaction holding the run's row, the same lock `addLaunch`
		// takes: a launch added while this decides either lands first and is
		// seen as open, or waits and finds the run stopping.
		return Database.transaction(async (tx) => {
			await tx
				.select({ id: SessionTable.id })
				.from(SessionTable)
				.where(eq(SessionTable.id, sessionId))
				.for('update');
			if (await Launch.anyOpen(sessionId)) return false;
			await stopRun(sessionId, null);
			return true;
		});
	}

	/**
	 * The owner closes one launch. A launch in a run no host holds yet ends at
	 * once; otherwise it is marked, and the host is handed `launch.stop` until
	 * it reports the launch over. Null when the run or launch is not theirs.
	 */
	export const stopLaunch = fn(
		z.object({ sessionId: z.string(), launchId: z.string(), userId: z.string() }),
		async (input): Promise<Launch.Info | null | 'hostTooOld'> => {
			const run = await forOwner({ id: input.sessionId, userId: input.userId });
			if (!run) return null;
			const row = await Launch.row(run.id, input.launchId);
			if (!row) return null;
			if (!Launch.OPEN.includes(row.state as (typeof Launch.OPEN)[number])) {
				return Launch.serialize(row);
			}
			if (run.state === 'requested') {
				const ended = await Launch.compareAndSet({
					id: row.id,
					from: row.state as Launch.Info['state'],
					to: 'ended',
					endReason: 'user'
				});
				await stopIfEmpty(run.id);
				return ended ?? Launch.serialize((await Launch.row(run.id, row.id))!);
			}
			// A host that does not handle launches would never end this one.
			if (!(await Launch.hostTakesLaunches(run.id))) return 'hostTooOld';
			const marked = await Launch.markStop(row.id);
			if (marked) await JobWake.wakeBox(run.boxId);
			return marked ?? Launch.serialize((await Launch.row(run.id, row.id))!);
		}
	);

	export interface LaunchReportResult {
		outcome: Exclude<TransitionOutcome, never>;
		launch: Launch.Info | null;
	}

	/**
	 * The host reports where one launch has got to. Held to the run's claim, as
	 * every host report on a run is. When the report ends the last launch, the
	 * run is stopped. ref(d-0085)
	 */
	export const reportLaunch = fn(
		z.object({
			sessionId: z.string(),
			launchId: z.string(),
			machineId: z.string(),
			claimToken: ClaimToken,
			state: Launch.ReportableState,
			endReason: EndReason.nullable().optional(),
			errorMessage: z.string().nullable().optional()
		}),
		async (input): Promise<LaunchReportResult> => {
			const run = await rowForMachine(input.sessionId, input.machineId);
			if (!run) return { outcome: 'forbidden', launch: null };
			const row = await Launch.row(run.id, input.launchId);
			if (!row) return { outcome: 'forbidden', launch: null };
			const current = Launch.serialize(row);
			const same = current.state === input.state;
			if (!same && !Launch.NEXT_STATES[current.state].includes(input.state)) {
				return { outcome: 'illegal', launch: current };
			}
			if (run.claimToken === null || run.claimToken !== input.claimToken) {
				return { outcome: 'notHolder', launch: current };
			}
			if (same) return { outcome: 'unchanged', launch: current };
			const moved = await Launch.compareAndSet({
				id: row.id,
				from: current.state,
				to: input.state,
				endReason: input.endReason ?? null,
				errorMessage: input.errorMessage ?? null
			});
			if (!moved) return { outcome: 'lost', launch: current };
			if (moved.state === 'ended' || moved.state === 'failed') await stopIfEmpty(run.id);
			return { outcome: 'moved', launch: moved };
		}
	);

	export function serialize(input: typeof SessionTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			boxId: input.boxId,
			gameId: input.gameId,
			linkedAccountId: input.linkedAccountId,
			state: input.state as Info['state'],
			tier: input.tier as Info['tier'],
			ticket: input.ticket,
			timeClaimed: input.timeClaimed?.toISOString() ?? null,
			timeStarted: input.timeStarted?.toISOString() ?? null,
			timeStopped: input.timeStopped?.toISOString() ?? null,
			timeStopRequested: input.timeStopRequested?.toISOString() ?? null,
			trial: input.trial,
			errorMessage: input.errorMessage,
			endReason: input.endReason as Info['endReason']
		};
	}
}
