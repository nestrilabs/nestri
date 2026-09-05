import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { BoxState, BoxTable, BoxTier } from './box.sql.js';
import { Placement } from './placement.js';

/**
 * A VM someone owns.
 *
 * The box is the thing with a name and a URL; a session is one run of it, and
 * the session is what costs money. Keeping them apart is what lets a box be a
 * durable thing a person owns rather than a synonym for "currently playing".
 * ref(d-0010), ref(d-0019)
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
				description: 'What the box is doing, as last reported by its host',
				example: Examples.Box.state
			}),
			stopReason: z.string().nullable().optional().meta({
				description: 'Why it stopped, as reported by its host. Null if it never ran',
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

	/**
	 * Create a box and let something else decide where it runs.
	 *
	 * The placement seam is here, at creation, and nowhere else: `machineId` is
	 * set once and every later question about which hardware a box — or a run
	 * of it — belongs to is answered by joining through this row. A caller that
	 * knows the host still uses `create`; a caller acting for a person does not
	 * know and must not guess, which is what this overload is for.
	 */
	export const createPlaced = async (
		input: { id: string; userId: string; label: string; tier: Info['tier'] },
		placer?: Placement.Placer
	) => {
		const machineId = await Placement.choose({ userId: input.userId, tier: input.tier }, placer);
		return create({
			id: input.id,
			userId: input.userId,
			machineId,
			label: input.label,
			tier: input.tier
		});
	};

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
	 * Record what a box's host says it is doing.
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
			await tx
				.update(BoxTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(BoxTable.id, id));
		});
	});

	/**
	 * What a host says about one box, in the shape the wire carries.
	 *
	 * Flat rather than nested: the agent's own type is an internally-tagged
	 * enum, and flattening it here is what lets one box be one object on both
	 * sides. `pid` and `uptimeS` are accepted and deliberately not stored —
	 * a pid is a number in another machine's namespace and means nothing here,
	 * and uptime is derivable from the run's `timeStarted`, which is already
	 * kept and already trustworthy. Storing a plausible number instead of a
	 * measured one is how a scheduler learns to trust a field nobody produced.
	 */
	export const Reported = z.discriminatedUnion('state', [
		z.object({
			boxId: z.string(),
			tier: z.enum(BoxTier.enumValues),
			state: z.literal('created')
		}),
		z.object({
			boxId: z.string(),
			tier: z.enum(BoxTier.enumValues),
			state: z.literal('running'),
			pid: z.number().int().optional(),
			uptimeS: z.number().int()
		}),
		z.object({
			boxId: z.string(),
			tier: z.enum(BoxTier.enumValues),
			state: z.literal('stopped'),
			reason: z.string(),
			clean: z.boolean()
		})
	]);

	export type Reported = z.infer<typeof Reported>;

	/** What a snapshot changed, and what it disagreed with us about. */
	export const ReportOutcome = z.object({
		recorded: z.number().meta({ description: 'Boxes in the snapshot that we know and updated' }),
		unknown: z.array(z.string()).meta({
			description: 'Boxes the host is holding that are not placed here. Recorded, never created'
		}),
		markedStopped: z.array(z.string()).meta({
			description: 'Boxes placed here that the snapshot did not mention, and are now stopped'
		})
	});

	export type ReportOutcome = z.infer<typeof ReportOutcome>;

	/**
	 * Written on a box its host did not mention.
	 *
	 * A sentence rather than a code because it is read by whoever is looking at
	 * a box that stopped for no reason they can see, and "the host stopped
	 * mentioning it" is the fact they need.
	 */
	export const OMITTED_FROM_REPORT = 'not in its host’s last report';

	/**
	 * Record one full snapshot of what a host is running.
	 *
	 * Scoped to the calling machine in the `where` clause and not by trusting
	 * the ids in the body: a machine credential is a long-lived secret on
	 * hardware in somebody's living room, and a snapshot naming another host's
	 * boxes must move nothing.
	 *
	 * Three rules, and the second two are why this is one function rather than
	 * a loop of `setState` in a route:
	 *
	 * - A box we know, that the snapshot names, takes the reported state.
	 * - A box we know, that the snapshot omits, is stopped — absence inside a
	 *   received snapshot is information. (Silence from the host is not, and is
	 *   not this function's input at all: no report means this is never called.)
	 * - A box the snapshot names that is not placed here is **not created**. An
	 *   agent that can conjure a row is an agent that can mint owned resources,
	 *   and a box belongs to somebody this snapshot cannot name. It is returned
	 *   as a divergence to be surfaced loudly instead.
	 *
	 * One transaction, because a snapshot is one observation: applying half of
	 * it leaves a state the host was never in.
	 */
	export const applyHostReport = fn(
		z.object({ machineId: Info.shape.machineId, boxes: z.array(Reported) }),
		async (input): Promise<ReportOutcome> => {
			return Database.transaction(async (tx) => {
				const placed = await tx
					.select({ id: BoxTable.id })
					.from(BoxTable)
					.where(and(eq(BoxTable.machineId, input.machineId), isNull(BoxTable.timeDeleted)))
					.then((rows) => new Set(rows.map((row) => row.id)));

				const seen: string[] = [];
				const unknown: string[] = [];
				for (const box of input.boxes) {
					if (!placed.has(box.boxId)) {
						unknown.push(box.boxId);
						continue;
					}
					seen.push(box.boxId);
					const stopped = box.state === 'stopped';
					await tx
						.update(BoxTable)
						.set({
							state: box.state,
							stopReason: stopped ? box.reason : null,
							stopClean: stopped ? box.clean : null
						})
						.where(and(eq(BoxTable.id, box.boxId), eq(BoxTable.machineId, input.machineId)));
				}

				// Everything placed here that the snapshot did not mention, and
				// that we believed was running.
				//
				// **`running` and not "anything not stopped"**, which is narrower
				// than it first looks it should be. A box is created here, by a
				// person, before its host has ever been told about it — so between
				// creation and the job that starts it there is a `created` box the
				// host correctly does not mention, and stopping it on that basis
				// would break the ordinary path rather than catch a divergence. A
				// box we were told was running and that has since vanished from its
				// host's own inventory is the real disagreement, and it is the one
				// that leaves a person looking at a box nothing is running.
				//
				// `notInArray` on an empty list matches nothing in SQL rather than
				// everything, so the empty snapshot — a host that has just come up
				// holding no boxes — is spelt out instead of relying on that.
				const missing = await tx
					.update(BoxTable)
					.set({ state: 'stopped', stopReason: OMITTED_FROM_REPORT, stopClean: false })
					.where(
						and(
							eq(BoxTable.machineId, input.machineId),
							isNull(BoxTable.timeDeleted),
							eq(BoxTable.state, 'running'),
							seen.length > 0 ? notInArray(BoxTable.id, seen) : undefined
						)
					)
					.returning({ id: BoxTable.id })
					.then((rows) => rows.map((row) => row.id));

				return { recorded: seen.length, unknown, markedStopped: missing };
			});
		}
	);

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
