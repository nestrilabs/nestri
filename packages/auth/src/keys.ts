import {
	exportJWK,
	exportPKCS8,
	exportSPKI,
	generateKeyPair,
	importPKCS8,
	importSPKI,
	JWK,
	KeyLike
} from 'jose';

import type { KeyKind, KeyStore, StoredKey } from './key.js';

const alg: Record<KeyKind, string> = {
	signing: 'ES256',
	encryption: 'RSA-OAEP-512'
};

export interface KeyPair {
	id: string;
	alg: string;
	public: KeyLike;
	private: KeyLike;
	created: Date;
	expired?: Date;
	jwk: JWK;
}

async function toKeyPair(kind: KeyKind, stored: StoredKey): Promise<KeyPair> {
	// The algorithm is read off the record rather than assumed, because a key
	// outlives the decision that produced it: rotating to a new algorithm has
	// to leave the old keys verifiable until the tokens they signed expire.
	const publicKey = await importSPKI(stored.publicKey, stored.alg, { extractable: true });
	const privateKey = await importPKCS8(stored.privateKey, stored.alg);
	const jwk = await exportJWK(publicKey);
	jwk.kid = stored.id;
	if (kind === 'signing') jwk.use = 'sig';
	return {
		id: stored.id,
		alg: stored.alg,
		created: new Date(stored.created),
		expired: stored.expired ? new Date(stored.expired) : undefined,
		public: publicKey,
		private: privateKey,
		jwk
	};
}

/**
 * Every key of a kind, newest first, creating one if none is usable.
 *
 * Expired keys are returned alongside live ones and sorted after them, so the
 * first entry is the one that signs. Publishing the rest is what lets a
 * verifier reading the JWKS still check a token signed before a rotation.
 *
 * A store may refuse the write, and is expected to when another issuer has
 * already created a key for this kind — see the note on {@link KeyStore.create}
 * about why two live keys of one kind is not a state this can be left in. So
 * the created key is never returned directly: the list is read again, and
 * whichever key the store actually kept is the one everybody uses.
 */
async function keysOf(store: KeyStore, kind: KeyKind, bootstrapped = false): Promise<KeyPair[]> {
	const stored = await store.list(kind);
	const results = await Promise.all(stored.map((k) => toKeyPair(kind, k)));
	results.sort((a, b) => b.created.getTime() - a.created.getTime());
	if (results.some((item) => !item.expired)) return results;

	// One attempt, and then an error rather than another try. A store that
	// accepts neither the write nor another issuer's would otherwise spin here
	// forever, and a request that hangs is a worse way to learn about it than
	// a request that fails.
	if (bootstrapped) {
		throw new Error(`Unable to create a ${kind} key: the store reports none after writing one.`);
	}

	const key = await generateKeyPair(alg[kind], { extractable: true });
	const created: StoredKey = {
		id: crypto.randomUUID(),
		publicKey: await exportSPKI(key.publicKey),
		privateKey: await exportPKCS8(key.privateKey),
		created: Date.now(),
		alg: alg[kind]
	};
	await store.create(kind, created);
	return keysOf(store, kind, true);
}

export function signingKeys(store: KeyStore): Promise<KeyPair[]> {
	return keysOf(store, 'signing');
}

export function encryptionKeys(store: KeyStore): Promise<KeyPair[]> {
	return keysOf(store, 'encryption');
}
