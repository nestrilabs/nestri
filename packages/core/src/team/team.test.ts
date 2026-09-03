import { afterAll, describe, expect, test } from 'bun:test';

import { Actor } from '../actor.js';
import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { Identifier } from '../id.js';
import { Member } from './member.js';
import { Team } from './index.js';

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

describe('Team.ensurePersonal', () => {
	test('a new user gets exactly one team, and owns it', async () => {
		const owner = await newOwner('team-first');

		const team = await Team.personalFor(owner.userId);
		expect(team?.id).toBe(owner.teamId);
		expect(team?.ownerId).toBe(owner.userId);

		const memberships = await Member.listByUser(owner.userId);
		expect(memberships).toHaveLength(1);
		expect(memberships[0]!.role).toBe('owner');
	});

	test('it is idempotent, because it runs on every login', async () => {
		const owner = await newOwner('team-idempotent');

		// The auth worker calls this each time somebody signs in, not only when
		// the user is created — that is what backfills accounts made before the
		// call existed. A second call must not mint a second team.
		const again = await Actor.with(
			{ type: 'user', properties: { userID: owner.userId, linkedAccountID: owner.linkedAccountId } },
			() => Team.ensurePersonal({ displayName: 'team-idempotent' })
		);

		expect(again).toBe(owner.teamId);
		const rows = await sql`select count(*)::int as n from team where owner_id = ${owner.userId}`;
		expect(rows[0]!.n).toBe(1);
	});

	test('a user who predates the personal team gets one on next login', async () => {
		// The legacy row the migration and this call between them repair: a user
		// created by Steam sign-in before `ensurePersonal` was ever wired up.
		const userId = Identifier.ascending('user');
		createdUserIds.push(userId);
		await sql`insert into "user" (id, name, email) values (${userId}, ${'legacy'}, ${`legacy-${userId}@example.test`})`;

		expect(await Team.personalFor(userId)).toBeNull();

		const teamId = await Actor.with(
			{ type: 'user', properties: { userID: userId, linkedAccountID: 'lac_unused' } },
			() => Team.ensurePersonal({ displayName: 'legacy' })
		);

		expect(teamId).toBeTruthy();
		expect((await Team.personalFor(userId))?.id).toBe(teamId);
	});

	test('two users with the same display name get distinct slugs', async () => {
		const a = await newOwner('same-name');
		const b = await newOwner('same-name');

		const teamA = await Team.personalFor(a.userId);
		const teamB = await Team.personalFor(b.userId);
		expect(teamA!.slug).not.toBe(teamB!.slug);
	});
});
