import type { v1 } from '@standard-schema/spec';
import { Context } from 'hono';
import { handle as awsHandle } from 'hono/aws-lambda';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { Hono } from 'hono/tiny';

/**
 * The `issuer` create an OpentAuth server, a [Hono](https://hono.dev) app that's
 * designed to run anywhere.
 *
 * The `issuer` function requires a few things:
 *
 * ```ts title="issuer.ts"
 * import { issuer } from "@openauthjs/openauth"
 *
 * const app = issuer({
 *   providers: { ... },
 *   storage,
 *   subjects,
 *   success: async (ctx, value) => { ... }
 * })
 * ```
 *
 * #### Add providers
 *
 * You start by specifying the auth providers you are going to use. Let's say you want your users
 * to be able to authenticate with GitHub and with their email and password.
 *
 * ```ts title="issuer.ts"
 * import { GithubProvider } from "@openauthjs/openauth/provider/github"
 * import { PasswordProvider } from "@openauthjs/openauth/provider/password"
 *
 * const app = issuer({
 *   providers: {
 *     github: GithubProvider({
 *       // ...
 *     }),
 *     password: PasswordProvider({
 *       // ...
 *     }),
 *   },
 * })
 * ```
 *
 * #### Handle success
 *
 * The `success` callback receives the payload when a user completes a provider's auth flow.
 *
 * ```ts title="issuer.ts"
 * const app = issuer({
 *   providers: { ... },
 *   subjects,
 *   async success(ctx, value) {
 *     let userID
 *     if (value.provider === "password") {
 *       console.log(value.email)
 *       userID = ... // lookup user or create them
 *     }
 *     if (value.provider === "github") {
 *       console.log(value.tokenset.access)
 *       userID = ... // lookup user or create them
 *     }
 *     return ctx.subject("user", {
 *       userID
 *     })
 *   }
 * })
 * ```
 *
 * Once complete, the `issuer` issues the access tokens that a client can use. The `ctx.subject`
 * call is what is placed in the access token as a JWT.
 *
 * #### Define subjects
 *
 * You define the shape of these in the `subjects` field.
 *
 * ```ts title="subjects.ts"
 * import { object, string } from "valibot"
 * import { createSubjects } from "@openauthjs/openauth/subject"
 *
 * const subjects = createSubjects({
 *   user: object({
 *     userID: string()
 *   })
 * })
 * ```
 *
 * It's good to place this in a separate file since this'll be used in your client apps as well.
 *
 * ```ts title="issuer.ts"
 * import { subjects } from "./subjects.js"
 *
 * const app = issuer({
 *   providers: { ... },
 *   subjects,
 *   // ...
 * })
 * ```
 *
 * #### Deploy
 *
 * Since `issuer` is a Hono app, you can deploy it anywhere Hono supports.
 *
 * <Tabs>
 *   <TabItem label="Node">
 *   ```ts title="issuer.ts"
 *   import { serve } from "@hono/node-server"
 *
 *   serve(app)
 *   ```
 *   </TabItem>
 *   <TabItem label="Lambda">
 *   ```ts title="issuer.ts"
 *   import { handle } from "hono/aws-lambda"
 *
 *   export const handler = handle(app)
 *   ```
 *   </TabItem>
 *   <TabItem label="Bun">
 *   ```ts title="issuer.ts"
 *   export default app
 *   ```
 *   </TabItem>
 *   <TabItem label="Workers">
 *   ```ts title="issuer.ts"
 *   export default app
 *   ```
 *   </TabItem>
 * </Tabs>
 *
 * @packageDocumentation
 */
import { Provider, ProviderOptions } from './provider/provider.js';
import { SubjectPayload, SubjectSchema } from './subject.js';

/**
 * Sets the subject payload in the JWT token and returns the response.
 *
 * ```ts
 * ctx.subject("user", {
 *   userID
 * })
 * ```
 */
export interface OnSuccessResponder<T extends { type: string; properties: any }> {
	/**
	 * The `type` is the type of the subject, that was defined in the `subjects` field.
	 *
	 * The `properties` are the properties of the subject. This is the shape of the subject that
	 * you defined in the `subjects` field.
	 */
	subject<Type extends T['type']>(
		type: Type,
		properties: Extract<T, { type: Type }>['properties'],
		opts?: {
			ttl?: {
				access?: number;
				refresh?: number;
			};
			subject?: string;
		}
	): Promise<Response>;
}

/**
 * @internal
 */
export interface AuthorizationState {
	redirect_uri: string;
	response_type: string;
	state: string;
	client_id: string;
	audience?: string;
	pkce?: {
		challenge: string;
		method: 'S256';
	};
	/**
	 * Set when the browser half of a device authorization grant is running.
	 * There is no `redirect_uri` in that case: the thing waiting for the answer
	 * is a program on another machine polling the token endpoint, so the
	 * result is recorded against the grant instead of into a redirect.
	 *
	 * This is the *hash* of the device code. The browser half never sees the
	 * code itself — it arrives holding a user code, and the code that redeems
	 * tokens stays with the program that asked for it.
	 */
	device_code?: string;
}

/**
 * @internal
 */
export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { compactDecrypt, CompactEncrypt, jwtVerify, SignJWT } from 'jose';

import {
	MissingParameterError,
	OauthError,
	UnauthorizedClientError,
	UnknownStateError
} from './error.js';
import { encryptionKeys, legacySigningKeys, signingKeys } from './keys.js';
import {
	type DeviceGrant,
	type DeviceGrantSubject,
	type DeviceStore,
	hashDeviceCode,
	MemoryDeviceStore
} from './device.js';
import { validatePKCE } from './pkce.js';
import { generateUnbiasedString, timingSafeCompare } from './random.js';
import { DynamoStorage } from './storage/dynamo.js';
import { MemoryStorage } from './storage/memory.js';
import { Storage, StorageAdapter } from './storage/storage.js';
import { Select } from './ui/select.js';
import { setTheme, Theme } from './ui/theme.js';
import { getRelativeUrl, isDomainMatch, lazy } from './util.js';

/** @internal */
export const aws = awsHandle;

/** RFC 8628's grant type, spelled out because it is a URN and not a word. */
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** The longest a device is ever told to wait between polls, in seconds. */
const DEVICE_MAX_INTERVAL = 60;

export interface IssuerInput<
	Providers extends Record<string, Provider<any>>,
	Subjects extends SubjectSchema,
	Result = {
		[key in keyof Providers]: Prettify<
			{
				provider: key;
			} & (Providers[key] extends Provider<infer T> ? T : {})
		>;
	}[keyof Providers]
> {
	/**
	 * The shape of the subjects that you want to return.
	 *
	 * @example
	 *
	 * ```ts title="issuer.ts"
	 * import { object, string } from "valibot"
	 * import { createSubjects } from "@openauthjs/openauth/subject"
	 *
	 * issuer({
	 *   subjects: createSubjects({
	 *     user: object({
	 *       userID: string()
	 *     })
	 *   })
	 *   // ...
	 * })
	 * ```
	 */
	subjects: Subjects;
	/**
	 * The storage adapter that you want to use.
	 *
	 * @example
	 * ```ts title="issuer.ts"
	 * import { DynamoStorage } from "@openauthjs/openauth/storage/dynamo"
	 *
	 * issuer({
	 *   storage: DynamoStorage()
	 *   // ...
	 * })
	 * ```
	 */
	storage?: StorageAdapter;
	/**
	 * The providers that you want your OpenAuth server to support.
	 *
	 * @example
	 *
	 * ```ts title="issuer.ts"
	 * import { GithubProvider } from "@openauthjs/openauth/provider/github"
	 *
	 * issuer({
	 *   providers: {
	 *     github: GithubProvider()
	 *   }
	 * })
	 * ```
	 *
	 * The key is just a string that you can use to identify the provider. It's passed back to
	 * the `success` callback.
	 *
	 * You can also specify multiple providers.
	 *
	 * ```ts
	 * {
	 *   providers: {
	 *     github: GithubProvider(),
	 *     google: GoogleProvider()
	 *   }
	 * }
	 * ```
	 */
	providers: Providers;
	/**
	 * The theme you want to use for the UI.
	 *
	 * This includes the UI the user sees when selecting a provider. And the `PasswordUI` and
	 * `CodeUI` that are used by the `PasswordProvider` and `CodeProvider`.
	 *
	 * @example
	 * ```ts title="issuer.ts"
	 * import { THEME_SST } from "@openauthjs/openauth/ui/theme"
	 *
	 * issuer({
	 *   theme: THEME_SST
	 *   // ...
	 * })
	 * ```
	 *
	 * Or define your own.
	 *
	 * ```ts title="issuer.ts"
	 * import type { Theme } from "@openauthjs/openauth/ui/theme"
	 *
	 * const MY_THEME: Theme = {
	 *   // ...
	 * }
	 *
	 * issuer({
	 *   theme: MY_THEME
	 *   // ...
	 * })
	 * ```
	 */
	theme?: Theme;
	/**
	 * Set the TTL, in seconds, for access and refresh tokens.
	 *
	 * @example
	 * ```ts
	 * {
	 *   ttl: {
	 *     access: 60 * 60 * 24 * 30,
	 *     refresh: 60 * 60 * 24 * 365
	 *   }
	 * }
	 * ```
	 */
	ttl?: {
		/**
		 * Interval in seconds where the access token is valid.
		 * @default 30d
		 */
		access?: number;
		/**
		 * Interval in seconds where the refresh token is valid.
		 * @default 1y
		 */
		refresh?: number;
		/**
		 * Interval in seconds where refresh token reuse is allowed. This helps mitigrate
		 * concurrency issues.
		 * @default 60s
		 */
		reuse?: number;
		/**
		 * Interval in seconds to retain refresh tokens for reuse detection.
		 * @default 0s
		 */
		retention?: number;
		/**
		 * Interval in seconds a device code stays usable before the user has to
		 * start again.
		 * @default 600s
		 */
		device?: number;
		/**
		 * Slowest a device may poll the token endpoint without being told to
		 * slow down, in seconds.
		 * @default 5s
		 */
		deviceInterval?: number;
	};
	/**
	 * Where device authorization grants are kept.
	 *
	 * Defaults to one held in this process's memory, which is right for tests
	 * and for a single local process and wrong for anything else — a grant
	 * created by one instance has to be findable by whichever instance the
	 * browser and the polling client happen to reach. A real deployment passes
	 * a store backed by something shared, and the interface is written so that
	 * store can make each transition a single operation.
	 */
	deviceStore?: DeviceStore;
	/**
	 * Whether a client may start a device authorization grant.
	 *
	 * `/device/authorize` takes no secret — that is what the grant is for — so
	 * without this any caller can mint a grant naming any client identifier,
	 * and that identifier is what the issued token ends up carrying. Returning
	 * false refuses the request.
	 *
	 * Defaults to allowing everything, which preserves the behaviour of an
	 * issuer that has not thought about it, and is worth thinking about.
	 */
	allowDeviceClient?(clientID: string, req: Request): Promise<boolean>;
	/**
	 * Optionally, configure the UI that's displayed when the user visits the root URL of the
	 * of the OpenAuth server.
	 *
	 * ```ts title="issuer.ts"
	 * import { Select } from "@openauthjs/openauth/ui/select"
	 *
	 * issuer({
	 *   select: Select({
	 *     providers: {
	 *       github: { hide: true },
	 *       google: { display: "Google" }
	 *     }
	 *   })
	 *   // ...
	 * })
	 * ```
	 *
	 * @default Select()
	 */
	select?(providers: Record<string, string>, req: Request): Promise<Response>;
	/**
	 * @internal
	 */
	start?(req: Request): Promise<void>;
	/**
	 * The success callback that's called when the user completes the flow.
	 *
	 * This is called after the user has been redirected back to your app after the OAuth flow.
	 *
	 * @example
	 * ```ts
	 * {
	 *   success: async (ctx, value) => {
	 *     let userID
	 *     if (value.provider === "password") {
	 *       console.log(value.email)
	 *       userID = ... // lookup user or create them
	 *     }
	 *     if (value.provider === "github") {
	 *       console.log(value.tokenset.access)
	 *       userID = ... // lookup user or create them
	 *     }
	 *     return ctx.subject("user", {
	 *       userID
	 *     })
	 *   },
	 *   // ...
	 * }
	 * ```
	 */
	success(
		response: OnSuccessResponder<SubjectPayload<Subjects>>,
		input: Result,
		req: Request
	): Promise<Response>;
	/**
	 * @internal
	 */
	error?(error: UnknownStateError, req: Request): Promise<Response>;
	/**
	 * Override the logic for whether a client request is allowed to call the issuer.
	 *
	 * By default, it uses the following:
	 *
	 * - Allow if the `redirectURI` is localhost.
	 * - Compare `redirectURI` to the request's hostname or the `x-forwarded-host` header. If they
	 *   are from the same sub-domain level, then allow.
	 *
	 * @example
	 * ```ts
	 * {
	 *   allow: async (input, req) => {
	 *     // Allow all clients
	 *     return true
	 *   }
	 * }
	 * ```
	 */
	allow?(
		input: {
			clientID: string;
			redirectURI: string;
			audience?: string;
		},
		req: Request
	): Promise<boolean>;
}

/**
 * Create an OpenAuth server, a Hono app.
 */
export function issuer<
	Providers extends Record<string, Provider<any>>,
	Subjects extends SubjectSchema,
	Result = {
		[key in keyof Providers]: Prettify<
			{
				provider: key;
			} & (Providers[key] extends Provider<infer T> ? T : {})
		>;
	}[keyof Providers]
>(input: IssuerInput<Providers, Subjects, Result>) {
	const error =
		input.error ??
		function (err) {
			return new Response(err.message, {
				status: 400,
				headers: {
					'Content-Type': 'text/plain'
				}
			});
		};
	const ttlAccess = input.ttl?.access ?? 60 * 60 * 24 * 30;
	const ttlRefresh = input.ttl?.refresh ?? 60 * 60 * 24 * 365;
	const ttlRefreshReuse = input.ttl?.reuse ?? 60;
	const ttlRefreshRetention = input.ttl?.retention ?? 0;
	const ttlDevice = input.ttl?.device ?? 60 * 10;
	const deviceInterval = input.ttl?.deviceInterval ?? 5;
	const deviceStore = input.deviceStore ?? MemoryDeviceStore();
	if (input.theme) {
		setTheme(input.theme);
	}

	const select = lazy(() => input.select ?? Select());
	const allow = lazy(
		() =>
			input.allow ??
			(async (input: any, req: Request) => {
				const redir = new URL(input.redirectURI).hostname;
				if (redir === 'localhost' || redir === '127.0.0.1') {
					return true;
				}
				const forwarded = req.headers.get('x-forwarded-host');
				const host = forwarded
					? new URL(`https://${forwarded}`).hostname
					: new URL(req.url).hostname;

				return isDomainMatch(redir, host);
			})
	);

	let storage = input.storage;
	if (process.env.OPENAUTH_STORAGE) {
		const parsed = JSON.parse(process.env.OPENAUTH_STORAGE);
		if (parsed.type === 'dynamo') storage = DynamoStorage(parsed.options);
		if (parsed.type === 'memory') storage = MemoryStorage();
		if (parsed.type === 'cloudflare')
			throw new Error(
				'Cloudflare storage cannot be configured through env because it requires bindings.'
			);
	}
	if (!storage)
		throw new Error(
			'Store is not configured. Either set the `storage` option or set `OPENAUTH_STORAGE` environment variable.'
		);
	const allSigning = lazy(() =>
		Promise.all([signingKeys(storage), legacySigningKeys(storage)]).then(([a, b]) => [...a, ...b])
	);
	const allEncryption = lazy(() => encryptionKeys(storage));
	const signingKey = lazy(() => allSigning().then((all) => all[0]));
	const encryptionKey = lazy(() => allEncryption().then((all) => all[0]));

	const auth: Omit<ProviderOptions<any>, 'name'> = {
		async success(ctx: Context, properties: any, successOpts) {
			return await input.success(
				{
					async subject(type, properties, subjectOpts) {
						let authorization: AuthorizationState | null = null;
						try {
							authorization = await getAuthorization(ctx);
						} catch (e) {
							if (!(e instanceof UnknownStateError)) throw e;
							// Non-browser provider (SSH, etc.) — no OAuth state; issue tokens directly.
						}
						const subject = subjectOpts?.subject
							? subjectOpts.subject
							: await resolveSubject(type, properties);
						await successOpts?.invalidate?.(await resolveSubject(type, properties));
						if (authorization?.device_code) {
							// A device grant has nowhere to redirect to, and it is
							// also not finished. Signing in says who this browser
							// is; it does not say that the person meant to hand an
							// account to whatever program is holding the other half
							// of this code. Those are two different questions and
							// only the second one authorizes anything, so what
							// happens here is a page that asks it.
							await auth.unset(ctx, 'authorization');
							const grant = await deviceStore.byDeviceCode(authorization.device_code);
							if (!grant || grant.status !== 'pending' || grant.expires <= Date.now()) {
								return ctx.text(
									'That sign-in request has expired. Start it again from the app.',
									400
								);
							}

							// Carried in an encrypted cookie rather than written to
							// the grant, so that a request nobody has confirmed
							// leaves nothing on the record a later poll could
							// mistake for an answer.
							const confirmation: DeviceConfirmation = {
								deviceCode: authorization.device_code,
								userCode: grant.userCode,
								clientID: grant.clientID,
								csrf: generateUnbiasedString(CSRF_ALPHABET, 32),
								subject: {
									subject,
									type: type as string,
									properties,
									ttl: {
										access: subjectOpts?.ttl?.access ?? ttlAccess,
										refresh: subjectOpts?.ttl?.refresh ?? ttlRefresh
									}
								}
							};
							await auth.set(ctx, 'device_confirm', ttlDevice, confirmation);
							return ctx.html(deviceConfirmPage(confirmation));
						}
						if (authorization) {
							if (authorization.response_type === 'token') {
								const location = new URL(authorization.redirect_uri);
								const tokens = await generateTokens(ctx, {
									subject,
									type: type as string,
									properties,
									clientID: authorization.client_id,
									ttl: {
										access: subjectOpts?.ttl?.access ?? ttlAccess,
										refresh: subjectOpts?.ttl?.refresh ?? ttlRefresh
									}
								});
								location.hash = new URLSearchParams({
									access_token: tokens.access,
									refresh_token: tokens.refresh,
									state: authorization.state || ''
								}).toString();
								await auth.unset(ctx, 'authorization');
								return ctx.redirect(location.toString(), 302);
							}
							if (authorization.response_type === 'code') {
								const code = crypto.randomUUID();
								await Storage.set(
									storage,
									['oauth:code', code],
									{
										type,
										properties,
										subject,
										redirectURI: authorization.redirect_uri,
										clientID: authorization.client_id,
										pkce: authorization.pkce,
										ttl: {
											access: subjectOpts?.ttl?.access ?? ttlAccess,
											refresh: subjectOpts?.ttl?.refresh ?? ttlRefresh
										}
									},
									60
								);
								const location = new URL(authorization.redirect_uri);
								location.searchParams.set('code', code);
								location.searchParams.set('state', authorization.state || '');
								await auth.unset(ctx, 'authorization');
								return ctx.redirect(location.toString(), 302);
							}
							throw new OauthError(
								'invalid_request',
								`Unsupported response_type: ${authorization.response_type}`
							);
						}
						// Non-browser provider — return tokens as JSON directly.
						const tokens = await generateTokens(ctx, {
							subject,
							type: type as string,
							properties,
							clientID: 'ssh',
							ttl: {
								access: subjectOpts?.ttl?.access ?? ttlAccess,
								refresh: subjectOpts?.ttl?.refresh ?? ttlRefresh
							}
						});
						return ctx.json({
							accessToken: tokens.access,
							refreshToken: tokens.refresh,
							expiresIn: tokens.expiresIn
						});
					}
				},
				{
					provider: ctx.get('provider'),
					...properties
				},
				ctx.req.raw
			);
		},
		forward(ctx, response) {
			return ctx.newResponse(
				response.body,
				response.status as any,
				Object.fromEntries(response.headers.entries())
			);
		},
		async set(ctx, key, maxAge, value) {
			setCookie(ctx, key, await encrypt(value), {
				maxAge,
				httpOnly: true,
				...(ctx.req.url.startsWith('https://') ? { secure: true, sameSite: 'None' } : {})
			});
		},
		async get(ctx: Context, key: string) {
			const raw = getCookie(ctx, key);
			if (!raw) return;
			return decrypt(raw).catch((ex) => {
				console.error('failed to decrypt', key, ex);
			});
		},
		async unset(ctx: Context, key: string) {
			deleteCookie(ctx, key);
		},
		async invalidate(subject: string) {
			// Resolve the scan in case modifications interfere with iteration
			const keys = await Array.fromAsync(Storage.scan(this.storage, ['oauth:refresh', subject]));
			for (const [key] of keys) {
				await Storage.remove(this.storage, key);
			}
		},
		storage
	};

	/**
	 * The alphabet a user code is drawn from, which is not the whole one.
	 *
	 * Someone reads this off one screen and types it into another, so every
	 * pair that looks or sounds alike is a support ticket: no vowels, so no
	 * accidental words; no `0`/`O`, `1`/`I`, `5`/`S`, `2`/`Z`. What is left is
	 * unambiguous read aloud over a phone. RFC 8628 §6.1 asks for exactly this
	 * trade and the entropy lost is bought back by the length.
	 */
	const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRTVWXY346789';
	const USER_CODE_LENGTH = 8;

	/** Nothing a person reads, so the whole alphabet is available. */
	const CSRF_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

	/**
	 * What is known after signing in and before confirming.
	 *
	 * This is the half of the flow that has no answer yet: a browser that has
	 * proved who it belongs to, holding a code it has not said yes to. It is
	 * kept in an encrypted cookie rather than on the grant so that a person who
	 * closes the tab at this point has authorized nothing.
	 */
	interface DeviceConfirmation {
		/** The hash, which is all this side of the flow ever sees. */
		deviceCode: string;
		userCode: string;
		clientID: string;
		csrf: string;
		subject: DeviceGrantSubject;
	}

	/**
	 * The code as stored, from the code as a person typed it.
	 *
	 * People retype what they see, which includes the separator that made it
	 * readable and whatever case their keyboard was in. Neither carries
	 * meaning, so neither is allowed to make a valid code fail.
	 */
	function canonicalUserCode(raw: string) {
		return raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
	}

	/** Enough escaping to put an attacker-chosen client name on a page safely. */
	function escapeHtml(raw: string) {
		return raw
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}

	/**
	 * The page that asks the only question that authorizes anything.
	 *
	 * It shows the code back, because that is the check a person can actually
	 * perform: the code here and the code on the device in front of them either
	 * match or they do not, and if they do not then somebody else sent this
	 * link. Approving is a POST carrying a value that was put in the cookie
	 * alongside it, so a page on another site cannot submit it on their behalf.
	 */
	function deviceConfirmPage(confirmation: DeviceConfirmation) {
		const code = escapeHtml(confirmation.userCode);
		const client = escapeHtml(confirmation.clientID);
		return (
			`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">` +
			`<title>Confirm sign-in</title>` +
			`<h1>Is this you?</h1>` +
			`<p><strong>${client}</strong> is asking to sign in to your account.</p>` +
			`<p>The code it is showing you should be:</p>` +
			`<p><code style="font-size:2em;letter-spacing:.2em">${code.slice(0, 4)}-${code.slice(4)}</code></p>` +
			`<p>If those do not match, or you did not start this on a device of your own, ` +
			`choose Deny. Nobody can sign in as you unless you approve here.</p>` +
			`<form method="post" action="/device/confirm">` +
			`<input type="hidden" name="csrf" value="${escapeHtml(confirmation.csrf)}">` +
			`<button type="submit" name="action" value="approve">Approve</button> ` +
			`<button type="submit" name="action" value="deny">Deny</button>` +
			`</form>`
		);
	}

		async function getAuthorization(ctx: Context) {
		const match = (await auth.get(ctx, 'authorization')) || ctx.get('authorization');
		if (!match) throw new UnknownStateError();
		return match as AuthorizationState;
	}

	async function encrypt(value: any) {
		return await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(value)))
			.setProtectedHeader({ alg: 'RSA-OAEP-512', enc: 'A256GCM' })
			.encrypt(await encryptionKey().then((k) => k.public));
	}

	async function resolveSubject(type: string, properties: any) {
		const jsonString = JSON.stringify(properties);
		const encoder = new TextEncoder();
		const data = encoder.encode(jsonString);
		const hashBuffer = await crypto.subtle.digest('SHA-1', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		return `${type}:${hashHex.slice(0, 16)}`;
	}

	async function generateTokens(
		ctx: Context,
		value: {
			type: string;
			properties: any;
			subject: string;
			clientID: string;
			ttl: {
				access: number;
				refresh: number;
			};
			timeUsed?: number;
			nextToken?: string;
		},
		opts?: {
			generateRefreshToken?: boolean;
		}
	) {
		const refreshToken = value.nextToken ?? crypto.randomUUID();
		if (opts?.generateRefreshToken ?? true) {
			/**
			 * Generate and store the next refresh token after the one we are currently returning.
			 * Reserving these in advance avoids concurrency issues with multiple refreshes.
			 * Similar treatment should be given to any other values that may have race conditions,
			 * for example if a jti claim was added to the access token.
			 */
			const refreshValue = {
				...value,
				nextToken: crypto.randomUUID()
			};
			delete refreshValue.timeUsed;
			await Storage.set(
				storage!,
				['oauth:refresh', value.subject, refreshToken],
				refreshValue,
				value.ttl.refresh
			);
		}
		const accessTimeUsed = Math.floor((value.timeUsed ?? Date.now()) / 1000);
		return {
			access: await new SignJWT({
				mode: 'access',
				type: value.type,
				properties: value.properties,
				aud: value.clientID,
				iss: issuer(ctx),
				sub: value.subject
			})
				.setExpirationTime(Math.floor(accessTimeUsed + value.ttl.access))
				.setProtectedHeader(
					await signingKey().then((k) => ({
						alg: k.alg,
						kid: k.id,
						typ: 'JWT'
					}))
				)
				.sign(await signingKey().then((item) => item.private)),
			expiresIn: Math.floor(accessTimeUsed + value.ttl.access - Date.now() / 1000),
			refresh: [value.subject, refreshToken].join(':')
		};
	}

	async function decrypt(value: string) {
		return JSON.parse(
			new TextDecoder().decode(
				await compactDecrypt(value, await encryptionKey().then((v) => v.private)).then(
					(value) => value.plaintext
				)
			)
		);
	}

	function issuer(ctx: Context) {
		return new URL(getRelativeUrl(ctx, '/')).origin;
	}

	const app = new Hono<{
		Variables: {
			authorization: AuthorizationState;
		};
	}>().use(logger());

	for (const [name, value] of Object.entries(input.providers)) {
		const route = new Hono<any>();
		route.use(async (c, next) => {
			c.set('provider', name);
			await next();
		});
		value.init(route, {
			name,
			...auth
		});
		app.route(`/${name}`, route);
	}

	app.get(
		'/.well-known/jwks.json',
		cors({
			origin: '*',
			allowHeaders: ['*'],
			allowMethods: ['GET'],
			credentials: false
		}),
		async (c) => {
			const all = await allSigning();
			return c.json({
				keys: all.map((item) => ({
					...item.jwk,
					alg: item.alg,
					exp: item.expired ? Math.floor(item.expired.getTime() / 1000) : undefined
				}))
			});
		}
	);

	app.get(
		'/.well-known/oauth-authorization-server',
		cors({
			origin: '*',
			allowHeaders: ['*'],
			allowMethods: ['GET'],
			credentials: false
		}),
		async (c) => {
			const iss = issuer(c);
			return c.json({
				issuer: iss,
				authorization_endpoint: `${iss}/authorize`,
				token_endpoint: `${iss}/token`,
				device_authorization_endpoint: `${iss}/device/authorize`,
				jwks_uri: `${iss}/.well-known/jwks.json`,
				response_types_supported: ['code', 'token'],
				grant_types_supported: [
					'authorization_code',
					'refresh_token',
					'client_credentials',
					DEVICE_GRANT
				]
			});
		}
	);

	app.post(
		'/token',
		cors({
			origin: '*',
			allowHeaders: ['*'],
			allowMethods: ['POST'],
			credentials: false
		}),
		async (c) => {
			const form = await c.req.formData();
			const grantType = form.get('grant_type');

			if (grantType === 'authorization_code') {
				const code = form.get('code');
				if (!code)
					return c.json(
						{
							error: 'invalid_request',
							error_description: 'Missing code'
						},
						400
					);
				const key = ['oauth:code', code.toString()];
				const payload = await Storage.get<{
					type: string;
					properties: any;
					clientID: string;
					redirectURI: string;
					subject: string;
					ttl: {
						access: number;
						refresh: number;
					};
					pkce?: AuthorizationState['pkce'];
				}>(storage, key);
				if (!payload) {
					return c.json(
						{
							error: 'invalid_grant',
							error_description: 'Authorization code has been used or expired'
						},
						400
					);
				}
				if (payload.redirectURI !== form.get('redirect_uri')) {
					return c.json(
						{
							error: 'invalid_redirect_uri',
							error_description: 'Redirect URI mismatch'
						},
						400
					);
				}
				if (payload.clientID !== form.get('client_id')) {
					return c.json(
						{
							error: 'unauthorized_client',
							error_description: 'Client is not authorized to use this authorization code'
						},
						403
					);
				}

				if (payload.pkce) {
					const codeVerifier = form.get('code_verifier')?.toString();
					if (!codeVerifier)
						return c.json(
							{
								error: 'invalid_grant',
								error_description: 'Missing code_verifier'
							},
							400
						);

					if (!(await validatePKCE(codeVerifier, payload.pkce.challenge, payload.pkce.method))) {
						return c.json(
							{
								error: 'invalid_grant',
								error_description: 'Code verifier does not match'
							},
							400
						);
					}
				}
				const tokens = await generateTokens(c, payload);
				await Storage.remove(storage, key);
				return c.json({
					access_token: tokens.access,
					expires_in: tokens.expiresIn,
					refresh_token: tokens.refresh
				});
			}

			if (grantType === 'refresh_token') {
				const refreshToken = form.get('refresh_token');
				if (!refreshToken)
					return c.json(
						{
							error: 'invalid_request',
							error_description: 'Missing refresh_token'
						},
						400
					);
				const splits = refreshToken.toString().split(':');
				const token = splits.pop()!;
				const subject = splits.join(':');
				const key = ['oauth:refresh', subject, token];
				const payload = await Storage.get<{
					type: string;
					properties: any;
					clientID: string;
					subject: string;
					ttl: {
						access: number;
						refresh: number;
					};
					nextToken: string;
					timeUsed?: number;
				}>(storage, key);
				if (!payload) {
					return c.json(
						{
							error: 'invalid_grant',
							error_description: 'Refresh token has been used or expired'
						},
						400
					);
				}
				const generateRefreshToken = !payload.timeUsed;
				if (ttlRefreshReuse <= 0) {
					// no reuse interval, remove the refresh token immediately
					await Storage.remove(storage, key);
				} else if (!payload.timeUsed) {
					payload.timeUsed = Date.now();
					await Storage.set(storage, key, payload, ttlRefreshReuse + ttlRefreshRetention);
				} else if (Date.now() > payload.timeUsed + ttlRefreshReuse * 1000) {
					// token was reused past the allowed interval
					await auth.invalidate(subject);
					return c.json(
						{
							error: 'invalid_grant',
							error_description: 'Refresh token has been used or expired'
						},
						400
					);
				}
				const tokens = await generateTokens(c, payload, {
					generateRefreshToken
				});
				return c.json({
					access_token: tokens.access,
					refresh_token: tokens.refresh,
					expires_in: tokens.expiresIn
				});
			}

			if (grantType === DEVICE_GRANT) {
				const deviceCode = form.get('device_code')?.toString();
				const clientID = form.get('client_id')?.toString();
				if (!deviceCode)
					return c.json(
						{ error: 'invalid_request', error_description: 'Missing device_code' },
						400
					);
				if (!clientID)
					return c.json(
						{ error: 'invalid_request', error_description: 'Missing client_id' },
						400
					);

				const hash = await hashDeviceCode(deviceCode);
				const grant = await deviceStore.byDeviceCode(hash);

				// A code nobody issued and a code that has aged out are the
				// same answer on purpose: telling the two apart would let a
				// caller learn which random strings were once real.
				if (!grant || grant.expires <= Date.now()) {
					if (grant) await deviceStore.remove(hash);
					return c.json(
						{ error: 'expired_token', error_description: 'The device code has expired' },
						400
					);
				}

				// The code belongs to the program that asked for it. Without
				// this, a code leaked to anybody at all is redeemable by
				// anybody at all, and the client identifier the token ends up
				// carrying is whatever the last caller claimed.
				if (grant.clientID !== clientID) {
					return c.json(
						{ error: 'invalid_grant', error_description: 'That device code belongs to another client' },
						400
					);
				}

				// Terminal answers come before the rate limit. Slowing down a
				// client that has already been refused just means it takes
				// longer to find out, and it has no reason to poll again.
				if (grant.status === 'denied') {
					await deviceStore.remove(hash);
					return c.json(
						{ error: 'access_denied', error_description: 'The request was denied' },
						400
					);
				}

				const now = Date.now();
				if (now - grant.lastPolled < grant.interval * 1000) {
					// RFC 8628 §3.5: every warning widens the interval for this
					// and every later poll, so a client that ignores the answer
					// is not simply told the same thing again. `lastPolled` is
					// deliberately not moved — the window is measured from the
					// last poll that got a real answer, so a burst of impatient
					// polls costs one wait rather than compounding into one the
					// client can never satisfy.
					// Capped, because the interval only ever grows and a code
					// that lives ten minutes must stay pollable for all of it.
					// Uncapped, enough impatience early on makes the code
					// unusable for the rest of its life.
					await deviceStore.recordPoll(
						hash,
						grant.lastPolled,
						Math.min(grant.interval + 5, DEVICE_MAX_INTERVAL)
					);
					return c.json({ error: 'slow_down', error_description: 'Polling too frequently' }, 400);
				}

				if (grant.status === 'approved') {
					// One redemption, and the store is what enforces it: taking
					// the grant away and reading it are the same operation, so
					// two polls arriving together cannot both be served. A
					// device code that keeps working after it has produced
					// tokens is a bearer token with none of a bearer token's
					// expiry.
					const claimed = await deviceStore.consume(hash, clientID);
					if (!claimed?.subject) {
						return c.json(
							{ error: 'expired_token', error_description: 'The device code has expired' },
							400
						);
					}

					// Minted now rather than at approval, so the lifetime the
					// client is told about starts when it receives them. Tokens
					// made when the person clicked would already have been
					// ageing for however long the next poll took, and a grant
					// nobody ever collects would have left a usable refresh
					// token lying in the store.
					const tokens = await generateTokens(c, {
						subject: claimed.subject.subject,
						type: claimed.subject.type,
						properties: claimed.subject.properties,
						clientID: claimed.clientID,
						ttl: claimed.subject.ttl
					});
					return c.json({
						access_token: tokens.access,
						refresh_token: tokens.refresh,
						expires_in: tokens.expiresIn
					});
				}

				await deviceStore.recordPoll(hash, now, grant.interval);
				return c.json(
					{
						error: 'authorization_pending',
						error_description: 'The user has not finished signing in'
					},
					400
				);
			}

			if (grantType === 'client_credentials') {
				const provider = form.get('provider');
				if (!provider) return c.json({ error: 'missing `provider` form value' }, 400);
				const match = input.providers[provider.toString()];
				if (!match) return c.json({ error: 'invalid `provider` query parameter' }, 400);
				if (!match.client)
					return c.json({ error: 'this provider does not support client_credentials' }, 400);
				const clientID = form.get('client_id');
				const clientSecret = form.get('client_secret');
				if (!clientID) return c.json({ error: 'missing `client_id` form value' }, 400);
				if (!clientSecret) return c.json({ error: 'missing `client_secret` form value' }, 400);
				const response = await match.client({
					clientID: clientID.toString(),
					clientSecret: clientSecret.toString(),
					params: Object.fromEntries(form) as Record<string, string>
				});
				return input.success(
					{
						async subject(type, properties, opts) {
							const tokens = await generateTokens(c, {
								type: type as string,
								subject: opts?.subject || (await resolveSubject(type, properties)),
								properties,
								clientID: clientID.toString(),
								ttl: {
									access: opts?.ttl?.access ?? ttlAccess,
									refresh: opts?.ttl?.refresh ?? ttlRefresh
								}
							});
							return c.json({
								access_token: tokens.access,
								refresh_token: tokens.refresh
							});
						}
					},
					{
						provider: provider.toString(),
						...response
					},
					c.req.raw
				);
			}

			throw new Error('Invalid grant_type');
		}
	);

	// The machine half of RFC 8628. A program with no browser asks for a code
	// here, shows it to whoever is sitting in front of it, and polls `/token`
	// until somebody has answered for it on a device that does have one.
	app.post(
		'/device/authorize',
		cors({
			origin: '*',
			allowHeaders: ['*'],
			allowMethods: ['POST'],
			credentials: false
		}),
		async (c) => {
			const form = await c.req.formData().catch(() => null);
			const clientID = form?.get('client_id')?.toString();
			if (!clientID)
				return c.json({ error: 'invalid_request', error_description: 'Missing client_id' }, 400);
			if (input.allowDeviceClient && !(await input.allowDeviceClient(clientID, c.req.raw)))
				return c.json(
					{ error: 'invalid_client', error_description: 'Unknown client_id' },
					400
				);

			// Not `randomUUID`: a device code is the credential the tokens are
			// handed to, so it gets the same treatment as one — full-width
			// randomness, and only its hash is written down.
			const deviceCode = generateUnbiasedString(CSRF_ALPHABET, 43);
			const deviceCodeHash = await hashDeviceCode(deviceCode);

			// Retried rather than trusted to be unique: the alphabet is small
			// on purpose, so a collision is likelier than it would be for the
			// device code, and a collision here hands one person's sign-in to
			// somebody else's machine.
			let userCode = '';
			for (let attempt = 0; attempt < 5; attempt++) {
				const candidate = generateUnbiasedString(USER_CODE_ALPHABET, USER_CODE_LENGTH);
				if (!(await deviceStore.byUserCode(candidate))) {
					userCode = candidate;
					break;
				}
			}
			if (!userCode)
				return c.json(
					{ error: 'server_error', error_description: 'Could not allocate a user code' },
					500
				);

			await deviceStore.create({
				deviceCodeHash,
				userCode,
				clientID,
				status: 'pending',
				interval: deviceInterval,
				lastPolled: 0,
				expires: Date.now() + ttlDevice * 1000
			});

			const iss = issuer(c);
			return c.json({
				device_code: deviceCode,
				user_code: userCode,
				verification_uri: `${iss}/device`,
				verification_uri_complete: `${iss}/device?user_code=${userCode}`,
				expires_in: ttlDevice,
				interval: deviceInterval
			});
		}
	);

	// The browser half. Entering the code puts the flow into the same
	// authorization state a redirect-based client would have set, so the
	// providers below are reached by exactly one path either way.
	//
	// Reaching this page authorizes nothing. It starts a sign-in, and the
	// sign-in ends at a confirmation page — see `/device/confirm`.
	app.get('/device', async (c) => {
		const raw = c.req.query('user_code');
		if (!raw) {
			return c.html(
				`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">` +
					`<title>Sign in to a device</title>` +
					`<form method="get" action="/device">` +
					`<label for="user_code">Enter the code shown in the app</label>` +
					`<input id="user_code" name="user_code" autocomplete="off" autofocus>` +
					`<button type="submit">Continue</button>` +
					`</form>`
			);
		}

		const found = await deviceStore.byUserCode(canonicalUserCode(raw));
		if (!found || found.status !== 'pending' || found.expires <= Date.now()) {
			return c.text('That code is not valid any more. Ask the app for a new one.', 400);
		}

		const authorization: AuthorizationState = {
			response_type: 'device_code',
			client_id: found.clientID,
			device_code: found.deviceCodeHash
		} as AuthorizationState;
		await auth.set(c, 'authorization', ttlDevice, authorization);

		const provider = c.req.query('provider');
		if (provider) return c.redirect(`/${provider}/authorize`);
		const providers = Object.keys(input.providers);
		if (providers.length === 1) return c.redirect(`/${providers[0]}/authorize`);
		return auth.forward(
			c,
			await select()(
				Object.fromEntries(
					Object.entries(input.providers).map(([key, value]) => [key, value.type])
				),
				c.req.raw
			)
		);
	});

	// The step that actually authorizes, and the reason there is one.
	//
	// Anybody at all can ask for a device code and be handed a link with the
	// user code already filled in. If following that link and signing in were
	// enough, then sending it to somebody would be enough: they would sign in
	// to what looks like an ordinary prompt, and whoever kept the device code
	// would poll and collect their tokens. What stops that is not the sign-in,
	// which the victim performs perfectly well — it is being shown the code and
	// the program asking, and having to say yes to *that*.
	//
	// A POST, because it changes something. Carrying a value from the cookie,
	// so another site cannot post it on the person's behalf.
	app.post('/device/confirm', async (c) => {
		const confirmation = (await auth.get(c, 'device_confirm')) as DeviceConfirmation | undefined;
		if (!confirmation) {
			return c.text('That sign-in request has expired. Start it again from the app.', 400);
		}
		await auth.unset(c, 'device_confirm');

		const form = await c.req.formData().catch(() => null);
		const csrf = form?.get('csrf')?.toString() ?? '';
		if (!timingSafeCompare(confirmation.csrf, csrf)) {
			return c.text('That form was not the one we sent. Start again from the app.', 400);
		}

		if (form?.get('action')?.toString() === 'deny') {
			await deviceStore.deny(confirmation.deviceCode);
			return c.text('That sign-in request was refused. You can close this page.');
		}

		// The store decides, not this code. If a refusal got here first the
		// answer is already given and an approval must not overwrite it.
		const approved = await deviceStore.approve(confirmation.deviceCode, confirmation.subject);
		if (!approved) {
			return c.text('That sign-in request has already been answered.', 400);
		}
		return c.text('You are signed in. You can close this page and go back to the app.');
	});

		app.get('/authorize', async (c) => {
		const provider = c.req.query('provider');
		const response_type = c.req.query('response_type');
		const redirect_uri = c.req.query('redirect_uri');
		const state = c.req.query('state');
		const client_id = c.req.query('client_id');
		const audience = c.req.query('audience');
		const code_challenge = c.req.query('code_challenge');
		const code_challenge_method = c.req.query('code_challenge_method');
		const authorization: AuthorizationState = {
			response_type,
			redirect_uri,
			state,
			client_id,
			audience,
			pkce:
				code_challenge && code_challenge_method
					? {
							challenge: code_challenge,
							method: code_challenge_method
						}
					: undefined
		} as AuthorizationState;
		c.set('authorization', authorization);

		if (!redirect_uri) {
			return c.text('Missing redirect_uri', { status: 400 });
		}

		if (!response_type) {
			throw new MissingParameterError('response_type');
		}

		if (!client_id) {
			throw new MissingParameterError('client_id');
		}

		if (input.start) {
			await input.start(c.req.raw);
		}

		if (
			!(await allow()(
				{
					clientID: client_id,
					redirectURI: redirect_uri,
					audience
				},
				c.req.raw
			))
		)
			throw new UnauthorizedClientError(client_id, redirect_uri);
		await auth.set(c, 'authorization', 60 * 60 * 24, authorization);
		if (provider) return c.redirect(`/${provider}/authorize`);
		const providers = Object.keys(input.providers);
		if (providers.length === 1) return c.redirect(`/${providers[0]}/authorize`);
		return auth.forward(
			c,
			await select()(
				Object.fromEntries(
					Object.entries(input.providers).map(([key, value]) => [key, value.type])
				),
				c.req.raw
			)
		);
	});

	app.get('/userinfo', async (c) => {
		const header = c.req.header('Authorization');

		if (!header) {
			return c.json(
				{
					error: 'invalid_request',
					error_description: 'Missing Authorization header'
				},
				400
			);
		}

		const [type, token] = header.split(' ');

		if (type !== 'Bearer') {
			return c.json(
				{
					error: 'invalid_request',
					error_description: 'Missing or invalid Authorization header'
				},
				400
			);
		}

		if (!token) {
			return c.json(
				{
					error: 'invalid_request',
					error_description: 'Missing token'
				},
				400
			);
		}

		const result = await jwtVerify<{
			mode: 'access';
			type: keyof SubjectSchema;
			properties: v1.InferInput<SubjectSchema[keyof SubjectSchema]>;
		}>(token, () => signingKey().then((item) => item.public), {
			issuer: issuer(c)
		});

		const validated = await input.subjects[result.payload.type]['~standard'].validate(
			result.payload.properties
		);

		if (!validated.issues && result.payload.mode === 'access') {
			return c.json(validated.value as SubjectSchema);
		}

		return c.json({
			error: 'invalid_token',
			error_description: 'Invalid token'
		});
	});

	app.onError(async (err, c) => {
		console.error(err);
		if (err instanceof UnknownStateError) {
			return auth.forward(c, await error(err, c.req.raw));
		}
		const authorization = await getAuthorization(c);
		// A device grant has no redirect to carry the error back on, so it is
		// said here instead. Without this the reporting path throws on a URL
		// built from `undefined` and the real failure is never printed.
		if (!authorization.redirect_uri) {
			const oauth = err instanceof OauthError ? err : new OauthError('server_error', err.message);
			return c.text(oauth.description || oauth.error, 400);
		}
		const url = new URL(authorization.redirect_uri);
		const oauth = err instanceof OauthError ? err : new OauthError('server_error', err.message);
		url.searchParams.set('error', oauth.error);
		url.searchParams.set('error_description', oauth.description);
		return c.redirect(url.toString());
	});

	return app;
}
