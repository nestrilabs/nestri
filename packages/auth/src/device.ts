/**
 * Where a device authorization grant lives while nobody has answered for it.
 *
 * This is an interface and not an implementation because the guarantees it
 * asks for are the whole point. A grant moves between states that must each
 * happen once — pending to approved, approved to redeemed — while two parties
 * are touching it at the same time: a browser somebody is clicking through,
 * and a program on another machine polling every few seconds. Held in a store
 * that can only get and put whole records, those two overlap and undo each
 * other. Every method below is written so that the store can make it one
 * operation, and the issuer never reads a record, decides, and writes it back.
 *
 * @packageDocumentation
 */

import { sha256hex } from './util.js';

/** How far a grant has got. Terminal in both directions once it leaves pending. */
export type DeviceGrantStatus = 'pending' | 'approved' | 'denied';

/**
 * Who the grant turned out to be for, recorded when it is approved.
 *
 * The tokens themselves are deliberately not here. They are minted when the
 * waiting program redeems the code, so their lifetime starts when they are
 * handed over rather than whenever the person happened to finish clicking —
 * and so a grant nobody collects leaves no usable credential behind.
 */
export interface DeviceGrantSubject {
	subject: string;
	type: string;
	properties: unknown;
	ttl: { access: number; refresh: number };
}

export interface DeviceGrant {
	/** The hash of the device code, never the code itself. */
	deviceCodeHash: string;
	userCode: string;
	clientID: string;
	status: DeviceGrantStatus;
	/** Seconds the client is being told to wait between polls. Only grows. */
	interval: number;
	/** Epoch ms of the last poll that got a real answer; `0` if there has been none. */
	lastPolled: number;
	/** Epoch ms at which the grant stops being usable. */
	expires: number;
	subject?: DeviceGrantSubject;
}

export interface DeviceStore {
	create(grant: DeviceGrant): Promise<void>;
	byDeviceCode(deviceCodeHash: string): Promise<DeviceGrant | null>;
	byUserCode(userCode: string): Promise<DeviceGrant | null>;

	/**
	 * Pending to approved, in one operation.
	 *
	 * Returns false when the grant was not pending any more, which is how a
	 * refusal that arrived first survives an approval that arrives second, and
	 * the other way round. The caller must not decide this by reading first.
	 */
	approve(deviceCodeHash: string, subject: DeviceGrantSubject): Promise<boolean>;

	/** Pending to denied, in one operation. Same rule as {@link approve}. */
	deny(deviceCodeHash: string): Promise<boolean>;

	/**
	 * Take an approved grant away and return it, or return null.
	 *
	 * This is what makes a device code redeemable once. Two polls arriving
	 * together must not both be served, so removal and reading have to be the
	 * same operation — a read, a decision and a delete would serve both.
	 */
	consume(deviceCodeHash: string, clientID: string): Promise<DeviceGrant | null>;

	/**
	 * Record that a poll happened, and what interval it was told to use.
	 *
	 * Touches those two fields and nothing else, on purpose. Writing the whole
	 * record back here is what lets a poll that read a pending grant undo an
	 * approval that landed while it was thinking.
	 */
	recordPoll(deviceCodeHash: string, at: number, interval: number): Promise<void>;

	remove(deviceCodeHash: string): Promise<void>;
}

/**
 * The hash a device code is stored under.
 *
 * A device code is a bearer credential: whoever holds it collects the tokens.
 * Storing it as written means anything that can read the table can finish
 * somebody else's sign-in, so what is kept is enough to recognise the code and
 * not enough to present it.
 */
export async function hashDeviceCode(deviceCode: string): Promise<string> {
	return sha256hex(deviceCode);
}

/**
 * A store in a single process's memory, for tests and local runs.
 *
 * Single-threaded JavaScript gives the atomicity the interface asks for for
 * free: nothing suspends between the check and the write in any method here,
 * so no two callers can interleave inside one. That is a property of this
 * implementation and not something a caller may assume about the interface.
 */
export function MemoryDeviceStore(): DeviceStore {
	const byHash = new Map<string, DeviceGrant>();
	const byCode = new Map<string, string>();

	function live(grant: DeviceGrant | undefined): DeviceGrant | null {
		if (!grant) return null;
		if (grant.expires <= Date.now()) return null;
		return grant;
	}

	return {
		async create(grant) {
			byHash.set(grant.deviceCodeHash, { ...grant });
			byCode.set(grant.userCode, grant.deviceCodeHash);
		},
		async byDeviceCode(hash) {
			const found = byHash.get(hash);
			return found ? { ...found } : null;
		},
		async byUserCode(userCode) {
			const hash = byCode.get(userCode);
			const found = hash ? byHash.get(hash) : undefined;
			return found ? { ...found } : null;
		},
		async approve(hash, subject) {
			const grant = live(byHash.get(hash));
			if (!grant || grant.status !== 'pending') return false;
			grant.status = 'approved';
			grant.subject = subject;
			return true;
		},
		async deny(hash) {
			const grant = live(byHash.get(hash));
			if (!grant || grant.status !== 'pending') return false;
			grant.status = 'denied';
			return true;
		},
		async consume(hash, clientID) {
			const grant = live(byHash.get(hash));
			if (!grant || grant.status !== 'approved' || grant.clientID !== clientID) return null;
			byHash.delete(hash);
			byCode.delete(grant.userCode);
			return { ...grant };
		},
		async recordPoll(hash, at, interval) {
			const grant = byHash.get(hash);
			if (!grant) return;
			grant.lastPolled = at;
			grant.interval = interval;
		},
		async remove(hash) {
			const grant = byHash.get(hash);
			if (!grant) return;
			byHash.delete(hash);
			byCode.delete(grant.userCode);
		}
	};
}
