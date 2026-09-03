import { Actor } from '../actor.js';
import { Identifier } from '../id.js';
import { Machine } from '../machine/index.js';
import { Team } from '../team/index.js';
import { User } from '../user/index.js';
import { LinkedAccount } from '../user/linked-account.js';

/**
 * Fixtures for the ownership chain, because since
 * [0048](../../../../.nestri/decisions/0048-email-is-the-root-identity-and-a-box-is-a-row.md)
 * it is a chain rather than a set of loose rows.
 *
 * A box now needs a user, a team, and a machine to exist before it can, and a
 * session needs a game and a linked account on top of that. Every test that
 * touches either was otherwise going to build the same four rows by hand, and
 * the version built by hand is the version that quietly uses a `hst_…` string
 * where a real machine id belongs — which is exactly what the new foreign key
 * exists to catch.
 *
 * Test-only. Nothing here is imported by shipping code.
 */
export namespace Fixtures {
	export interface Owner {
		userId: string;
		teamId: string;
		linkedAccountId: string;
	}

	/**
	 * A user with a personal team and one linked Steam account.
	 *
	 * `Team.createPersonal` reads `Actor.userID`, so this runs inside
	 * `Actor.with` — the same wrapping the auth worker does at login.
	 */
	export async function owner(label: string): Promise<Owner> {
		const userId = Identifier.ascending('user');
		await User.create({
			id: userId,
			name: label,
			email: `${label}-${userId}@example.test`,
			emailVerified: true,
			image: null
		});

		const linkedAccountId = Identifier.ascending('linkedAccount');
		const teamId = await Actor.with(
			{ type: 'user', properties: { userID: userId, linkedAccountID: linkedAccountId } },
			async () => {
				await LinkedAccount.create({
					id: linkedAccountId,
					userId,
					provider: 'steam',
					// Unique per fixture: `(provider, providerAccountId)` is unique,
					// so a fixed value would make the second owner in any test fail
					// for a reason that has nothing to do with the test.
					providerAccountId: `7656${userId.slice(-13)}`,
					profile: {}
				});
				return Team.ensurePersonal({ displayName: label });
			}
		);

		return { userId, teamId, linkedAccountId };
	}

	/** A registered host owned by `owner`, on their team. */
	export async function machine(o: Owner, label = 'test-box'): Promise<string> {
		const registered = await Machine.register({
			id: Identifier.ascending('machine'),
			ownerUserId: o.userId,
			teamId: o.teamId,
			label
		});
		return registered.id;
	}
}
