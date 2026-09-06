import { randomBytes } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { Member } from '../team/member.js';
import { MachineTable } from './machine.sql.js';

/**
 * Registered host identity.
 *
 * A box trades an owner-supplied token for an assigned id and a secret, then
 * authenticates as itself. The alternative — deriving an id from
 * `/etc/machine-id` or a hardware fingerprint — was rejected: self-hosted
 * boxes mean the operator is not automatically trusted, and every such input
 * is operator-editable, so uniqueness would rest on nobody choosing to lie.
 */
export namespace Machine {
	/** Length in bytes before base64url encoding. */
	const SECRET_BYTES = 32;

	/**
	 * A host's endpoint id: 32 bytes of public key, lowercase hex.
	 *
	 * Checked for shape and nothing else. What it addresses is meaningless
	 * here — this is a string the control plane stores and hands back — so the
	 * only thing worth refusing is a value that cannot possibly be one, which
	 * is what keeps a truncated or double-encoded id from being written and
	 * then failing far away, at whoever tries to dial it.
	 */
	export const EndpointId = z.string().regex(/^[0-9a-f]{64}$/, {
		message: 'An endpoint id is 64 lowercase hex characters'
	});

	export const Info = z
		.object({
			id: z.string().meta({
				description: 'Unique identifier for the machine',
				example: Examples.Machine.id
			}),
			ownerUserId: z.string().meta({
				description: 'The user who registered this machine',
				example: Examples.Machine.ownerUserId
			}),
			teamId: z.string().meta({
				description:
					'The team that owns this hardware. Always set — every user has a personal team',
				example: Examples.Machine.teamId
			}),
			label: z.string().meta({
				description: 'Human-readable name for the box',
				example: Examples.Machine.label
			}),
			lastSeen: z.iso.datetime().optional().nullable().meta({
				description: 'When this machine last authenticated',
				example: Examples.Machine.lastSeen
			}),
			endpointId: EndpointId.optional().nullable().meta({
				description:
					'Where this host can be reached, as its own endpoint id. Null until the host has reported one — it holds the secret half of this identity, so it is the only thing that can say what the public half is',
				example: Examples.Machine.endpointId
			})
		})
		.meta({
			ref: 'Machine',
			description: 'A registered nessh host',
			example: Examples.Machine
		});

	export type Info = z.infer<typeof Info>;

	function generateSecret(): string {
		return `msk_${randomBytes(SECRET_BYTES).toString('base64url')}`;
	}

	async function hashSecret(secret: string): Promise<string> {
		const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
		return Array.from(new Uint8Array(digest))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	/** Postgres refusing a second row for the same key. */
	function isUniqueViolation(err: unknown): boolean {
		const e = err as { code?: string; cause?: { code?: string } };
		return e?.code === '23505' || e?.cause?.code === '23505';
	}

	/** Length-independent, content-constant comparison of two hex digests. */
	function secureEquals(a: string, b: string): boolean {
		if (a.length !== b.length) {
			return false;
		}
		let diff = 0;
		for (let i = 0; i < a.length; i++) {
			diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
		}
		return diff === 0;
	}

	/**
	 * Register a box. The secret is returned here and nowhere else — it is
	 * stored only as a digest, so a lost secret means re-registering rather
	 * than looking it up.
	 */
	export const register = fn(
		Info.pick({ id: true, ownerUserId: true, teamId: true, label: true }),
		async (input) => {
			const secret = generateSecret();
			await Database.use(async (tx) => {
				await tx.insert(MachineTable).values({
					id: input.id,
					ownerUserId: input.ownerUserId,
					teamId: input.teamId,
					label: input.label,
					secretHash: await hashSecret(secret),
					lastSeen: null
				});
			});
			return { id: input.id, secret };
		}
	);

	/**
	 * Resolve credentials to a machine, or `null`. Looks the row up by id and
	 * then compares digests, so a wrong id and a wrong secret are refused the
	 * same way and neither reveals which half was wrong.
	 */
	export const authenticate = fn(
		z.object({ id: z.string(), secret: z.string() }),
		async (input) => {
			return Database.use(async (tx) => {
				return tx
					.select()
					.from(MachineTable)
					.where(and(eq(MachineTable.id, input.id), isNull(MachineTable.timeDeleted)))
					.then(async (rows) => {
						const row = rows.at(0);
						if (!row) {
							return null;
						}
						if (!secureEquals(row.secretHash, await hashSecret(input.secret))) {
							return null;
						}
						// Serialized here, so `secretHash` never leaves this
						// function even in memory — the caller cannot leak what
						// it was never handed.
						return serialize(row);
					});
			});
		}
	);

	/**
	 * Move a host to a different team.
	 *
	 * There is no "out of a team" any more: `teamId` is notNull, so a host always
	 * belongs to exactly one and the single-operator case is a team of one rather
	 * than a null. What used to be *unscope* is now *move to my personal team*,
	 * which the caller names explicitly. ref(d-0048)
	 *
	 * Scoped to the owner in the query itself, so a machine belonging to
	 * someone else is a miss rather than a permission check that could be
	 * forgotten. Membership of the *target* team is the caller's to verify —
	 * this function knows about machines, not about who belongs where.
	 *
	 * Deliberately not ownership transfer. Scoping keeps the same owner and
	 * should be easy; handing a box to a different person should not be, and
	 * is left to re-registration until renting makes it worth building.
	 */
	export const setTeam = fn(
		Info.pick({ id: true, ownerUserId: true, teamId: true }),
		async (input) => {
			return Database.use(async (tx) => {
				return tx
					.update(MachineTable)
					.set({ teamId: input.teamId })
					.where(
						and(
							eq(MachineTable.id, input.id),
							eq(MachineTable.ownerUserId, input.ownerUserId),
							isNull(MachineTable.timeDeleted)
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
	 * How often a host should say it is alive, in seconds.
	 *
	 * Returned to the host on every heartbeat rather than compiled into it: the
	 * cadence is the control plane's business, and a fleet whose interval can
	 * only be changed by shipping a new agent is a fleet whose interval never
	 * changes. Thirty seconds is a placeholder — it is short enough that a dead
	 * host is noticed within a session's setup, and long enough to be free.
	 */
	export const HEARTBEAT_SECONDS = 30;

	/**
	 * A host is considered offline once it has missed this many heartbeats.
	 *
	 * Three rather than one, because a single missed beat is a lost packet and
	 * calling that "offline" would make placement flap.
	 */
	export const OFFLINE_AFTER_MISSED = 3;

	/**
	 * Record that a host is alive, and say when that was.
	 *
	 * Returns the stored timestamp rather than void so a caller can hand it
	 * straight back to the host — which is what lets a heartbeat be one round
	 * trip instead of a write followed by a read.
	 *
	 * `endpointId` rides along for the same reason. Where a host is reachable
	 * is a fact about the host, it changes when the agent's identity does, and
	 * a caller that has just proved it is that host is the only one who can
	 * report it — so it is written by the call that already says "still here",
	 * in the same statement, rather than by a second one that could succeed
	 * alone and leave the two facts disagreeing.
	 */
	export const touchLastSeen = fn(
		Info.pick({ id: true }).extend({ endpointId: EndpointId.optional() }),
		async (input) => {
			try {
				return await Database.use(async (tx) => {
					return tx
						.update(MachineTable)
						.set({
							lastSeen: sql`now()`,
							// Omitted rather than nulled when it is absent: a caller
							// that does not mention where it is has not moved, and
							// clearing the column would deregister a working host
							// from every route that reads it.
							...(input.endpointId ? { endpointId: input.endpointId } : {})
						})
						.where(eq(MachineTable.id, input.id))
						.returning({ lastSeen: MachineTable.lastSeen })
						.then((rows) => rows.at(0)?.lastSeen ?? null);
				});
			} catch (err) {
				// Another host already holds this endpoint id. That is a
				// conflict rather than a fault: the unique index is the
				// invariant, so the database refusing is the expected way to
				// find out, and letting it surface as a 500 would tell a host
				// its beat broke the server.
				//
				// Checked-then-written would be worse rather than better. Two
				// hosts reporting the same id in the same instant both read
				// "nobody holds it" and both write, which is precisely what the
				// index is for — so the read would add a query and remove
				// nothing.
				if (isUniqueViolation(err)) {
					throw new VisibleError(
						'already_exists',
						ErrorCodes.Validation.ALREADY_EXISTS,
						'Another machine is already reachable at that endpoint id'
					);
				}
				throw err;
			}
		}
	);

	/**
	 * Whether a host has beaten recently enough to place work on.
	 *
	 * Derived from `lastSeen` rather than stored as a column, so there is no
	 * state to go stale when nothing is running to clear it — a host that stops
	 * beating becomes offline by the passage of time, which is the one mechanism
	 * that cannot itself fail.
	 */
	export function isOnline(lastSeen: Date | string | null): boolean {
		if (!lastSeen) {
			return false;
		}
		const at = lastSeen instanceof Date ? lastSeen : new Date(lastSeen);
		const age = (Date.now() - at.getTime()) / 1000;
		return age <= HEARTBEAT_SECONDS * OFFLINE_AFTER_MISSED;
	}

	export const fromID = fn(Info.shape.id, async (id) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(MachineTable)
				.where(and(eq(MachineTable.id, id), isNull(MachineTable.timeDeleted)))
				.then((rows) => {
					const row = rows.at(0);
					return row ? serialize(row) : null;
				});
		});
	});

	/** Why a user may — or may not — use a box. */
	export const Entitlement = z.object({
		entitled: z.boolean(),
		/** `owner`, `team`, or `none`. Present so a refusal can explain itself. */
		reason: z.enum(['owner', 'team', 'none'])
	});

	export type Entitlement = z.infer<typeof Entitlement>;

	/**
	 * Whether a user may use a box.
	 *
	 * The whole access model in one function: a solo box (`teamId` null) is the
	 * owner's alone, and a team-scoped box is open to that team. Multi-user
	 * access is the paid tier, so this is the line the paywall sits on — worth
	 * having exactly one implementation of.
	 *
	 * Membership is read live rather than cached in the machine row, so
	 * removing someone from a team takes their box access with it and nobody
	 * has to remember to revoke anything.
	 */
	export const entitlement = fn(
		z.object({ machineId: z.string(), userId: z.string() }),
		async (input): Promise<Entitlement> => {
			const machine = await fromID(input.machineId);
			if (!machine) {
				return { entitled: false, reason: 'none' };
			}
			if (machine.ownerUserId === input.userId) {
				return { entitled: true, reason: 'owner' };
			}
			if (!machine.teamId) {
				// A solo box. Nobody but the owner, whatever else is true.
				return { entitled: false, reason: 'none' };
			}
			const membership = await Member.findByTeamAndUser({
				teamId: machine.teamId,
				userId: input.userId
			});
			return membership ? { entitled: true, reason: 'team' } : { entitled: false, reason: 'none' };
		}
	);

	export const listByOwner = fn(Info.shape.ownerUserId, async (ownerUserId) => {
		return Database.use(async (tx) => {
			return tx
				.select()
				.from(MachineTable)
				.where(and(eq(MachineTable.ownerUserId, ownerUserId), isNull(MachineTable.timeDeleted)))
				.orderBy(MachineTable.timeCreated)
				.then((rows) => rows.map(serialize));
		});
	});

	export const remove = fn(Info.shape.id, async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(MachineTable)
				.set({ timeDeleted: sql`now()` })
				.where(eq(MachineTable.id, id));
		});
	});

	export function serialize(input: typeof MachineTable.$inferSelect): z.infer<typeof Info> {
		return {
			id: input.id,
			ownerUserId: input.ownerUserId,
			teamId: input.teamId,
			label: input.label,
			lastSeen: input.lastSeen?.toISOString() ?? null,
			endpointId: input.endpointId
		};
	}
}
