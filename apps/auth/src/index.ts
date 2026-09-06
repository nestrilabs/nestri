import type { Hyperdrive } from '@cloudflare/workers-types';
import { issuer } from '@nestri/auth/index';
import { CodeProvider } from '@nestri/auth/provider/code';
import { CodeUI } from '@nestri/auth/ui/code';
import { isDomainMatch } from '@nestri/auth/util';
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

/**
 * Everything this issuer is handed, from a binding or from the environment.
 *
 * The database arrives one of two ways and neither is a special case:
 * `HYPERDRIVE` carries a connection string on a platform that pools
 * connections for us, `DATABASE_URL` says the same thing where nothing does.
 * Both are optional here so that a deployment is free to supply either, and
 * `@nestri/core`'s `Env` resolves the pair into one.
 */
type Env = {
	HYPERDRIVE?: Hyperdrive;
	DATABASE_URL?: string;
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
 * The zone every user-owned host is reached under, and the one path on it that
 * may receive an authorization code.
 *
 * A host is reached at `<id>.<zone>` through a proxy that authenticates
 * browsers on its behalf. That proxy cannot be handed a session from here: a
 * `__Host-` cookie is host-only by definition, so one set on this hostname is
 * never sent to a different one, and a first request to a host's own name
 * therefore arrives with no cookie whether or not the person is signed in.
 *
 * The proxy closes that by being an ordinary OAuth client — one per hostname —
 * and exchanging a code for a session it can set on the hostname the browser is
 * actually standing on. This is the rule that lets it: **the client id must be
 * the hostname, and the redirect must be that same hostname at the reserved
 * path below.**
 *
 * Making the client id the hostname is not a naming convention. A token is
 * minted with its audience set to the client id, so it binds the session to the
 * host it will live on — a cookie lifted off one host is not a credential on
 * another, and it is not a credential here either. ref(d-0056)
 */
const HOST_ZONE = 'nestri.link';
const HOST_CALLBACK_PATH = '/__nestri/callback';

/**
 * Whether `clientID` names a single host under {@link HOST_ZONE} and
 * `redirectURI` is that same host's reserved callback.
 *
 * Every clause is load-bearing, because what is being decided is where this
 * issuer will send an authorization code:
 *
 * - **`https` only.** A code is a one-time credential and belongs on a channel
 *   that cannot be read.
 * - **The host must equal the client id exactly**, so a client can only ever
 *   receive a code at its own name.
 * - **One label under the zone.** `a.b.<zone>` is not a host id, and must not
 *   be treated as one because `b.<zone>` might be.
 * - **The path must be exactly the reserved one**, with no query and no
 *   fragment. A caller-chosen return address on a wildcard of hostnames is an
 *   open redirector on every one of them, and this is the parameter that would
 *   be it.
 */
function isHostCallback(clientID: string, redirectURI: string): boolean {
	let url: URL;
	try {
		url = new URL(redirectURI);
	} catch {
		return false;
	}

	const label = clientID.toLowerCase().endsWith(`.${HOST_ZONE}`)
		? clientID.toLowerCase().slice(0, -`.${HOST_ZONE}`.length)
		: null;
	if (!label || label.length === 0 || label.includes('.')) {
		return false;
	}

	return (
		url.protocol === 'https:' &&
		url.host === clientID.toLowerCase() &&
		url.pathname === HOST_CALLBACK_PATH &&
		url.search === '' &&
		url.hash === ''
	);
}

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

/**
 * Which clients may start a flow here.
 *
 * The default rule allows a redirect back to whatever hostname the request
 * arrived on, which is right for a site served beside this one and refuses the
 * proxy in front of user-owned hosts — it redirects to a different registrable
 * domain on purpose, so that no host's cookie can ever reach this one. That
 * case is named here; everything else keeps the behaviour it had.
 *
 * Exported so it can be tested against a real `/authorize` request rather than
 * by reading it.
 */
export const allowClient = async (
	input: { clientID: string; redirectURI: string },
	req: Request
): Promise<boolean> => {
	if (isHostCallback(input.clientID, input.redirectURI)) {
		return true;
	}

	let redirect: string;
	try {
		redirect = new URL(input.redirectURI).hostname;
	} catch {
		return false;
	}
	if (redirect === 'localhost' || redirect === '127.0.0.1') {
		return true;
	}
	const forwarded = req.headers.get('x-forwarded-host');
	const host = forwarded ? new URL(`https://${forwarded}`).hostname : new URL(req.url).hostname;
	return isDomainMatch(redirect, host);
};

export default {
	async fetch(request: Request, env: Env, ctx?: ExecutionContext) {
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
			// The default rule allows a redirect back to whatever hostname the
			// request arrived on, which is right for a site served beside this
			// one and refuses the proxy in front of user-owned hosts — it
			// redirects to a different registrable domain on purpose, so that
			// no host's cookie can ever reach this one.
			//
			// So that case is named, and everything else keeps the behaviour it
			// had.
			allow: allowClient,
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
