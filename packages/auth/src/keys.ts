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
		alg: alg[kind],
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
 * Expired keys are returned alongside live ones and sorted after them: the
 * first entry is what signs, and the rest are what still verifies. Retiring a
 * key therefore does not invalidate the tokens it signed — they age out on
 * their own — which is the only way a rotation is not also a mass sign-out.
 */
async function keysOf(store: KeyStore, kind: KeyKind): Promise<KeyPair[]> {
	const stored = await store.list(kind);
	const results = await Promise.all(stored.map((k) => toKeyPair(kind, k)));
	results.sort((a, b) => b.created.getTime() - a.created.getTime());
	if (results.some((item) => !item.expired)) return results;

	const key = await generateKeyPair(alg[kind], { extractable: true });
	const created: StoredKey = {
		id: crypto.randomUUID(),
		publicKey: await exportSPKI(key.publicKey),
		privateKey: await exportPKCS8(key.privateKey),
		created: Date.now(),
		alg: alg[kind]
	};
	await store.create(kind, created);
	// Read back rather than returning what was just built, so that two issuers
	// starting at once converge on whichever key the store actually kept.
	return keysOf(store, kind);
}

export function signingKeys(store: KeyStore): Promise<KeyPair[]> {
	return keysOf(store, 'signing');
}

export function encryptionKeys(store: KeyStore): Promise<KeyPair[]> {
	return keysOf(store, 'encryption');
}
