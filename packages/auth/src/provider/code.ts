/**
 * Configures a provider that supports pin code authentication. This is usually paired with the
 * `CodeUI`.
 *
 * ```ts
 * import { CodeUI } from "@openauthjs/openauth/ui/code"
 * import { CodeProvider } from "@openauthjs/openauth/provider/code"
 *
 * export default issuer({
 *   providers: {
 *     code: CodeProvider(
 *       CodeUI({
 *         copy: {
 *           code_info: "We'll send a pin code to your email"
 *         },
 *         sendCode: (claims, code) => console.log(claims.email, code)
 *       })
 *     )
 *   },
 *   // ...
 * })
 * ```
 *
 * You can customize the provider using.
 *
 * ```ts {7-9}
 * const ui = CodeUI({
 *   // ...
 * })
 *
 * export default issuer({
 *   providers: {
 *     code: CodeProvider(
 *       { ...ui, length: 4 }
 *     )
 *   },
 *   // ...
 * })
 * ```
 *
 * Behind the scenes, the `CodeProvider` expects callbacks that implements request handlers
 * that generate the UI for the following.
 *
 * ```ts
 * CodeProvider({
 *   // ...
 *   request: (req, state, form, error) => Promise<Response>
 * })
 * ```
 *
 * This allows you to create your own UI.
 *
 * @packageDocumentation
 */
import { Context } from 'hono';

import { generateUnbiasedDigits, generateUnbiasedString, timingSafeCompare } from '../random.js';
import { Storage } from '../storage/storage.js';
import { requestAddress } from '../util.js';
import { MARK_CODE } from '../ui/mark.js';
import type { Screen } from '../ui/screen.js';
import { Provider } from './provider.js';

export interface CodeProviderConfig<
	Claims extends Record<string, string> = Record<string, string>
> {
	/**
	 * The length of the pin code.
	 *
	 * @default 6
	 */
	length?: number;
	/**
	 * How long a code stays usable, in seconds.
	 *
	 * A pin is six digits, which is a small space, and the only thing keeping
	 * it small enough to type is that it does not have to last. A code that is
	 * still good tomorrow is a password with a million possible values.
	 *
	 * @default 600
	 */
	ttl?: number;
	/**
	 * How many wrong guesses a code survives.
	 *
	 * Counted where the person asking cannot reach it, which is the whole
	 * point: the code itself travels in an encrypted cookie the caller holds,
	 * so a counter kept alongside it would be a counter they could reset by
	 * replaying an older copy. Starting over is allowed and costs them a fresh
	 * code — sent to the mailbox they are trying to break into, where somebody
	 * notices.
	 *
	 * @default 5
	 */
	maxAttempts?: number;
	/**
	 * How many codes may be sent to one claim inside {@link sendWindow}.
	 *
	 * Counted against the mailbox and not against the browser asking. A budget
	 * held per sign-in attempt bounds nothing: the caller chooses how many
	 * attempts to start, and starting a new one costs them a discarded cookie.
	 * The thing being protected is the address, so the address is what carries
	 * the count.
	 *
	 * @default 5
	 */
	maxSends?: number;
	/**
	 * The window {@link maxSends} is counted over, in seconds.
	 *
	 * @default 3600
	 */
	sendWindow?: number;
	/**
	 * Seconds between one code and the next for the same claim.
	 *
	 * Without this, `resend` is an open relay pointed at anybody's mailbox: the
	 * address is not the caller's own and nothing asks them to prove otherwise,
	 * so the send button is a way to mail a stranger as fast as requests go
	 * out.
	 *
	 * @default 30
	 */
	resendInterval?: number;
	/**
	 * The form fields that make up a claim. Anything else submitted is dropped
	 * before the claim is counted or sent to.
	 *
	 * The send budget is keyed by the claim, so a claim built from every field
	 * in the form is a budget the caller can mint at will: one extra field
	 * with a new value each time is a new key, and the same mailbox gets an
	 * unbounded number of codes.
	 *
	 * @default ['email', 'phone']
	 */
	claimFields?: string[];
	/**
	 * How many codes one caller may have sent, to any claims, inside
	 * {@link addressWindow}.
	 *
	 * The per-claim budget protects a mailbox. This one protects everything
	 * else: without it a caller with a list of addresses can spend the whole
	 * sending allowance of the deployment, at five codes each, on strangers.
	 *
	 * @default 10
	 */
	maxSendsPerAddress?: number;
	/**
	 * The window {@link maxSendsPerAddress} is counted over, in seconds.
	 *
	 * A day rather than the hour a mailbox gets, because the caller this is
	 * for paces itself: a handful of addresses an hour stays under any hourly
	 * budget a person would also fit under, and still adds up to hundreds of
	 * strangers mailed by the end of the day.
	 *
	 * @default 86400
	 */
	addressWindow?: number;
	/**
	 * Who is asking, for {@link maxSendsPerAddress}. A request it returns
	 * nothing for is not counted.
	 *
	 * @default the address the proxy in front reports
	 */
	address?: (req: Request) => string | undefined;
	/**
	 * What to ask for at each step of the flow.
	 *
	 * Returns a {@link Screen} describing the question, not a rendered page.
	 * Which one is drawn follows from `state`, and `error` says what to say
	 * above it.
	 */
	request: (
		req: Request,
		state: CodeProviderState,
		form?: FormData,
		error?: CodeProviderError
	) => Promise<Screen>;
	/**
	 * Callback to send the pin code to the user.
	 *
	 * @example
	 * ```ts
	 * {
	 *   sendCode: async (claims, code) => {
	 *     // Send the code through the email or phone number based on the claims
	 *   }
	 * }
	 * ```
	 */
	sendCode: (claims: Claims, code: string) => Promise<void | CodeProviderError>;
}

/**
 * The state of the code flow.
 *
 * | State | Description |
 * | ----- | ----------- |
 * | `start` | The user is asked to enter their email address or phone number to start the flow. |
 * | `code` | The user needs to enter the pin code to verify their _claim_. |
 */
export type CodeProviderState =
	| {
			type: 'start';
	  }
	| {
			type: 'code';
			resend?: boolean;
			code: string;
			claims: Record<string, string>;
			/**
			 * Names the server-side record holding this code's remaining
			 * guesses. Regenerated with every code, so a caller who rolls back
			 * to an older cookie rolls back to a code that is no longer live.
			 */
			flow: string;
			/** When the code stops being accepted, in ms. */
			expires: number;
	  };

/**
 * The errors that can happen on the code flow.
 *
 * | Error | Description |
 * | ----- | ----------- |
 * | `invalid_code` | The code is invalid. |
 * | `invalid_claim` | The _claim_, email or phone number, is invalid. |
 */
export type CodeProviderError =
	| {
			type: 'invalid_code';
	  }
	| {
			type: 'invalid_claim';
			key: string;
			value: string;
	  }
	/** Too many guesses, or codes asked for too quickly. */
	| {
			type: 'rate_limit';
	  };

/** Nothing a person reads, so the whole alphabet is available. */
const FLOW_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function CodeProvider<Claims extends Record<string, string> = Record<string, string>>(
	config: CodeProviderConfig<Claims>
): Provider<{ claims: Claims }> {
	const length = config.length || 6;
	const ttl = config.ttl ?? 60 * 10;
	const maxAttempts = config.maxAttempts ?? 5;
	const maxSends = config.maxSends ?? 5;
	const sendWindow = config.sendWindow ?? 60 * 60;
	const resendInterval = config.resendInterval ?? 30;
	const claimFields = config.claimFields ?? ['email', 'phone'];
	const maxSendsPerAddress = config.maxSendsPerAddress ?? 10;
	const addressWindow = config.addressWindow ?? 60 * 60 * 24;
	const address = config.address ?? requestAddress;

	function generate() {
		return generateUnbiasedDigits(length);
	}

	/** Where a flow's remaining guesses live, on the server. */
	function attemptKey(flow: string) {
		return ['oauth:code:flow', flow];
	}

	/**
	 * Where the last send to one claim is remembered.
	 *
	 * Keyed by the claim and not by the caller, because the mailbox is what is
	 * being protected and the caller is whoever is pointing at it. Two people
	 * asking for a code for one address in the same minute is the case this is
	 * for, and it is the same case whether they are the same person or not.
	 */
	function claimKey(claims: Record<string, string>) {
		const flattened = Object.entries(claims)
			.map(([key, value]) => `${key}=${String(value).trim().toLowerCase()}`)
			.sort()
			.join('&');
		return ['oauth:code:claim', flattened];
	}

	/** Where the sends one caller has asked for are counted. */
	function addressKey(value: string) {
		return ['oauth:code:address', value];
	}

	type SendRecord = { at: number; count: number; since: number };

	/** The record after one more send, opening a new window if the last one closed. */
	function counted(record: SendRecord | null, now: number, window: number): SendRecord {
		const open = record && now - record.since < window * 1000;
		return {
			at: now,
			count: open ? record.count + 1 : 1,
			since: open ? record.since : now
		};
	}

	function exhausted(record: SendRecord | null, now: number, limit: number, window: number) {
		return !!record && now - record.since < window * 1000 && record.count >= limit;
	}

	return {
		type: 'code',
		display: { name: 'Email', icon: MARK_CODE },
		init(routes, ctx) {
			async function transition(
				c: Context,
				next: CodeProviderState,
				fd?: FormData,
				err?: CodeProviderError
			) {
				// The cookie lives exactly as long as the code inside it.
				// Twenty-four hours, which is what this was, made a six-digit
				// pin usable for a day.
				await ctx.set<CodeProviderState>(c, 'provider', ttl, next);
				return ctx.screen(c, await config.request(c.req.raw, next, fd, err));
			}

			routes.get('/authorize', async (c) => {
				const resp = await transition(c, {
					type: 'start'
				});
				return resp;
			});

			routes.post('/authorize', async (c) => {
				const fd = await c.req.formData();
				const state = await ctx.get<CodeProviderState>(c, 'provider');
				const action = fd.get('action')?.toString();

				if (action === 'request' || action === 'resend') {
					const claims = {} as Record<string, string>;
					for (const field of claimFields) {
						const value = fd.get(field);
						if (typeof value === 'string') claims[field] = value;
					}

					// Asked for too soon, or too many times for this mailbox,
					// or too many times from this caller. All three answers are
					// the same on purpose: saying which would tell a caller
					// whether the address they typed has had a code sent to it
					// lately, which is a fact about somebody else's mailbox.
					const now = Date.now();
					const sent = await Storage.get<SendRecord>(ctx.storage, claimKey(claims));
					if (sent && now - sent.at < resendInterval * 1000) {
						return transition(c, state ?? { type: 'start' }, fd, { type: 'rate_limit' });
					}
					if (exhausted(sent, now, maxSends, sendWindow)) {
						return transition(c, state ?? { type: 'start' }, fd, { type: 'rate_limit' });
					}
					const caller = address(c.req.raw);
					const fromCaller = caller
						? await Storage.get<SendRecord>(ctx.storage, addressKey(caller))
						: null;
					if (exhausted(fromCaller, now, maxSendsPerAddress, addressWindow)) {
						return transition(c, state ?? { type: 'start' }, fd, { type: 'rate_limit' });
					}

					const code = generate();
					const err = await config.sendCode(claims as Claims, code);
					if (err) return transition(c, { type: 'start' }, fd, err);

					// The code that was live until a moment ago stops being
					// live now. Leaving it usable would mean each resend added
					// a working code and another budget of guesses to spend on
					// it, so asking for a new code would be how you bought more
					// chances at the old one.
					if (state?.type === 'code') {
						await Storage.remove(ctx.storage, attemptKey(state.flow));
					}

					// A new code means a new flow, which means a fresh budget
					// of guesses — and, more to the point, that the budget
					// attached to the previous code is now unreachable rather
					// than reset.
					const flow = generateUnbiasedString(FLOW_ALPHABET, 32);
					await Storage.set(ctx.storage, attemptKey(flow), { attempts: 0 }, ttl);
					await Storage.set(
						ctx.storage,
						claimKey(claims),
						counted(sent, now, sendWindow),
						sendWindow
					);
					if (caller) {
						await Storage.set(
							ctx.storage,
							addressKey(caller),
							counted(fromCaller, now, addressWindow),
							addressWindow
						);
					}

					return transition(
						c,
						{
							type: 'code',
							resend: action === 'resend',
							claims,
							code,
							flow,
							expires: Date.now() + ttl * 1000
						},
						fd
					);
				}

				if (action === 'verify' && state?.type === 'code') {
					if (state.expires <= Date.now()) {
						await ctx.unset(c, 'provider');
						return transition(c, { type: 'start' }, fd, { type: 'invalid_code' });
					}

					// Counted before the comparison, so a guess costs whether or
					// not it is right. Counted on the server, so the caller
					// holding the cookie cannot wind it back.
					const record = await Storage.get<{ attempts: number }>(
						ctx.storage,
						attemptKey(state.flow)
					);
					if (!record || record.attempts >= maxAttempts) {
						await ctx.unset(c, 'provider');
						await Storage.remove(ctx.storage, attemptKey(state.flow));
						return transition(c, { type: 'start' }, fd, { type: 'rate_limit' });
					}
					await Storage.set(
						ctx.storage,
						attemptKey(state.flow),
						{ ...record, attempts: record.attempts + 1 },
						Math.max(1, Math.ceil((state.expires - Date.now()) / 1000))
					);

					const compare = fd.get('code')?.toString();
					if (!state.code || !compare || !timingSafeCompare(state.code, compare)) {
						return transition(
							c,
							{
								...state,
								resend: false
							},
							fd,
							{ type: 'invalid_code' }
						);
					}

					// Spent. Without this the same code answers again, and the
					// budget of guesses is per code rather than per sign-in.
					await Storage.remove(ctx.storage, attemptKey(state.flow));
					await ctx.unset(c, 'provider');
					return ctx.forward(c, await ctx.success(c, { claims: state.claims as Claims }));
				}

				return transition(c, { type: 'start' }, fd);
			});
		}
	};
}

/**
 * @internal
 */
export type CodeProviderOptions = Parameters<typeof CodeProvider>[0];
