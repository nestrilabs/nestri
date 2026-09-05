/**
 * Where an authorization code lives between the redirect and the exchange.
 *
 * A code is handed to a browser in a URL and presented back within a minute,
 * and it must be redeemable exactly once. That last part is the whole reason
 * this is an interface: taking the record away and reading it have to be the
 * same operation, because a get, a decision and a remove lets two exchanges
 * arriving together both be served — and each of them mints a full session.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from './storage/storage.js';
import { Storage } from './storage/storage.js';
import { sha256hex } from './util.js';

/** What the code stands for, recorded when it is issued. */
export interface AuthorizationCodeRecord {
	type: string;
	properties: any;
	subject: string;
	clientID: string;
	redirectURI: string;
	ttl: { access: number; refresh: number };
	pkce?: { challenge: string; method: 'S256' };
}

export interface CodeStore {
	create(codeHash: string, record: AuthorizationCodeRecord, ttl: number): Promise<void>;

	/**
	 * Take the record away and return it, or return null.
	 *
	 * Removal and reading are one operation on purpose. Two exchanges of the
	 * same code must not both be answered, and a caller cannot arrange that by
	 * reading first — so it is not offered a way to.
	 */
	consume(codeHash: string): Promise<AuthorizationCodeRecord | null>;
}

/**
 * The hash a code is stored under.
 *
 * An authorization code is a bearer credential that travels in a query string,
 * which means it lands in browser history, in referrer headers and in whatever
 * logs the redirect passed through. What is kept here is enough to recognise
 * one and not enough to present it.
 */
export function hashAuthorizationCode(code: string): Promise<string> {
	return sha256hex(code);
}

/**
 * A code store backed by the generic {@link StorageAdapter}.
 *
 * The default, and the behaviour every deployment had before `codeStore`
 * existed — including its weakness: `get` and `remove` are two operations, so
 * this cannot actually promise single use. It is kept because a store that
 * only does get and set cannot do better, and an issuer that wants the promise
 * passes one that can.
 */
export function StorageCodeStore(storage: StorageAdapter): CodeStore {
	return {
		async create(codeHash, record, ttl) {
			await Storage.set(storage, ['oauth:code', codeHash], record, ttl);
		},
		async consume(codeHash) {
			const key = ['oauth:code', codeHash];
			const record = await Storage.get<AuthorizationCodeRecord>(storage, key);
			if (!record) return null;
			await Storage.remove(storage, key);
			return record;
		}
	};
}
