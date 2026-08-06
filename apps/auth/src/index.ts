import type { Hyperdrive, KVNamespace } from '@cloudflare/workers-types';
import { issuer } from '@nestri/auth/index';
import { SshProvider } from '@nestri/auth/provider/ssh';
import { SteamProvider } from '@nestri/auth/provider/steam';
import { CloudflareStorage } from '@nestri/auth/storage/cloudflare';
import { subjects } from '@nestri/core/auth/subjects';
import { Database } from '@nestri/core/db/index';
import { Env } from '@nestri/core/env';
import { Identifier } from '@nestri/core/id';
import { Steam } from '@nestri/core/steam/index';
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
