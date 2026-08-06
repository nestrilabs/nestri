import { z } from 'zod';

import { Actor } from '../actor.js';
import { Database } from '../db/index.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { Fingerprint } from '../user/fingerprint.js';
import { User } from '../user/index.js';
import { LinkedAccount } from '../user/linked-account.js';

const STEAM_ID_RE = /^\d{17}$/;

function isUniqueViolation(err: unknown): boolean {
	const e = err as { code?: string; cause?: { code?: string } };
	return e?.code === '23505' || e?.cause?.code === '23505';
}

type SshIdentityInput = {
	fingerprint: string;
	steamId: string;
	username?: string;
	profile?: Record<string, unknown> | null;
};

async function resolveSshIdentityOnce(
	input: SshIdentityInput
): Promise<{ userID: string; linkedAccountID: string }> {
	const steamLink = await LinkedAccount.findByProvider({
		provider: 'steam',
		providerAccountId: input.steamId
	});

	const fingerprintRow = await Fingerprint.findByFingerprint(input.fingerprint);
	const sshLink = await LinkedAccount.findSshByFingerprint(input.fingerprint);

	if (steamLink) {
		const canonicalUserID = steamLink.userId;

		if (input.profile) {
			await LinkedAccount.updateProfile({ id: steamLink.id, profile: input.profile });
		}

		if (!fingerprintRow) {
			// Case A: existing Steam account, new SSH fingerprint.
			await Fingerprint.create({
				id: Identifier.ascending('userFingerprint'),
				userId: canonicalUserID,
				fingerprint: input.fingerprint,
				name: input.username ?? null
			});
		} else if (fingerprintRow.userId === canonicalUserID) {
			// Case D: same canonical user.
			await Fingerprint.touchLastSeen(fingerprintRow.id);
		} else {
			// Case E: fingerprint currently owned by a different user (device migration).
			const oldSteam = await LinkedAccount.findSteamByUser(fingerprintRow.userId);
			if (oldSteam) {
				throw new VisibleError(
					'forbidden',
					ErrorCodes.Permission.FORBIDDEN,
					`SSH key is already linked to Steam account ${oldSteam.providerAccountId}; refusing to switch accounts`
				);
			}
			const otherLinks = (await LinkedAccount.listByUser(fingerprintRow.userId)).filter(
				(l) => l.provider !== 'ssh' || l.providerAccountId !== input.fingerprint
			);
			if (otherLinks.length > 0) {
				throw new VisibleError(
					'forbidden',
					ErrorCodes.Permission.FORBIDDEN,
					'SSH key belongs to a user with other identities; refusing to merge'
				);
			}
			await Fingerprint.repoint({ fingerprint: input.fingerprint, userId: canonicalUserID });
			if (sshLink) {
				await LinkedAccount.repoint({ id: sshLink.id, userId: canonicalUserID });
			}
		}

		if (!sshLink) {
			await LinkedAccount.create({
				id: Identifier.ascending('linkedAccount'),
				userId: canonicalUserID,
				provider: 'ssh',
				providerAccountId: input.fingerprint,
				profile: null
			});
		}

		return { userID: canonicalUserID, linkedAccountID: steamLink.id };
	}

	if (fingerprintRow) {
		// Case B: new Steam account, existing fingerprint.
		const currentUserID = fingerprintRow.userId;
		const existingSteam = await LinkedAccount.findSteamByUser(currentUserID);
		if (existingSteam) {
			throw new VisibleError(
				'forbidden',
				ErrorCodes.Permission.FORBIDDEN,
				`User is already linked to Steam account ${existingSteam.providerAccountId}`
			);
		}
		await Fingerprint.touchLastSeen(fingerprintRow.id);

		const newSteamLinkID = Identifier.ascending('linkedAccount');
		await LinkedAccount.create({
			id: newSteamLinkID,
			userId: currentUserID,
			provider: 'steam',
			providerAccountId: input.steamId,
			profile: input.profile ?? null
		});
		if (!sshLink) {
			await LinkedAccount.create({
				id: Identifier.ascending('linkedAccount'),
				userId: currentUserID,
				provider: 'ssh',
				providerAccountId: input.fingerprint,
				profile: null
			});
		}
		return { userID: currentUserID, linkedAccountID: newSteamLinkID };
	}

	// Case C: new Steam account, new SSH fingerprint.
	const newUserID = Identifier.ascending('user');
	const displayName = input.username ?? `player_${input.fingerprint.slice(0, 8)}`;
	await User.create({
		id: newUserID,
		name: displayName,
		email: undefined,
		emailVerified: false,
		image: null
	});

	await Fingerprint.create({
		id: Identifier.ascending('userFingerprint'),
		userId: newUserID,
		fingerprint: input.fingerprint,
		name: input.username ?? null
	});

	await LinkedAccount.create({
		id: Identifier.ascending('linkedAccount'),
		userId: newUserID,
		provider: 'ssh',
		providerAccountId: input.fingerprint,
		profile: null
	});

	const newSteamLinkID = Identifier.ascending('linkedAccount');
	await LinkedAccount.create({
		id: newSteamLinkID,
		userId: newUserID,
		provider: 'steam',
		providerAccountId: input.steamId,
		profile: input.profile ?? null
	});

	return { userID: newUserID, linkedAccountID: newSteamLinkID };
}

export namespace Steam {
	export const link = fn(
		z.object({
			steamId: z.string(),
			profile: z.record(z.string(), z.unknown()).nullable().optional(),
			userId: z.string().optional()
		}),
		async (input) => {
			return Database.transaction(async () => {
				const existing = await LinkedAccount.findByProvider({
					provider: 'steam',
					providerAccountId: input.steamId
				});
				if (existing) {
					return existing.id;
				}
				const actor = Actor.use();
				const uid =
					input.userId ??
					(actor.type === 'user' || actor.type === 'member' ? actor.properties.userID : undefined);
				if (!uid) {
					throw new VisibleError(
						'forbidden',
						ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
						'Cannot link Steam account without a user ID'
					);
				}
				const id = Identifier.ascending('linkedAccount');
				await LinkedAccount.create({
					id,
					userId: uid,
					provider: 'steam',
					providerAccountId: input.steamId,
					profile: input.profile ?? null
				});
				return id;
			});
		}
	);

	export const resolveSshIdentity = fn(
		z.object({
			fingerprint: z.string().min(1),
			steamId: z.string().regex(STEAM_ID_RE, 'must be a 17-digit Steam ID'),
			username: z.string().optional(),
			profile: z.record(z.string(), z.unknown()).nullable().optional()
		}),
		async (input) => {
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					// eslint-disable-next-line
					return await Database.transaction(async () => resolveSshIdentityOnce(input));
				} catch (err) {
					if (isUniqueViolation(err) && attempt < 2) {
						continue;
					}
					throw err;
				}
			}
			throw new VisibleError(
				'internal',
				ErrorCodes.Server.INTERNAL_ERROR,
				'Failed to resolve SSH identity'
			);
		}
	);
}
