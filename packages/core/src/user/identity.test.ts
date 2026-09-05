import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { Actor } from '../actor.js';
import { testDb } from '../db/test.js';
import { Identifier } from '../id.js';
import { Steam } from '../steam/index.js';
import { Identity } from './identity.js';
import { User } from './index.js';
import { LinkedAccount } from './linked-account.js';

const sql = testDb();

const createdUserIDs: string[] = [];

function steamID(n: number): string {
	return String(76561197960299000n + BigInt(n));
}

function email(n: number): string {
	return `identity-fixture-${n}@example.test`;
}

function track(userID: string) {
	createdUserIDs.push(userID);
	return userID;
}

async function cleanup() {
	createdUserIDs.length = 0;
	// By fixture shape rather than by tracked id: a test that throws before it
	// records the row it made would otherwise leave one behind, and the next
	// run would read it as an account that already existed.
	await sql`delete from "user" where email like 'identity-fixture-%@example.test'`;
	await sql`
		delete from "user" u
		where exists (
			select 1 from linked_account l
			where l.user_id = u.id
				and l.provider = 'steam'
				and l.provider_account_id like '765611979602990%'
		)
	`;
}

async function countUsers(): Promise<number> {
	const rows = await sql`select count(*)::int as n from "user"`;
	return rows[0]!.n as number;
}

/** A user as the database holds them today: made by Steam, with no email. */
async function legacySteamUser(n: number) {
	const userID = track(Identifier.ascending('user'));
	await User.create({
		id: userID,
		name: `legacy-${n}`,
		email: undefined,
		emailVerified: false,
		image: null
	});
	const linkID = Identifier.ascending('linkedAccount');
	await LinkedAccount.create({
		id: linkID,
		userId: userID,
		provider: 'steam',
		providerAccountId: steamID(n),
		profile: null
	});
	return { userID, linkID, steamId: steamID(n) };
}

afterAll(async () => {
	await cleanup();
	await sql.end();
});

describe('Identity.resolveSteamLogin', () => {
	beforeEach(cleanup);

	test('a Steam account made before email existed still signs in to the same user', async () => {
		const legacy = await legacySteamUser(1);

		const resolved = await Identity.resolveSteamLogin({ steamId: legacy.steamId });

		expect(resolved.userID).toBe(legacy.userID);
		expect(resolved.linkedAccountID).toBe(legacy.linkID);
	});

	test('an unknown Steam account is refused and creates no user', async () => {
		const before = await countUsers();

		let thrown: any = null;
		try {
			await Identity.resolveSteamLogin({ steamId: steamID(99) });
		} catch (err) {
			thrown = err;
		}

		expect(thrown).not.toBeNull();
		expect(thrown.type).toBe('not_found');
		expect(await countUsers()).toBe(before);
	});
});

describe('Identity.fromVerifiedEmail', () => {
	beforeEach(cleanup);

	test('a verified email creates the user, and nothing else is needed', async () => {
		const result = await Identity.fromVerifiedEmail({ email: email(1), name: 'Player One' });
		track(result.userID);

		expect(result.created).toBe(true);
		const user = await User.fromID(result.userID);
		expect(user?.email).toBe(email(1));
		expect(user?.emailVerified).toBe(true);
	});

	test('the same address resolves to the same user rather than a second one', async () => {
		const first = await Identity.fromVerifiedEmail({ email: email(2) });
		track(first.userID);
		const before = await countUsers();

		const second = await Identity.fromVerifiedEmail({ email: `  ${email(2).toUpperCase()} ` });

		expect(second.userID).toBe(first.userID);
		expect(second.created).toBe(false);
		expect(await countUsers()).toBe(before);
	});
});

describe('input the flow refuses before it reaches the database', () => {
	// `fn()` parses before it calls, so a rejected input throws where it is
	// written rather than resolving to a rejected promise later on.
	test('an address that is not one never becomes an account', () => {
		expect(() => Identity.fromVerifiedEmail({ email: 'not-an-address' })).toThrow();
	});

	test('a Steam id of the wrong shape is not looked up', () => {
		expect(() => Identity.resolveSteamLogin({ steamId: '123' })).toThrow();
	});
});

describe('Identity.linkSteam', () => {
	beforeEach(cleanup);

	test('a fifth Steam account is refused and the fourth still stands', async () => {
		const { userID } = await Identity.fromVerifiedEmail({ email: email(3) });
		track(userID);

		for (let n = 10; n < 14; n++) {
			await Identity.linkSteam({ userId: userID, steamId: steamID(n) });
		}

		let thrown: any = null;
		try {
			await Identity.linkSteam({ userId: userID, steamId: steamID(14) });
		} catch (err) {
			thrown = err;
		}

		expect(thrown).not.toBeNull();
		expect(thrown.code).toBe('invalid_state');
		const links = await LinkedAccount.listByUser(userID);
		expect(links.filter((l) => l.provider === 'steam')).toHaveLength(Identity.MAX_STEAM_ACCOUNTS);
	});

	test('relinking the same Steam account is not a fifth account', async () => {
		const { userID } = await Identity.fromVerifiedEmail({ email: email(4) });
		track(userID);

		const first = await Identity.linkSteam({ userId: userID, steamId: steamID(20) });
		const again = await Identity.linkSteam({ userId: userID, steamId: steamID(20) });

		expect(again).toBe(first);
	});

	test('a Steam account already held by somebody else is a conflict', async () => {
		const legacy = await legacySteamUser(30);
		const { userID } = await Identity.fromVerifiedEmail({ email: email(5) });
		track(userID);

		let thrown: any = null;
		try {
			await Identity.linkSteam({ userId: userID, steamId: legacy.steamId });
		} catch (err) {
			thrown = err;
		}

		expect(thrown).not.toBeNull();
		expect(thrown.type).toBe('already_exists');
	});

	test('the cap holds on the path the settings screen uses', async () => {
		const { userID } = await Identity.fromVerifiedEmail({ email: email(7) });
		track(userID);
		for (let n = 50; n < 54; n++) {
			await Identity.linkSteam({ userId: userID, steamId: steamID(n) });
		}

		let thrown: any = null;
		await Actor.with({ type: 'user', properties: { userID, linkedAccountID: '' } }, async () => {
			try {
				await Steam.link({ steamId: steamID(54) });
			} catch (err) {
				thrown = err;
			}
		});

		expect(thrown).not.toBeNull();
		expect(thrown.code).toBe('invalid_state');
		expect(await Identity.listSteam(userID)).toHaveLength(Identity.MAX_STEAM_ACCOUNTS);
	});

	test('a legacy user is claimed by attaching an email, and keeps its Steam link', async () => {
		const legacy = await legacySteamUser(40);

		const claimed = await Identity.claimWithEmail({ userId: legacy.userID, email: email(6) });

		expect(claimed.email).toBe(email(6));
		expect(claimed.emailVerified).toBe(true);
		const resolved = await Identity.resolveSteamLogin({ steamId: legacy.steamId });
		expect(resolved.userID).toBe(legacy.userID);
	});
});

/**
 * The same call, several times at once, against a real database.
 *
 * Every one of these holds a rule that is enforced across two statements — a
 * lookup and then a write — which means the rule is only as good as whatever
 * stops the two from interleaving. Run one at a time they all pass whether or
 * not that protection exists, which is exactly why they are written this way.
 */
describe('the same thing happening twice at once', () => {
	beforeEach(cleanup);

	test('the cap holds when the links arrive together', async () => {
		const { userID } = await Identity.fromVerifiedEmail({ email: email(8) });
		track(userID);

		const wanted = Identity.MAX_STEAM_ACCOUNTS + 2;
		const results = await Promise.allSettled(
			Array.from({ length: wanted }, (_, i) =>
				Identity.linkSteam({ userId: userID, steamId: steamID(60 + i) })
			)
		);

		expect(await Identity.listSteam(userID)).toHaveLength(Identity.MAX_STEAM_ACCOUNTS);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
			Identity.MAX_STEAM_ACCOUNTS
		);
		for (const rejected of results.filter((r) => r.status === 'rejected')) {
			expect((rejected as PromiseRejectedResult).reason.code).toBe('invalid_state');
		}
	});

	test('several sign-ins for one new address make one account', async () => {
		const address = email(9);

		const results = await Promise.all([
			Identity.fromVerifiedEmail({ email: address }),
			Identity.fromVerifiedEmail({ email: address }),
			Identity.fromVerifiedEmail({ email: address })
		]);
		results.forEach((r) => track(r.userID));

		expect(new Set(results.map((r) => r.userID)).size).toBe(1);
		expect(results.filter((r) => r.created)).toHaveLength(1);

		const rows = await sql`
			select count(*)::int as n from "user"
			where email = ${address} and time_deleted is null
		`;
		expect(rows[0]!.n).toBe(1);
	});

	test('two accounts claiming one address get an answer rather than a driver error', async () => {
		const first = await legacySteamUser(70);
		const second = await legacySteamUser(71);
		const address = email(10);

		const results = await Promise.allSettled([
			Identity.claimWithEmail({ userId: first.userID, email: address }),
			Identity.claimWithEmail({ userId: second.userID, email: address })
		]);

		const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
		expect(rejected).toHaveLength(1);
		// The point of the assertion: a sentence a screen can render, and not
		// whatever text the driver puts on a constraint violation.
		expect(rejected[0]!.reason.type).toBe('already_exists');
		expect(rejected[0]!.reason.message).toMatch(/another account/);
	});
});
