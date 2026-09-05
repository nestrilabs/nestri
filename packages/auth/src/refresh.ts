/**
 * Where refresh tokens live, and how one is spent.
 *
 * A refresh token is the longest-lived credential this issuer hands out, and
 * the only one whose record is written once and read months later. Two things
 * follow, and both are why this is an interface rather than a pair of get and
 * set calls.
 *
 * The first is that spending a token has to happen exactly once. Reuse
 * detection works by remembering *when* a token was first spent, so the moment
 * that is recorded must be the same operation as the check that it had not
 * been recorded already. Read it, compare, write it back, and two refreshes
 * arriving together both look like the first one — which is precisely the case
 * reuse detection exists to catch.
 *
 * The second is that a token is a bearer credential, so the store is asked for
 * a hash and never the token itself. See {@link hashRefreshToken}.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from './storage/storage.js';
import { Storage } from './storage/storage.js';
import { sha256hex } from './util.js';

/** What a refresh token stands for. */
export interface RefreshRecord {
	type: string;
	properties: any;
	subject: string;
	clientID: string;
	ttl: { access: number; refresh: number };
	/**
	 * The token that replaces this one, chosen when this one was issued.
	 *
	 * Reserved in advance so that two refreshes inside the reuse window are
	 * answered with the same token rather than racing to mint different ones.
	 *
	 * Note what this means for a store that leaks: the successor is readable
	 * before it is issued. It is not usable until the holder actually refreshes
	 * — nothing is stored under it before then — but from that moment the
	 * successor is known. That is inherited from the token scheme rather than
	 * from where it is kept, and it is the reason the record's *own* token is
	 * still only ever stored as a hash.
	 */
	nextToken?: string;
	/** Epoch ms the token was first spent. Absent until it has been. */
	timeUsed?: number;
}

/** What spending a token turned out to be. */
export type RefreshClaim =
	| { status: 'missing' }
	/** It had not been spent before. This caller is the one that spent it. */
	| { status: 'fresh'; record: RefreshRecord }
	/** It had been spent already, at `timeUsed`. Whether that is allowed is the caller's arithmetic. */
	| { status: 'reused'; record: RefreshRecord; timeUsed: number };

export interface RefreshStore {
	create(
		subject: string,
		tokenHash: string,
		record: RefreshRecord,
		ttl: number
	): Promise<void>;

	/**
	 * Spend a token, in one operation.
	 *
	 * `retainFor` is how many seconds a spent record should be kept so that
	 * reuse can be recognised. Zero means reuse is not tolerated at all, and
	 * the record is taken away instead of marked — so `fresh` is still the only
	 * answer any one caller can get, and every later attempt reads `missing`.
	 *
	 * The caller must not decide any of this by reading first.
	 */
	claim(
		subject: string,
		tokenHash: string,
		at: number,
		retainFor: number
	): Promise<RefreshClaim>;

	/** Every token belonging to a subject, for when reuse is detected. */
	removeSubject(subject: string): Promise<void>;
}

/**
 * The hash a refresh token is stored under.
 *
 * The token is what its holder presents to be issued a session, so anything
 * that can read the store could otherwise resume every session in it. What is
 * kept is enough to recognise a token and not enough to present one.
 */
export function hashRefreshToken(token: string): Promise<string> {
	return sha256hex(token);
}

/**
 * A refresh store backed by the generic {@link StorageAdapter}.
 *
 * The default, and what every deployment had before `refreshStore` existed.
 * `claim` here is a get followed by a set, which is the race described at the
 * top of this file — unavoidable through an interface that offers only whole
 * records, and the reason an issuer that cares passes a store that can do it
 * in one statement.
 */
export function StorageRefreshStore(storage: StorageAdapter): RefreshStore {
	const key = (subject: string, tokenHash: string) => ['oauth:refresh', subject, tokenHash];

	return {
		async create(subject, tokenHash, record, ttl) {
			await Storage.set(storage, key(subject, tokenHash), record, ttl);
		},

		async claim(subject, tokenHash, at, retainFor) {
			const k = key(subject, tokenHash);
			const record = await Storage.get<RefreshRecord>(storage, k);
			if (!record) return { status: 'missing' };
			if (record.timeUsed) return { status: 'reused', record, timeUsed: record.timeUsed };
			if (retainFor <= 0) {
				await Storage.remove(storage, k);
			} else {
				await Storage.set(storage, k, { ...record, timeUsed: at }, retainFor);
			}
			return { status: 'fresh', record };
		},

		async removeSubject(subject) {
			// Resolved before removing, in case modifying the store while
			// iterating it interferes with the scan.
			const keys = await Array.fromAsync(Storage.scan(storage, ['oauth:refresh', subject]));
			for (const [k] of keys) {
				await Storage.remove(storage, k);
			}
		}
	};
}
