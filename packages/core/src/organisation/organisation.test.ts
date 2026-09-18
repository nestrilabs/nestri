import { afterAll, describe, expect, test } from 'bun:test';

import { Actor } from '../actor.js';
import { testDb } from '../db/test.js';
import { Identifier } from '../id.js';
import { Machine } from '../machine/index.js';
import { User } from '../user/index.js';
import { Organisation } from './index.js';

const sql = testDb();

const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

/** A user with an address, verified or not, and nothing else attached. */
async function newUser(label: string, email: string | null, emailVerified: boolean) {
	const userId = Identifier.ascending('user');
	await User.create({ id: userId, name: label, email, emailVerified, image: null });
	createdUserIds.push(userId);
	return userId;
}

async function newOrg(label: string, domain: string, domainVerified: boolean) {
	const id = Identifier.ascending('organisation');
	await Organisation.create({
		id,
		name: label,
		slug: `${label}-${id.slice(-6)}`,
		domain,
		domainVerified
	});
	createdOrgIds.push(id);
	return id;
}

afterAll(async () => {
	// Machines reference organisations with `restrict`, so the fleet has to go
	// before the organisation that owns it.
	if (createdOrgIds.length > 0) {
		await sql`delete from "machine" where organisation_id in ${sql(createdOrgIds)}`;
	}
	if (createdUserIds.length > 0) {
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
		createdUserIds.length = 0;
	}
	if (createdOrgIds.length > 0) {
		await sql`delete from "organisation" where id in ${sql(createdOrgIds)}`;
		createdOrgIds.length = 0;
	}
});

describe('Organisation membership', () => {
	test('a verified address on a verified domain is membership', async () => {
		const orgId = await newOrg('org-member', 'member.example', true);
		const userId = await newUser('member', 'someone@member.example', true);

		const found = await Organisation.forUser(userId);
		expect(found?.id).toBe(orgId);
	});

	test('an unverified domain grants nothing', async () => {
		// Anyone can type a domain into a row. Until it is shown to be theirs,
		// honouring it would hand them every account on it.
		await newOrg('org-unverified', 'unverified.example', false);
		const userId = await newUser('unverified', 'someone@unverified.example', true);

		expect(await Organisation.forUser(userId)).toBeNull();
	});

	test('an unverified address is not membership either', async () => {
		// The address is a string somebody typed until the code has been
		// entered, and the domain half is no more trustworthy than the rest.
		await newOrg('org-bothends', 'bothends.example', true);
		const userId = await newUser('bothends', 'someone@bothends.example', false);

		expect(await Organisation.forUser(userId)).toBeNull();
	});

	test('a personal address belongs to no organisation, and that is not an error', async () => {
		await newOrg('org-personal', 'personal-co.example', true);
		const userId = await newUser('personal', 'someone@gmail.example', true);

		expect(await Organisation.forUser(userId)).toBeNull();
	});

	test('the domain match ignores case, because addresses do', async () => {
		const orgId = await newOrg('org-case', 'case.example', true);
		const userId = await newUser('case', 'Someone@CASE.example', true);

		expect((await Organisation.forUser(userId))?.id).toBe(orgId);
	});
});

describe('domainOf', () => {
	test('takes the domain half, lower-cased', () => {
		expect(Organisation.domainOf('Someone@Example.COM')).toBe('example.com');
	});

	test('refuses anything that is not one address', () => {
		// Every caller uses the answer to decide membership, so a best guess at
		// a malformed address is the wrong kind of helpful.
		for (const bad of [
			'',
			null,
			undefined,
			'no-at-sign',
			'two@at@signs',
			'@nolocal',
			'nodomain@'
		]) {
			expect(Organisation.domainOf(bad)).toBeNull();
		}
	});
});

describe('Fleet hardware', () => {
	test('a host an organisation owns has no owner and no team', async () => {
		const orgId = await newOrg('org-fleet', 'fleet.example', true);
		const registered = await Machine.register({
			id: Identifier.ascending('machine'),
			ownerUserId: null,
			teamId: null,
			organisationId: orgId,
			label: 'fleet-card'
		});

		const machine = await Machine.fromID(registered.id);
		expect(machine?.organisationId).toBe(orgId);
		expect(machine?.ownerUserId).toBeNull();
		expect(machine?.teamId).toBeNull();
	});

	test('hardware belongs to a team or an organisation, never both and never neither', async () => {
		const orgId = await newOrg('org-either', 'either.example', true);

		// `fn()` parses synchronously, so a bad argument never becomes a
		// rejected promise.
		expect(() =>
			Machine.register({
				id: Identifier.ascending('machine'),
				ownerUserId: null,
				teamId: null,
				label: 'ownerless'
			})
		).toThrow();

		expect(() =>
			Machine.register({
				id: Identifier.ascending('machine'),
				ownerUserId: null,
				teamId: 'tem_whatever',
				organisationId: orgId,
				label: 'doubly-owned'
			})
		).toThrow();
	});

	test('the fleet lists separately from anybody’s own hardware', async () => {
		const orgId = await newOrg('org-list', 'list.example', true);
		const registered = await Machine.register({
			id: Identifier.ascending('machine'),
			ownerUserId: null,
			teamId: null,
			organisationId: orgId,
			label: 'listed-card'
		});

		const fleet = await Machine.listByOrganisation(orgId);
		expect(fleet.map((m) => m.id)).toContain(registered.id);
	});

	test('fleet hardware survives the account that registered it', async () => {
		// The whole reason the column is nullable. It used to cascade, so
		// deleting whoever ran the command deleted the machine.
		const orgId = await newOrg('org-survives', 'survives.example', true);
		const userId = await newUser('survives', 'admin@survives.example', true);
		const registered = await Actor.with(
			{ type: 'user', properties: { userID: userId, linkedAccountID: '' } },
			async () =>
				Machine.register({
					id: Identifier.ascending('machine'),
					ownerUserId: null,
					teamId: null,
					organisationId: orgId,
					label: 'outlives-me'
				})
		);

		await sql`delete from "user" where id = ${userId}`;
		createdUserIds.splice(createdUserIds.indexOf(userId), 1);

		expect((await Machine.fromID(registered.id))?.organisationId).toBe(orgId);
	});
});

describe('Entitlement on fleet hardware', () => {
	test('nobody is entitled yet, and the reason says why', async () => {
		// What grants a run on metered hardware is a plan, and there is nothing
		// to ask yet — so this fails closed rather than giving it away.
		const orgId = await newOrg('org-entitle', 'entitle.example', true);
		const userId = await newUser('entitle', 'someone@entitle.example', true);
		const registered = await Machine.register({
			id: Identifier.ascending('machine'),
			ownerUserId: null,
			teamId: null,
			organisationId: orgId,
			label: 'metered'
		});

		const answer = await Machine.entitlement({ machineId: registered.id, userId });
		expect(answer).toEqual({ entitled: false, reason: 'fleet' });
	});
});
