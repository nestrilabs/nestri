import { and, eq, isNull } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { User } from './index.js';
import { UserTable } from './user.sql.js';
import { LinkedAccount } from './linked-account.js';
import { LinkedAccountTable } from './linked-account.sql.js';

const STEAM_ID_RE = /^\d{17}$/;

/** The partial unique index on a live account's address, named by the migration. */
const EMAIL_UNIQUE = 'user_email_unique';

/**
 * Whether a failure is the database refusing a duplicate.
 *
 * Every read-then-write below has a window between the read and the write, and
 * the index is what actually closes it. Recognising the refusal is how the
 * loser of a race turns a raw driver error into the answer it was asking for —
 * so the constraint is the mechanism and this is how the code hears from it.
 */
function isUniqueViolation(err: unknown, constraint: string): boolean {
	// Walked rather than read off the top, because the query builder wraps what
	// the driver threw: the outer error carries the SQL and the parameters, and
	// the code and the constraint name are on the cause underneath it.
	for (let e: unknown = err, depth = 0; e && depth < 8; depth++) {
		if (typeof e !== 'object') break;
		const candidate = e as { code?: unknown; constraint_name?: unknown; cause?: unknown };
		if (String(candidate.code) === '23505' && candidate.constraint_name === constraint) {
			return true;
		}
		e = candidate.cause;
	}
	return false;
}

/**
 * Email is the root of an account, so two spellings of one address must not be
 * two accounts. Case and surrounding whitespace are the two ways the same
 * address arrives looking different; both are removed at the edge, before
 * anything is stored or compared, and the unique index in the database
 * assumes it has been.
 */
const Email = z.string().trim().toLowerCase().pipe(z.email());

export namespace Identity {
	/**
	 * How many Steam accounts one person may hang off their account.
	 *
	 * This is not — and cannot be — a database constraint. A unique index makes a
	 * value unique; it cannot count the rows that share a foreign key, so there is
	 * no index shape that says "at most four of these". The number lives here and
	 * a direct write to the table can still exceed it. Anyone reading the schema
	 * and looking for the rule will not find one, which is why it is written down
	 * in the migration as well as here. ref(d-0048)
	 *
	 * Four comes from the size of a household that shares a game library and from
	 * the account switcher needing to fit on one row. It is a product constraint
	 * and not a measured one.
	 */
	export const MAX_STEAM_ACCOUNTS = 4;

	/**
	 * The account behind a verified email address, created if it is new.
	 *
	 * This is the only way a user comes into existence. Everything else — a
	 * Steam account, an SSH key — attaches to a user that already exists,
	 * which is what makes losing one of them survivable. ref(d-0048)
	 *
	 * Idempotent on the address: verifying the same mailbox twice is one
	 * person signing in twice, not two accounts.
	 */
	export const fromVerifiedEmail = fn(
		z.object({ email: Email, name: z.string().optional() }),
		async (input) => {
			const email = input.email;

			async function attempt() {
				return Database.transaction(async () => {
					const existing = await User.fromEmail(email);
					if (existing) {
						// An address that was attached but never confirmed is
						// confirmed now: getting here means a code was redeemed.
						if (!existing.emailVerified) {
							await User.setEmail({ id: existing.id, email, emailVerified: true });
						}
						return { userID: existing.id, created: false };
					}

					const userID = Identifier.ascending('user');
					await User.create({
						id: userID,
						name: input.name?.trim() || email.split('@')[0]!,
						email,
						emailVerified: true,
						image: null
					});
					return { userID, created: true };
				});
			}

			try {
				return await attempt();
			} catch (err) {
				if (!isUniqueViolation(err, EMAIL_UNIQUE)) throw err;

				// Somebody else finished the same sign-in first.
				//
				// Two people redeeming a code for one address is one person
				// with two tabs, and the answer they both want is the account
				// that now exists. The lookup and the insert cannot be made one
				// statement here — the row is built from an id this process
				// generates — so the index arbitrates and the loser reads back
				// what the winner wrote. Retried once and not in a loop: a
				// second refusal means the row is gone again, which is a
				// deletion racing a sign-in and not something to spin on.
				return await attempt();
			}
		}
	);

	/**
	 * Attach a verified email to an account that never had one.
	 *
	 * Accounts predate the rule that email is the root, so a live database
	 * holds users with no address at all. Each one is claimed exactly once,
	 * here, and afterwards it is an ordinary account.
	 */
	export const claimWithEmail = fn(
		z.object({ userId: z.string(), email: Email }),
		async (input) => {
			const email = input.email;
			try {
				return await Database.transaction(async () => {
					const holder = await User.fromEmail(email);
					if (holder && holder.id !== input.userId) {
						throw new VisibleError(
							'already_exists',
							ErrorCodes.Validation.ALREADY_EXISTS,
							'That email address already belongs to another account'
						);
					}
					const updated = await User.setEmail({
						id: input.userId,
						email,
						emailVerified: true
					});
					if (!updated) {
						throw new VisibleError(
							'not_found',
							ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
							'No such account'
						);
					}
					return updated;
				});
			} catch (err) {
				// The check above and the update below are two statements, so
				// two accounts claiming one address can both find it free. The
				// index refuses the second, and the person deserves the same
				// sentence they would have got a moment earlier rather than a
				// driver's error text.
				if (!isUniqueViolation(err, EMAIL_UNIQUE)) throw err;
				throw new VisibleError(
					'already_exists',
					ErrorCodes.Validation.ALREADY_EXISTS,
					'That email address already belongs to another account'
				);
			}
		}
	);

	/**
	 * The account a Steam sign-in belongs to, or an error.
	 *
	 * Signing in with Steam never creates anything. A Steam account is a link
	 * on a user, so one that names no user is a person who has not signed up —
	 * an answer the interface has to render, not a reason to mint a row. The
	 * accounts that predate this are exactly the ones a link already exists
	 * for, so they keep working without a special case. ref(d-0048)
	 */
	export const resolveSteamLogin = fn(
		z.object({ steamId: z.string().regex(STEAM_ID_RE, 'must be a 17-digit Steam ID') }),
		async (input) => {
			const link = await LinkedAccount.findByProvider({
				provider: 'steam',
				providerAccountId: input.steamId
			});
			if (!link) {
				throw new VisibleError(
					'not_found',
					ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
					'This Steam account is not connected to an account. Sign in with your email address first, then connect Steam from your settings.'
				);
			}
			return { userID: link.userId, linkedAccountID: link.id };
		}
	);

	/**
	 * Hang a Steam account off a user, up to {@link MAX_STEAM_ACCOUNTS}.
	 *
	 * The count and the insert are one transaction because they are one
	 * decision, and the transaction takes the account's own row first so that
	 * two callers cannot each count four and each write a fifth.
	 */
	export const linkSteam = fn(
		z.object({
			userId: z.string(),
			steamId: z.string().regex(STEAM_ID_RE, 'must be a 17-digit Steam ID'),
			profile: z.record(z.string(), z.unknown()).nullable().optional()
		}),
		async (input) => {
			return Database.transaction(async (tx) => {
				// Take the account's own row first, and hold it.
				//
				// The cap is a count, and a count only means something if it
				// is taken while nothing can change it. Locking the
				// connections instead locks nothing at all when there are
				// none: there are no gap locks under read committed, so
				// `for update` over an empty result set is an empty set of
				// locks, and several simultaneous first-time links all read
				// zero and all insert. The account's own row is the one thing
				// every caller for it is guaranteed to contend on, so it is
				// what serializes them.
				const [owner] = await tx
					.select({ id: UserTable.id })
					.from(UserTable)
					.where(and(eq(UserTable.id, input.userId), isNull(UserTable.timeDeleted)))
					.for('update');
				if (!owner) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'No such account'
					);
				}

				const existing = await LinkedAccount.findByProvider({
					provider: 'steam',
					providerAccountId: input.steamId
				});
				if (existing) {
					if (existing.userId !== input.userId) {
						throw new VisibleError(
							'already_exists',
							ErrorCodes.Validation.ALREADY_EXISTS,
							'That Steam account is already connected to a different account'
						);
					}
					if (input.profile) {
						await LinkedAccount.updateProfile({ id: existing.id, profile: input.profile });
					}
					return existing.id;
				}

				// Counted under the lock taken above, so what is counted is
				// what is still there at the insert.
				const held = await tx
					.select({ id: LinkedAccountTable.id })
					.from(LinkedAccountTable)
					.where(
						and(
							eq(LinkedAccountTable.userId, input.userId),
							eq(LinkedAccountTable.provider, 'steam'),
							isNull(LinkedAccountTable.timeDeleted)
						)
					);

				if (held.length >= MAX_STEAM_ACCOUNTS) {
					throw new VisibleError(
						'validation',
						ErrorCodes.Validation.INVALID_STATE,
						`An account can have at most ${MAX_STEAM_ACCOUNTS} Steam accounts connected. Disconnect one before adding another.`
					);
				}

				const id = Identifier.ascending('linkedAccount');
				await LinkedAccount.create({
					id,
					userId: input.userId,
					provider: 'steam',
					providerAccountId: input.steamId,
					profile: input.profile ?? null
				});
				return id;
			});
		}
	);

	/** Every Steam account connected to this user, oldest first. */
	export const listSteam = fn(z.string(), async (userId) => {
		const links = await LinkedAccount.listByUser(userId);
		return links.filter((link) => link.provider === 'steam');
	});
}
