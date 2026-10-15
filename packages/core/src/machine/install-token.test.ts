import { afterAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { VisibleError } from '../error.js';
import { Machine } from './index.js';
import { InstallToken } from './install-token.js';

const sql = testDb();

const createdUserIds: string[] = [];

async function newOwner(label: string) {
	const o = await Fixtures.owner(label);
	createdUserIds.push(o.userId);
	return o;
}

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
});

describe('Install tokens', () => {
	test('a token registers one machine to its team, owned by whoever issued it', async () => {
		const owner = await newOwner('nit-ok');
		const { token } = await InstallToken.create({ teamId: owner.teamId, userId: owner.userId });
		expect(token.startsWith('nit_')).toBe(true);

		const registered = await InstallToken.redeem({ token, label: 'host' });
		expect(registered?.secret.startsWith('msk_')).toBe(true);

		const rows =
			await sql`select team_id, owner_user_id from machine where id = ${registered!.machineId}`;
		expect(rows[0]!.team_id).toBe(owner.teamId);
		expect(rows[0]!.owner_user_id).toBe(owner.userId);

		// Only the digest is kept, and the row records what it produced.
		const tok =
			await sql`select token_hash, machine_id from install_token where team_id = ${owner.teamId}`;
		expect(tok[0]!.token_hash).not.toBe(token);
		expect(tok[0]!.machine_id).toBe(registered!.machineId);
	});

	test('a token is spent by its first use', async () => {
		const owner = await newOwner('nit-once');
		const { token } = await InstallToken.create({ teamId: owner.teamId, userId: owner.userId });
		expect(await InstallToken.redeem({ token, label: 'a' })).not.toBeNull();
		expect(await InstallToken.redeem({ token, label: 'b' })).toBeNull();
	});

	test('two hosts racing one token register exactly one machine', async () => {
		const owner = await newOwner('nit-race');
		const { token } = await InstallToken.create({ teamId: owner.teamId, userId: owner.userId });
		const results = await Promise.all(
			Array.from({ length: 5 }, (_, i) => InstallToken.redeem({ token, label: `h${i}` }))
		);
		expect(results.filter(Boolean)).toHaveLength(1);
		const machines = await sql`select id from machine where team_id = ${owner.teamId}`;
		expect(machines).toHaveLength(1);
	});

	test('expired and unknown tokens are refused the same way', async () => {
		const owner = await newOwner('nit-expired');
		const { token } = await InstallToken.create({ teamId: owner.teamId, userId: owner.userId });
		await sql`update install_token set expires_at = now() - interval '1 minute' where team_id = ${owner.teamId}`;
		expect(await InstallToken.redeem({ token, label: 'late' })).toBeNull();
		expect(await InstallToken.redeem({ token: 'nit_nosuchtoken', label: 'x' })).toBeNull();
	});

	test('one person may hold three unspent at once', async () => {
		const owner = await newOwner('nit-outstanding');
		const mint = () => InstallToken.create({ teamId: owner.teamId, userId: owner.userId });
		for (let i = 0; i < InstallToken.OUTSTANDING_LIMIT; i++) await mint();

		const refused = await mint().catch((e) => e);
		expect(refused).toBeInstanceOf(VisibleError);
		expect(refused.type).toBe('rate_limit');
		expect(refused.code).toBe('too_many_requests');
		expect(refused.message).toBe(
			'You have 3 install tokens that have not been used yet. Use one, or wait for them to expire.'
		);

		// One expiring frees its place.
		await sql`update install_token set expires_at = now() - interval '1 minute'
			where id = (select id from install_token where created_by_user_id = ${owner.userId} limit 1)`;
		expect((await mint()).token).toStartWith('nit_');
	});

	test('one person may make five an hour, spent or not', async () => {
		const owner = await newOwner('nit-hourly');
		const mint = () => InstallToken.create({ teamId: owner.teamId, userId: owner.userId });
		for (let i = 0; i < 3; i++) {
			const { token } = await mint();
			await InstallToken.redeem({ token, label: `h${i}` });
		}
		await mint();
		await mint();

		const refused = await mint().catch((e) => e);
		expect(refused).toBeInstanceOf(VisibleError);
		expect(refused.code).toBe('too_many_requests');
		expect(refused.message).toBe(
			'You have made 5 install tokens in the last hour. Try again later.'
		);

		// The hour is rolling: once the first ones age out, there is room again.
		await sql`update install_token set time_created = now() - interval '61 minutes'
			where created_by_user_id = ${owner.userId}`;
		expect((await mint()).token).toStartWith('nit_');
	});

	test('the limits are per person', async () => {
		const busy = await newOwner('nit-busy');
		const quiet = await newOwner('nit-quiet');
		for (let i = 0; i < InstallToken.OUTSTANDING_LIMIT; i++) {
			await InstallToken.create({ teamId: busy.teamId, userId: busy.userId });
		}
		const issued = await InstallToken.create({ teamId: quiet.teamId, userId: quiet.userId });
		expect(issued.token).toStartWith('nit_');
	});

	test('a team with no room for a host is not handed a token for one', async () => {
		const owner = await newOwner('nit-cap-mint');
		for (let i = 0; i < Machine.TEAM_MACHINE_LIMIT; i++) await Fixtures.machine(owner, `box-${i}`);
		const refused = await InstallToken.create({ teamId: owner.teamId, userId: owner.userId }).catch(
			(e) => e
		);
		expect(refused).toBeInstanceOf(VisibleError);
		expect(refused.code).toBe('quota_exceeded');
		expect(refused.message).toBe('Your team already has 10 machines. Remove one to add another.');
	});

	test('a token minted while there was room is refused once there is none, and stays unspent', async () => {
		const owner = await newOwner('nit-cap-redeem');
		for (let i = 0; i < Machine.TEAM_MACHINE_LIMIT - 1; i++) {
			await Fixtures.machine(owner, `box-${i}`);
		}
		const { token } = await InstallToken.create({ teamId: owner.teamId, userId: owner.userId });
		await Fixtures.machine(owner, 'the-last-place');

		const refused = await InstallToken.redeem({ token, label: 'late' }).catch((e) => e);
		expect(refused).toBeInstanceOf(VisibleError);
		expect(refused.code).toBe('quota_exceeded');

		const rows =
			await sql`select redeemed_at from install_token where created_by_user_id = ${owner.userId}`;
		expect(rows[0]!.redeemed_at).toBeNull();
	});
});
