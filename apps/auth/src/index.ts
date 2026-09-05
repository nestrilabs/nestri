import type { Hyperdrive } from '@cloudflare/workers-types';
import { issuer } from '@nestri/auth/index';
import { CodeProvider } from '@nestri/auth/provider/code';
import { CodeUI } from '@nestri/auth/ui/code';
import { Actor } from '@nestri/core/actor';
import { PostgresCodeStore } from '@nestri/core/auth/authorization-code';
import { PostgresDeviceStore } from '@nestri/core/auth/device-grant';
import { PostgresRefreshStore } from '@nestri/core/auth/refresh-token';
import { PostgresKeyStore } from '@nestri/core/auth/signing-key';
import { PostgresStorage } from '@nestri/core/auth/storage';
import { subjects } from '@nestri/core/auth/subjects';
import { Env } from '@nestri/core/env';
import { Team } from '@nestri/core/team/index';
import { Identity } from '@nestri/core/user/identity';
import { LinkedAccount } from '@nestri/core/user/linked-account';

import { sendVerificationCode } from './email.js';

type Env = {
	HYPERDRIVE: Hyperdrive;
	EMAIL_SEND_URL?: string;
	EMAIL_API_KEY?: string;
	EMAIL_FROM?: string;
	EMAIL_DEV_LOG?: string;
};

/**
 * The programs allowed to start a device authorization grant.
 *
 * That endpoint takes no secret — a program with no browser has nowhere to keep
 * one, which is the whole reason the grant exists — so the identifier is a
 * claim and not a proof. What the list buys is that the claim has to be one of
 * ours: the identifier ends up on the issued token, and without this anything
 * on the internet could mint a grant naming anything at all.
 */
const DEVICE_CLIENTS = new Set(['desktop']);

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
			// One database behind all of it, and nothing that only exists on
			// one hosting provider. What is left in the generic store is the
			// rate-limit counters — the only records here that are allowed to
			// be approximate, and the only ones whose shape is not worth a
			// migration.
			storage: PostgresStorage(),
			// The rest each got an interface of their own because each has a
			// transition that must happen exactly once while two parties are
			// touching the same record: a code is redeemed once, a refresh
			// token is spent once, a grant is approved once. A store that reads
			// and writes whole records cannot promise that — the second caller
			// overwrites what the first decided. A conditional update can.
			keyStore: PostgresKeyStore(),
			codeStore: PostgresCodeStore(),
			refreshStore: PostgresRefreshStore(),
			deviceStore: PostgresDeviceStore(),
			allowDeviceClient: async (clientID) => DEVICE_CLIENTS.has(clientID),
			// One provider, on purpose.
			//
			// Verifying an email address is the only thing that brings an
			// account into existence. Steam and SSH were sign-ins here as well,
			// and both could mint a user from a persona or a key — which makes
			// the account only as recoverable as the thing that made it, and
			// gives one person as many accounts as they have gaming logins.
			//
			// They are unwired rather than deleted: the providers still exist
			// under `packages/auth/src/provider/`, because connecting a Steam
			// account is something this product still does. It does it from
			// `apps/api`'s `POST /steam/link`, against a user who already
			// exists — which is a connection hanging off an identity, and not
			// an identity of its own. ref(d-0048)
			providers: {
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
				})
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

				throw new Error('Unknown provider');
			}
		});

		return inner.fetch(request, env, ctx);
	}
};
