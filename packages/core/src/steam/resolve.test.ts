import { afterAll, describe, expect, test } from 'bun:test';

import { testDb } from '../db/test.js';
import { Identifier } from '../id.js';
import { Fingerprint } from '../user/fingerprint.js';
import { User } from '../user/index.js';
import { LinkedAccount } from '../user/linked-account.js';
import { Steam } from './index.js';

const sql = testDb();

const createdUserIDs: string[] = [];

function steamID(n: number): string {
	return String(76561197960287930n + BigInt(n));
}

function fingerprint(n: number): string {
	return `aa:bb:cc:dd:ee:ff:00:11:22:33:44:55:66:77:88:${String(n).padStart(2, '0')}`;
}

async function resolve(fpr: string, sid: string) {
	return Steam.resolveSshIdentity({ fingerprint: fpr, steamId: sid });
}

async function cleanup() {
	if (createdUserIDs.length > 0) {
		await sql`delete from "user" where id in ${sql(createdUserIDs)}`;
		createdUserIDs.length = 0;
	}
}

function track(userID: string) {
	createdUserIDs.push(userID);
	return userID;
}

async function countSteamLinks(steamId: string): Promise<number> {
	const rows = await sql`
		select count(*)::int as n from linked_account
		where provider = 'steam' and provider_account_id = ${steamId}
	`;
	return rows[0]?.n;
}

async function countFingerprints(fpr: string): Promise<number> {
	const rows =
		await sql`select count(*)::int as n from user_fingerprint where fingerprint = ${fpr}`;
	return rows[0]?.n;
}

describe('Steam.resolveSshIdentity', () => {
	afterAll(async () => {
		await cleanup();
		await sql.end();
	});

	test('1. new fingerprint + new Steam ID creates one user', async () => {
		await cleanup();
		const result = await resolve(fingerprint(1), steamID(1));

		expect(result.userID).toMatch(/^usr_/);
		track(result.userID);

		const user = await User.fromID(result.userID);
		expect(user).not.toBeNull();

		const links = await LinkedAccount.listByUser(result.userID);
		expect(links.map((l) => l.provider).sort()).toEqual(['ssh', 'steam']);
		expect(await countFingerprints(fingerprint(1))).toBe(1);
		expect(await countSteamLinks(steamID(1))).toBe(1);
	});

	test('2. same fingerprint + same Steam ID returns the same user', async () => {
		const first = await resolve(fingerprint(2), steamID(2));
		track(first.userID);
		const second = await resolve(fingerprint(2), steamID(2));

		expect(second.userID).toBe(first.userID);
		expect(second.linkedAccountID).toBe(first.linkedAccountID);
		expect(await countFingerprints(fingerprint(2))).toBe(1);
		expect(await countSteamLinks(steamID(2))).toBe(1);
	});

	test('3. new fingerprint + same Steam ID returns the first user', async () => {
		const first = await resolve(fingerprint(3), steamID(3));
		track(first.userID);
		const second = await resolve(fingerprint(4), steamID(3));

		expect(second.userID).toBe(first.userID);
		expect(second.linkedAccountID).toBe(first.linkedAccountID);
		track(second.userID);
		expect(await countFingerprints(fingerprint(4))).toBe(1);
		expect(await countSteamLinks(steamID(3))).toBe(1);
	});

	test('4. same fingerprint + different Steam ID is rejected', async () => {
		await resolve(fingerprint(5), steamID(5));
		expect(resolve(fingerprint(5), steamID(6))).rejects.toMatchObject({
			type: 'forbidden'
		});
	});

	test('5. existing Steam ID reassigns a provisional fingerprint user', async () => {
		const canonical = await resolve(fingerprint(7), steamID(7));
		track(canonical.userID);

		const provisionalUserID = track(Identifier.ascending('user'));
		await User.create({
			id: provisionalUserID,
			name: 'provisional',
			email: undefined,
			emailVerified: false,
			image: null
		});
		const fpr = fingerprint(8);
		await Fingerprint.create({
			id: Identifier.ascending('userFingerprint'),
			userId: provisionalUserID,
			fingerprint: fpr,
			name: null
		});
		await LinkedAccount.create({
			id: Identifier.ascending('linkedAccount'),
			userId: provisionalUserID,
			provider: 'ssh',
			providerAccountId: fpr,
			profile: null
		});

		const result = await resolve(fpr, steamID(7));

		expect(result.userID).toBe(canonical.userID);

		const row = await Fingerprint.findByFingerprint(fpr);
		expect(row?.userId).toBe(canonical.userID);
		const sshLink = await LinkedAccount.findSshByFingerprint(fpr);
		expect(sshLink?.userId).toBe(canonical.userID);
	});

	test('5b. reassignment is rejected when the provisional user has a different Steam account', async () => {
		await resolve(fingerprint(9), steamID(9));
		expect(resolve(fingerprint(9), steamID(10))).rejects.toMatchObject({
			type: 'forbidden'
		});
	});

	test('6. two concurrent new fingerprints for one Steam ID create one Steam link', async () => {
		await cleanup();
		const [a, b] = await Promise.all([
			resolve(fingerprint(11), steamID(11)),
			resolve(fingerprint(12), steamID(11))
		]);

		expect(a.userID).toBe(b.userID);
		track(a.userID);
		expect(await countSteamLinks(steamID(11))).toBe(1);
		expect(await countFingerprints(fingerprint(11))).toBe(1);
		expect(await countFingerprints(fingerprint(12))).toBe(1);
	});

	test('7. malformed request without Steam ID is rejected', () => {
		expect(
			Steam.resolveSshIdentity.schema.safeParse({ fingerprint: fingerprint(13) }).success
		).toBe(false);
		expect(
			Steam.resolveSshIdentity.schema.safeParse({
				fingerprint: fingerprint(13),
				steamId: 'not-a-steam-id'
			}).success
		).toBe(false);
	});

	test('8. last-seen is updated on repeat login', async () => {
		const first = await resolve(fingerprint(14), steamID(14));
		track(first.userID);
		const before = await Fingerprint.findByFingerprint(fingerprint(14));
		expect(before?.lastSeen).toBeNull();
		await new Promise((r) => setTimeout(r, 25));
		await resolve(fingerprint(14), steamID(14));
		const after = await Fingerprint.findByFingerprint(fingerprint(14));
		expect(after?.lastSeen).not.toBeNull();
	});
});
