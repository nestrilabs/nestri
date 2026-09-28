import { afterAll, describe, expect, test } from 'bun:test';

import { AccessToken } from '@nestri/core/access-token/index';
import { Fixtures } from '@nestri/core/db/fixtures';
import { testDb } from '@nestri/core/db/test';
import { Identifier } from '@nestri/core/id';
import { Member } from '@nestri/core/team/member';

import { app } from '../app/index';
import './setup';

const sql = testDb();
const createdUserIds: string[] = [];

async function person(label: string) {
	const owner = await Fixtures.owner(label);
	createdUserIds.push(owner.userId);
	const pat = await AccessToken.create({
		id: Identifier.ascending('accessToken'),
		ownerUserId: owner.userId,
		teamId: null,
		name: label
	});
	return {
		...owner,
		headers: { authorization: `Bearer ${pat.token}`, 'content-type': 'application/json' }
	};
}

function rename(who: { headers: Record<string, string> }, teamId: string, body: unknown) {
	return app.request(`/team/${teamId}`, {
		method: 'PATCH',
		headers: who.headers,
		body: JSON.stringify(body)
	});
}

/** Unique per run, so a slug from a previous run never collides. */
const slug = (s: string) => `${s}-${Identifier.ascending('team').slice(-8).toLowerCase()}`;

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
	}
});

describe('GET /team', () => {
	test('lists your personal team, with your role on it', async () => {
		const me = await person('team-list');
		const res = await app.request('/team', { headers: me.headers });
		expect(res.status).toBe(200);
		const { data } = (await res.json()) as any;
		expect(data).toHaveLength(1);
		expect(data[0]).toMatchObject({ id: me.teamId, role: 'owner' });
	});
});

describe('PATCH /team/:id', () => {
	test('an owner renames name and slug', async () => {
		const me = await person('team-rename');
		const s = slug('renamed');
		const res = await rename(me, me.teamId, { name: 'Renamed', slug: s });
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).data).toMatchObject({ name: 'Renamed', slug: s });
	});

	test("someone else's team is a 404, not a 403", async () => {
		const me = await person('team-probe');
		const them = await person('team-probed');
		const res = await rename(me, them.teamId, { name: 'Mine now' });
		expect(res.status).toBe(404);
	});

	test('a plain member cannot rename', async () => {
		const owner = await person('team-owner');
		const member = await person('team-member');
		await Member.create({
			id: Identifier.ascending('teamMember'),
			teamId: owner.teamId,
			userId: member.userId,
			role: 'member'
		});
		const res = await rename(member, owner.teamId, { name: 'Coup' });
		expect(res.status).toBe(403);
	});

	test('a taken slug is a 409 on the slug', async () => {
		const a = await person('team-slug-a');
		const b = await person('team-slug-b');
		const s = slug('taken');
		expect((await rename(a, a.teamId, { slug: s })).status).toBe(200);
		const res = await rename(b, b.teamId, { slug: s });
		expect(res.status).toBe(409);
		expect(((await res.json()) as any).param).toBe('slug');
	});

	test('a malformed slug is refused before it reaches the database', async () => {
		const me = await person('team-bad-slug');
		expect((await rename(me, me.teamId, { slug: 'Not A Slug' })).status).toBe(400);
		expect((await rename(me, me.teamId, {})).status).toBe(400);
	});
});

describe('GET /team/:id/members', () => {
	test('names the people on your team, and nobody can list a team they are not on', async () => {
		const me = await person('team-people');
		const other = await person('team-people-other');
		const res = await app.request(`/team/${me.teamId}/members`, { headers: me.headers });
		expect(res.status).toBe(200);
		const { data } = (await res.json()) as any;
		expect(data).toEqual([
			expect.objectContaining({ userId: me.userId, role: 'owner', name: 'team-people' })
		]);
		const refused = await app.request(`/team/${other.teamId}/members`, { headers: me.headers });
		expect(refused.status).toBe(404);
	});
});

describe('GET /box', () => {
	test('a person with no boxes gets an empty list', async () => {
		const me = await person('box-none');
		const res = await app.request('/box', { headers: me.headers });
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).data).toEqual([]);
	});
});

describe('POST /team', () => {
	test('creates a second team with you as owner, listed after your personal one', async () => {
		const me = await person('team-create');
		const s = slug('second');
		const res = await app.request('/team', {
			method: 'POST',
			headers: me.headers,
			body: JSON.stringify({ name: 'Second', slug: s })
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).data).toMatchObject({
			name: 'Second',
			slug: s,
			role: 'owner'
		});
		const list = ((await (await app.request('/team', { headers: me.headers })).json()) as any).data;
		expect(list.map((t: any) => t.slug)).toEqual([expect.any(String), s]);
		expect(list[0].id).toBe(me.teamId);
	});

	test('a taken slug is a 409, and a page of the site is a 400', async () => {
		const me = await person('team-create-taken');
		const s = slug('dupe');
		const post = (body: unknown) =>
			app.request('/team', { method: 'POST', headers: me.headers, body: JSON.stringify(body) });
		expect((await post({ name: 'A', slug: s })).status).toBe(200);
		expect((await post({ name: 'B', slug: s })).status).toBe(409);
		expect((await post({ name: 'C', slug: 'pricing' })).status).toBe(400);
	});
});
