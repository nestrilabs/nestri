import { afterAll, describe, expect, test } from 'bun:test';

import { Fixtures } from '../db/fixtures.js';
import { testDb } from '../db/test.js';
import { SteamLinkRequest } from './link-request.js';

const sql = testDb();
const createdUserIds: string[] = [];

afterAll(async () => {
	if (createdUserIds.length > 0) {
		await sql`delete from "user" where id in ${sql(createdUserIds)}`;
	}
});

const RETURN_TO = 'https://api.example.test/steam/link/callback?state=abc';
const ID = '76561198000000001';

/** An assertion as Steam sends it back, for `ID`, to `RETURN_TO`. */
function assertion(overrides: Record<string, string> = {}) {
	return {
		'openid.ns': 'http://specs.openid.net/auth/2.0',
		'openid.mode': 'id_res',
		'openid.op_endpoint': SteamLinkRequest.OPENID,
		'openid.claimed_id': `https://steamcommunity.com/openid/id/${ID}`,
		'openid.identity': `https://steamcommunity.com/openid/id/${ID}`,
		'openid.return_to': RETURN_TO,
		'openid.response_nonce': '2026-10-07T08:00:00Zabc',
		'openid.assoc_handle': '1234567890',
		'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
		'openid.sig': 'c2lnbmF0dXJl',
		...overrides
	};
}

function steamSays(valid: boolean) {
	const calls: string[] = [];
	const check = (async (_url: string, init: RequestInit) => {
		calls.push(String(init.body));
		return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`);
	}) as unknown as typeof fetch;
	return { check, calls };
}

describe('Verifying a Steam sign-in', () => {
	test('an assertion Steam confirms proves the id in its claimed identity', async () => {
		const steam = steamSays(true);
		expect(await SteamLinkRequest.verify(assertion(), RETURN_TO, steam.check)).toBe(ID);
		expect(steam.calls[0]).toContain('openid.mode=check_authentication');
	});

	test('one Steam does not confirm proves nothing', async () => {
		expect(
			await SteamLinkRequest.verify(assertion(), RETURN_TO, steamSays(false).check)
		).toBeNull();
	});

	test('one issued for somewhere else is refused before Steam is asked', async () => {
		const steam = steamSays(true);
		const other = assertion({ 'openid.return_to': 'https://evil.example/cb' });
		expect(await SteamLinkRequest.verify(other, RETURN_TO, steam.check)).toBeNull();
		expect(steam.calls).toEqual([]);
	});

	test('a claimed id not in Steam’s shape is refused', async () => {
		const steam = steamSays(true);
		for (const claimed of [
			`https://steamcommunity.com.evil/openid/id/${ID}`,
			`http://steamcommunity.com/openid/id/${ID}`,
			'https://steamcommunity.com/openid/id/123'
		]) {
			const forged = assertion({ 'openid.claimed_id': claimed, 'openid.identity': claimed });
			expect(await SteamLinkRequest.verify(forged, RETURN_TO, steam.check)).toBeNull();
		}
	});

	test('another provider’s endpoint is refused', async () => {
		const forged = assertion({ 'openid.op_endpoint': 'https://openid.evil/login' });
		expect(await SteamLinkRequest.verify(forged, RETURN_TO, steamSays(true).check)).toBeNull();
	});
});

describe('A link request', () => {
	test('works once', async () => {
		const owner = await Fixtures.owner('steam-link');
		createdUserIds.push(owner.userId);
		const nonce = await SteamLinkRequest.create(owner.userId);
		expect(await SteamLinkRequest.consume(nonce)).toBe(owner.userId);
		expect(await SteamLinkRequest.consume(nonce)).toBeNull();
	});

	test('expires', async () => {
		const owner = await Fixtures.owner('steam-link-old');
		createdUserIds.push(owner.userId);
		const nonce = await SteamLinkRequest.create(owner.userId);
		await sql`update steam_link_request set expires_at = now() - interval '1 minute' where user_id = ${owner.userId}`;
		expect(await SteamLinkRequest.consume(nonce)).toBeNull();
	});

	test('the sign-in URL sends Steam back to exactly the callback', () => {
		const url = new URL(SteamLinkRequest.signInUrl(RETURN_TO));
		expect(url.origin + url.pathname).toBe(SteamLinkRequest.OPENID);
		expect(url.searchParams.get('openid.return_to')).toBe(RETURN_TO);
		expect(url.searchParams.get('openid.realm')).toBe('https://api.example.test');
	});
});
