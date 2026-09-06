import { randomBytes } from 'crypto';

import { z } from 'zod';

export namespace Identifier {
	export const prefixes = {
		user: 'usr',
		linkedAccount: 'lac',
		team: 'tem',
		teamMember: 'mem',
		verification: 'ver',
		userFingerprint: 'ufp',
		pairingCode: 'pai',
		machine: 'mch',
		box: 'box',
		session: 'ses',
		accessToken: 'pat',
		game: 'gam',
		userLibrary: 'ulb',
		gameDepot: 'gdp',
		gameDownload: 'gdl',
		waitlistEntry: 'wle',
		deviceGrant: 'dvg',
		authKv: 'akv',
		authKey: 'aky',
		authorizationCode: 'acd',
		refreshToken: 'rft'
	} as const;

	/**
	 * An id as this control plane issues them: the right prefix, and the exact
	 * width the column has.
	 *
	 * The width is the half that matters at an API boundary. Ids are stored in
	 * a fixed-width column, so an overlong string is *refused by the database*
	 * rather than simply not matching anything — which surfaces to the caller
	 * as a server fault instead of the validation error it actually is.
	 * Checking it where the input arrives is what keeps the two apart.
	 *
	 * The separator is part of the prefix check for the same reason: without
	 * it, `usrsomething` reads as a user id.
	 */
	export function schema(prefix: keyof typeof prefixes) {
		return z
			.string()
			.startsWith(`${prefixes[prefix]}_`)
			.length(prefixes[prefix].length + 1 + LENGTH);
	}

	const LENGTH = 26;

	let lastTimestamp = 0;
	let counter = 0;

	export function ascending(prefix: keyof typeof prefixes, given?: string) {
		return generateID(prefix, false, given);
	}

	export function descending(prefix: keyof typeof prefixes, given?: string) {
		return generateID(prefix, true, given);
	}

	function generateID(prefix: keyof typeof prefixes, descending: boolean, given?: string): string {
		if (!given) {
			return generateNewID(prefix, descending);
		}

		if (!given.startsWith(prefixes[prefix])) {
			throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`);
		}
		return given;
	}

	function randomBase62(length: number): string {
		const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
		let result = '';
		const bytes = randomBytes(length);
		for (let i = 0; i < length; i++) {
			result += chars[bytes[i]! % 62];
		}
		return result;
	}

	function generateNewID(prefix: keyof typeof prefixes, descending: boolean): string {
		const currentTimestamp = Date.now();

		if (currentTimestamp !== lastTimestamp) {
			lastTimestamp = currentTimestamp;
			counter = 0;
		}
		counter++;

		let now = BigInt(currentTimestamp) * BigInt(0x1000) + BigInt(counter);

		now = descending ? ~now : now;

		const timeBytes = Buffer.alloc(6);
		for (let i = 0; i < 6; i++) {
			timeBytes[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff));
		}

		return prefixes[prefix] + '_' + timeBytes.toString('hex') + randomBase62(LENGTH - 12);
	}
}
