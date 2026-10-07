import { afterAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
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
});
