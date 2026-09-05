/**
 * Where the issuer's signing and encryption keys live.
 *
 * These are the only records here that are meant to outlive everything else:
 * every token this issuer has ever minted is verifiable only for as long as
 * the public half is still published, so losing this store invalidates every
 * session at once. That is the whole reason it is an interface — a store that
 * a deployment can point at its own database, rather than at whatever
 * key-value service the runtime happened to offer.
 *
 * Writes are append-only and rare: a key is created when no unexpired one of
 * its kind exists, and retired by being marked expired rather than removed, so
 * tokens it signed stay verifiable until they age out on their own.
 *
 * @packageDocumentation
 */

import type { StorageAdapter } from './storage/storage.js';
import { Storage } from './storage/storage.js';

/** Which half of the issuer's key material a record belongs to. */
export type KeyKind = 'signing' | 'encryption';

/**
 * A key pair as stored: PEM text rather than a live key object.
 *
 * Kept serialized because the store is a database and not a process — the
 * import back into a usable key happens in {@link ./keys.js}, once per issuer
 * instance.
 */
export interface StoredKey {
	id: string;
	publicKey: string;
	privateKey: string;
	alg: string;
	/** Epoch ms. */
	created: number;
	/** Epoch ms, set when the key is retired. Absent while it is still in use. */
	expired?: number;
}

export interface KeyStore {
	/** Every key of a kind, expired ones included. Order does not matter. */
	list(kind: KeyKind): Promise<StoredKey[]>;

	/**
	 * Add a key, unless the kind already has a live one.
	 *
	 * A store that lets two live keys of one kind exist at the same time
	 * breaks things that are hard to see. Two issuers starting against an empty
	 * store both find nothing, both generate a key, and from then on each signs
	 * and encrypts with its own: a session cookie written by one is
	 * undecryptable to the other, and an access token minted by one is rejected
	 * by the other as invalid — because both reach for a single key rather than
	 * trying the published set. Losing the second write is the whole point, so
	 * this is not an error and reports nothing; the caller reads the list again
	 * and uses whichever key survived.
	 *
	 * Retiring a key and creating its replacement therefore have to happen
	 * together, so that the kind never has two live keys and never has none.
	 */
	create(kind: KeyKind, key: StoredKey): Promise<void>;
}

/** The storage prefix a kind's keys have always been written under. */
function prefix(kind: KeyKind): string {
	return kind === 'signing' ? 'signing:key' : 'encryption:key';
}

/**
 * A key store backed by the generic {@link StorageAdapter}.
 *
 * The default, and what every deployment used before `keyStore` existed — the
 * keys are read and written under exactly the prefixes they always were, so an
 * issuer that does not pass a store keeps finding the keys it already had.
 *
 * It cannot honour the one-live-key rule `create` asks for: through get and
 * set there is no way to make "write unless one exists" a single operation.
 * Two issuers bootstrapping against an empty store at the same moment will
 * therefore end up with a key each, with the consequences described above. A
 * store that can express a conditional write does not have this problem, and
 * is what a deployment running more than one instance wants.
 */
export function StorageKeyStore(storage: StorageAdapter): KeyStore {
	return {
		async list(kind) {
			const results: StoredKey[] = [];
			for await (const [, value] of Storage.scan<StoredKey>(storage, [prefix(kind)])) {
				results.push(value);
			}
			return results;
		},
		async create(kind, key) {
			await Storage.set(storage, [prefix(kind), key.id], key);
		}
	};
}
