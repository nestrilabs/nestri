import { randomBytes } from 'node:crypto';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { SteamLinkRequestTable } from './link-request.sql.js';

/**
 * Proving a Steam account is yours, by signing in to Steam.
 *
 * A Steam id is public — anyone can read one off a profile page — so a link
 * that took an id on trust would let anybody claim any account, and with it
 * that account's library and its one free weekend. The only proof accepted is
 * Steam's own: an OpenID assertion that Steam itself confirms, for a sign-in
 * that this site started.
 */
export namespace SteamLinkRequest {
	export const OPENID = 'https://steamcommunity.com/openid/login';
	const TTL_MINUTES = 10;
	const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

	async function digest(value: string): Promise<string> {
		const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
		return Array.from(new Uint8Array(d))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
	}

	/** Start a link for `userId`. The nonce goes in the callback URL and nowhere else. */
	export const create = fn(z.string(), async (userId) => {
		const nonce = randomBytes(24).toString('base64url');
		const nonceHash = await digest(nonce);
		await Database.use((tx) =>
			tx.insert(SteamLinkRequestTable).values({
				id: Identifier.ascending('steamLinkRequest'),
				userId,
				nonceHash,
				expiresAt: sql`now() + interval '${sql.raw(String(TTL_MINUTES))} minutes'`
			})
		);
		return nonce;
	});

	/** The URL that sends a person to Steam, coming back to `returnTo`. */
	export function signInUrl(returnTo: string): string {
		const realm = new URL(returnTo).origin;
		const params = new URLSearchParams({
			'openid.ns': 'http://specs.openid.net/auth/2.0',
			'openid.mode': 'checkid_setup',
			'openid.return_to': returnTo,
			'openid.realm': realm,
			'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
			'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
		});
		return `${OPENID}?${params}`;
	}

	/**
	 * The Steam id an assertion proves, or null.
	 *
	 * Three checks, each closing a different hole: Steam confirms the
	 * signature (`check_authentication`), so the parameters were not made up;
	 * the assertion was issued for exactly this callback, so one minted for
	 * another site cannot be replayed here; and the id is read only from the
	 * claimed identity URL, in the one shape Steam issues.
	 */
	export async function verify(
		params: Record<string, string>,
		expectedReturnTo: string,
		check: typeof fetch = fetch
	): Promise<string | null> {
		if (params['openid.mode'] !== 'id_res') return null;
		if (params['openid.op_endpoint'] !== OPENID) return null;
		if (params['openid.return_to'] !== expectedReturnTo) return null;
		const claimed = CLAIMED_ID.exec(params['openid.claimed_id'] ?? '');
		if (!claimed || params['openid.identity'] !== params['openid.claimed_id']) return null;

		const res = await check(OPENID, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ ...params, 'openid.mode': 'check_authentication' })
		});
		const text = await res.text();
		return /^is_valid:true$/m.test(text) ? claimed[1]! : null;
	}

	/** Spend a nonce: the user it was for, once, while it is fresh. */
	export const consume = fn(z.string(), async (nonce) => {
		const nonceHash = await digest(nonce);
		return Database.use((tx) =>
			tx
				.update(SteamLinkRequestTable)
				.set({ usedAt: sql`now()` })
				.where(
					and(
						eq(SteamLinkRequestTable.nonceHash, nonceHash),
						isNull(SteamLinkRequestTable.usedAt),
						gt(SteamLinkRequestTable.expiresAt, sql`now()`)
					)
				)
				.returning({ userId: SteamLinkRequestTable.userId })
				.then((rows) => rows.at(0)?.userId ?? null)
		);
	});
}
