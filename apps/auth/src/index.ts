import type { Hyperdrive, KVNamespace } from '@cloudflare/workers-types';
import { issuer } from '@nestri/auth/index';
import { CodeProvider } from '@nestri/auth/provider/code';
import { SshProvider } from '@nestri/auth/provider/ssh';
import { SteamProvider } from '@nestri/auth/provider/steam';
import { CloudflareStorage } from '@nestri/auth/storage/cloudflare';
import { CodeUI } from '@nestri/auth/ui/code';
import { Actor } from '@nestri/core/actor';
import { subjects } from '@nestri/core/auth/subjects';
import { Env } from '@nestri/core/env';
import { Steam } from '@nestri/core/steam/index';
import { Team } from '@nestri/core/team/index';
import { Identity } from '@nestri/core/user/identity';
import { User } from '@nestri/core/user/index';
import { LinkedAccount } from '@nestri/core/user/linked-account';

import { sendVerificationCode } from './email.js';

type Env = {
	AuthStorage: KVNamespace;
	HYPERDRIVE: Hyperdrive;
	STEAM_API_KEY: string;
	SSH_AUTH_KEY: string;
	EMAIL_SEND_URL?: string;
	EMAIL_API_KEY?: string;
	EMAIL_FROM?: string;
	NODE_ENV?: string;
};

/**
 * Enough of an address to be worth trying to deliver to.
 *
 * Deliberately loose: the only test that settles whether an address is real is
 * whether the code arrives, and this flow already runs that test. What this
 * catches is the empty box and the missing `@` — the cases where nothing could
 * possibly be sent — so the screen can say so instead of pretending.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Which linked account a token names, for a person who may have none.
 *
 * An account rooted in an email address starts with nothing attached, so there
 * is genuinely no linked account to name and the empty string says so. The
 * middleware that reads this already treats an empty value as "no linked
 * account", because a server-to-server caller has never had one either.
 */
async function firstSteamLink(userID: string): Promise<string> {
	const link = await LinkedAccount.findSteamByUser(userID);
	return link?.id ?? '';
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		Env.init(env as unknown as Record<string, unknown>);
		const inner = issuer({
			subjects,
			storage: CloudflareStorage({
				namespace: env.AuthStorage
			}),
			providers: {
				// Verifying an email address is what creates an account. It is
				// listed first because it is the only branch below that is
				// allowed to bring a person into existence. ref(d-0048)
				code: CodeProvider({
					// The UI, with delivery replaced. `CodeUI`'s own hook cannot
					// report a bad address back to the screen — it returns
					// nothing — and a mistyped address that silently succeeds
					// leaves someone waiting for mail that went nowhere.
					...CodeUI({
						copy: { code_info: "We'll email you a code to sign in." },
						sendCode: async () => {}
					}),
					sendCode: async (claims, code) => {
						const email = claims.email?.trim().toLowerCase();
						if (!email || !EMAIL_RE.test(email)) {
							return { type: 'invalid_claim', key: 'email', value: claims.email ?? '' };
						}
						await sendVerificationCode(env, email, code);
					}
				}),
				steam: SteamProvider(),
				ssh: SshProvider({ sshAuthKey: env.SSH_AUTH_KEY })
			},
			async success(context, response) {
				if (response.provider === 'code') {
					const email = (response.claims as Record<string, string>).email!.trim().toLowerCase();
					const { userID } = await Identity.fromVerifiedEmail({ email });

					// Every user needs a personal team, because `machine.teamId`
					// is notNull and registering a host has nowhere to put it
					// otherwise. Idempotent, so running it on every sign-in is
					// also what backfills the accounts made before it existed.
					const linkedAccountID = await firstSteamLink(userID);
					await Actor.with({ type: 'user', properties: { userID, linkedAccountID } }, () =>
						Team.ensurePersonal({ displayName: email.split('@')[0]! })
					);

					return context.subject('user', { userID, linkedAccountID });
				}

				if (response.provider === 'steam') {
					const { steamid } = response;

					// Signing in with Steam resolves an account; it never
					// creates one. A Steam account is something a person
					// attaches to an account they already have, so losing it
					// costs them a link and not everything they own. Accounts
					// that predate the rule already have the link this finds,
					// so they keep working unchanged. ref(d-0048)
					const { userID, linkedAccountID } = await Identity.resolveSteamLogin({
						steamId: steamid
					});

					// The persona is refreshed on the way through, because this
					// is the only moment the current one is in hand.
					const player = await steamProfile(env.STEAM_API_KEY, steamid);
					if (player) {
						await LinkedAccount.updateProfile({ id: linkedAccountID, profile: player });
					}

					const user = await User.fromID(userID);
					await Actor.with({ type: 'user', properties: { userID, linkedAccountID } }, () =>
						Team.ensurePersonal({
							displayName: user?.name || (player?.personaname as string) || 'Player'
						})
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

					// Same reason as the branch above. The SSH path creates
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

/** The current persona for a Steam account, or null if Steam did not answer. */
async function steamProfile(
	apiKey: string,
	steamid: string
): Promise<Record<string, unknown> | null> {
	try {
		const profileUrl = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/');
		profileUrl.searchParams.set('key', apiKey);
		profileUrl.searchParams.set('steamids', steamid);

		const res = await fetch(profileUrl.toString());
		const data = (await res.json()) as {
			response?: { players?: Array<Record<string, unknown>> };
		};
		return data?.response?.players?.[0] ?? null;
	} catch {
		// A stale display name is not a reason to refuse a sign-in.
		return null;
	}
}
