import type { Hyperdrive, KVNamespace } from '@cloudflare/workers-types';
import { issuer } from '@nestri/auth/index';
import { SshProvider } from '@nestri/auth/provider/ssh';
import { SteamProvider } from '@nestri/auth/provider/steam';
import { CloudflareStorage } from '@nestri/auth/storage/cloudflare';
import { subjects } from '@nestri/core/auth/subjects';
import { Database } from '@nestri/core/db/index';
import { Env } from '@nestri/core/env';
import { Actor } from '@nestri/core/actor';
import { Identifier } from '@nestri/core/id';
import { Steam } from '@nestri/core/steam/index';
import { Team } from '@nestri/core/team/index';
import { User } from '@nestri/core/user/index';
import { LinkedAccount } from '@nestri/core/user/linked-account';

type Env = {
	AuthStorage: KVNamespace;
	HYPERDRIVE: Hyperdrive;
	STEAM_API_KEY: string;
	SSH_AUTH_KEY: string;
};

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		Env.init(env as unknown as Record<string, unknown>);
		const inner = issuer({
			subjects,
			storage: CloudflareStorage({
				namespace: env.AuthStorage
			}),
			providers: {
				steam: SteamProvider(),
				ssh: SshProvider({ sshAuthKey: env.SSH_AUTH_KEY })
			},
			async success(context, response) {
				if (response.provider === 'steam') {
					const { steamid } = response;
					const profileUrl = new URL(
						'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/'
					);
					profileUrl.searchParams.set('key', env.STEAM_API_KEY);
					profileUrl.searchParams.set('steamids', steamid);

					const profileRes = await fetch(profileUrl.toString());
					const profileData = (await profileRes.json()) as {
						response?: { players?: Array<Record<string, unknown>> };
					};

					const player = profileData?.response?.players?.[0] as any;
					const personaname: string = player?.personaname ?? 'Player';
					const avatarfull: string = player?.avatarfull;

					const { userID, linkedAccountID } = await Database.transaction(async () => {
						const existing = await LinkedAccount.findByProvider({
							provider: 'steam',
							providerAccountId: steamid
						});

						if (existing) {
							const user = await User.fromID(existing.userId);
							if (!user) throw new Error('User not found for linked account');
							return { userID: user.id, linkedAccountID: existing.id };
						}

						const newUserID = Identifier.ascending('user');
						await User.create({
							id: newUserID,
							name: personaname,
							email: undefined,
							emailVerified: false,
							image: avatarfull ?? null
						});

						const newLinkedAccountID = Identifier.ascending('linkedAccount');
						await LinkedAccount.create({
							id: newLinkedAccountID,
							userId: newUserID,
							provider: 'steam',
							providerAccountId: steamid,
							profile: player ?? {}
						});

						return { userID: newUserID, linkedAccountID: newLinkedAccountID };
					});

					// Every user needs a personal team, because `machine.teamId` is
					// notNull since 0048 and registering a host has nowhere to put
					// it otherwise. `packages/core/CLAUDE.md` documented this call
					// as part of the login flow and it was never actually made, so
					// no user in the database has one.
					//
					// Run on every login rather than only on creation: that is what
					// backfills the accounts made before this existed, and
					// `ensurePersonal` is idempotent precisely so it can be.
					await Actor.with({ type: 'user', properties: { userID, linkedAccountID } }, () =>
						Team.ensurePersonal({ displayName: personaname })
					);

					return context.subject('user', {
						userID,
						linkedAccountID
					});
				}

				if (response.provider === 'ssh') {
					const { fingerprint, steamId, username, profile } = response;
					const { userID, linkedAccountID } = await Steam.resolveSshIdentity({
						fingerprint,
						steamId,
						username,
						profile
					});

					// Same reason as the Steam branch above. The SSH path creates
					// users too, so leaving it out would give a host registered
					// from `nessh` nowhere to live.
					await Actor.with({ type: 'user', properties: { userID, linkedAccountID } }, () =>
						// `username` is optional on the SSH path — a key can arrive
						// before a persona does. The slug only has to be derivable,
						// not pretty, and a rename is a later problem.
						Team.ensurePersonal({ displayName: username ?? 'Player' })
					);

					return context.subject('user', {
						userID,
						linkedAccountID,
						fingerprint
					});
				}

				throw new Error('Unknown provider');
			}
		});

		return inner.fetch(request, env, ctx);
	}
};
