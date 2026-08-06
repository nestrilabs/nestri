import { createClient } from '@nestri/auth/client';
import { AccessToken } from '@nestri/core/access-token/index';
import { Actor } from '@nestri/core/actor';
import { subjects } from '@nestri/core/auth/subjects';
import { Env } from '@nestri/core/env';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Machine } from '@nestri/core/machine/index';
import { Member } from '@nestri/core/team/member';
import type { MiddlewareHandler } from 'hono';

/**
 * Reaches the auth worker over its service binding.
 *
 * The origin has to survive. A binding routes by binding rather than by
 * hostname, so the host is arbitrary — but `new Request` still demands an
 * absolute URL, and stripping down to a bare path threw `Invalid URL` before
 * the token was even looked at.
 */
function bindingFetch(env: Record<string, unknown>) {
	return (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		return (env.AUTH as { fetch: typeof fetch }).fetch(new Request(url, init));
	};
}

/**
 * The issuer must be the auth worker's **public** URL.
 *
 * `verify` checks a token's `iss` claim against the issuer the client was
 * built with, and the auth worker derives what it advertises from the URL it
 * was reached on. Tokens are minted through the public URL, so they carry it.
 * A placeholder like `https://auth.internal` addresses the binding perfectly
 * well — the hostname is ignored there — and then disagrees with every real
 * token. Discovery through the binding does not help: it answers with the
 * placeholder too, because that is the host it was asked on.
 *
 * The failure is silent by nature. A rejected claim is reported as `err`,
 * which is indistinguishable from an expired or forged token, so the whole
 * bearer path returns 401 and looks like ordinary auth working correctly.
 * Hence the explicit throw rather than a fallback: a misconfiguration here
 * takes down every user session, and it should say so.
 */
function getClient(env: Record<string, unknown>) {
	const configured = Env.get().AUTH_ISSUER_URL;
	if (!configured) {
		throw new Error(
			'AUTH_ISSUER_URL is not configured; every bearer token would be rejected as unsigned'
		);
	}
	// The trailing slash matters twice, and both failures are quiet. It is
	// appended to build the discovery URL, where `…:1337//.well-known/…` is a
	// 404; and it is compared literally against the `iss` claim, which carries
	// no trailing slash. A worker URL from the platform arrives with one.
	const issuer = configured.replace(/\/+$/, '');
	return createClient({
		issuer,
		clientID: 'api',
		fetch: bindingFetch(env)
	});
}

export const auth: MiddlewareHandler = async (c, next) => {
	const adminToken = c.req.header('x-nestri-admin-token');
	if (adminToken && adminToken === Env.get().ADMIN_SHARED_SECRET) {
		return Actor.with({ type: 'admin', properties: {} }, next);
	}

	// A registered nessh host proves it is itself, rather than asserting an id
	// nobody checks. Wrong credentials fall through to public rather than
	// erroring, so probing tells an attacker nothing about which ids exist.
	const machineId = c.req.header('x-nestri-machine-id');
	const machineSecret = c.req.header('x-nestri-machine-secret');
	if (machineId && machineSecret) {
		const machine = await Machine.authenticate({ id: machineId, secret: machineSecret });
		if (machine) {
			await Machine.touchLastSeen(machine.id);
			return Actor.with(
				{
					type: 'machine',
					properties: {
						machineID: machine.id,
						ownerUserID: machine.ownerUserId,
						...(machine.teamId ? { teamID: machine.teamId } : {})
					}
				},
				next
			);
		}
		return Actor.with({ type: 'public', properties: {} }, next);
	}

	const authHeader = c.req.header('authorization');
	if (!authHeader) {
		return Actor.with({ type: 'public', properties: {} }, next);
	}

	const match = authHeader.match(/^Bearer (.+)$/);
	if (!match) {
		return Actor.with({ type: 'public', properties: {} }, next);
	}

	const token = match[1];

	// A personal access token is resolved from the database, never through JWT
	// verification. The prefix decides which, so a PAT does not pay for a
	// well-known lookup and a JWT does not pay for a query.
	if (AccessToken.looksLikeToken(token)) {
		const pat = await AccessToken.authenticate(token);
		if (!pat) {
			return Actor.with({ type: 'public', properties: {} }, next);
		}
		await AccessToken.touchLastUsed(pat.id);

		if (pat.teamId) {
			// The team grant is re-checked against live membership rather than
			// trusted from the row, so someone removed from a team loses what
			// their old token carried without anyone remembering to revoke it.
			const membership = await Member.findByTeamAndUser({
				teamId: pat.teamId,
				userId: pat.ownerUserId
			});
			if (!membership) {
				return Actor.with({ type: 'public', properties: {} }, next);
			}
			return Actor.with(
				{
					type: 'member',
					properties: {
						userID: pat.ownerUserId,
						role: membership.role,
						teamID: pat.teamId
					}
				},
				next
			);
		}

		return Actor.with(
			{
				type: 'user',
				properties: {
					userID: pat.ownerUserId,
					// A PAT is tied to neither a Steam account nor a device, so
					// it carries neither. A route needing those must read them
					// from the user rather than assume the caller came by SSH.
					linkedAccountID: '',
					fingerprint: undefined
				}
			},
			next
		);
	}

	// A token that cannot be verified — malformed, expired, or because the
	// auth service is unreachable — makes the caller unauthenticated, not the
	// request a server fault. `verify` reports the first two in `err` and
	// *throws* the third, and an uncaught throw turned a bad token into a 500.
	let verified;
	try {
		verified = await getClient(c.env).verify(subjects, token);
	} catch (error) {
		// eslint-disable-next-line no-console
		console.error('token verification failed:', error);
		return Actor.with({ type: 'public', properties: {} }, next);
	}
	if (verified.err) {
		return Actor.with({ type: 'public', properties: {} }, next);
	}

	const { subject } = verified;
	if (subject.type === 'user') {
		const teamID = c.req.header('x-nestri-team');
		if (teamID) {
			const membership = await Member.findByTeamAndUser({
				teamId: teamID,
				userId: subject.properties.userID
			});
			if (membership) {
				return Actor.with(
					{
						type: 'member',
						properties: {
							userID: subject.properties.userID,
							role: membership.role,
							teamID
						}
					},
					next
				);
			}
		}
		return Actor.with(
			{
				type: 'user',
				properties: {
					userID: subject.properties.userID,
					linkedAccountID: subject.properties.linkedAccountID,
					fingerprint: subject.properties.fingerprint
				}
			},
			next
		);
	}

	return Actor.with({ type: 'public', properties: {} }, next);
};

/**
 * Requires an authenticated caller of any kind, machines included.
 *
 * It deliberately does *not* single machines out: `/games` applies this to the
 * whole group, and download-state — the one route a box exists to call — sits
 * inside it. What stops a box from acting as its owner is `Actor.userID`,
 * which refuses a machine outright, so a route written for a human cannot
 * silently accept a box no matter which guard it sits behind.
 */
export const notPublic: MiddlewareHandler = async (_, next) => {
	const actor = Actor.use();
	if (actor.type === 'public') {
		throw new VisibleError(
			'authentication',
			ErrorCodes.Authentication.UNAUTHORIZED,
			'Missing authorization header'
		);
	}
	return next();
};

/** Requires credentials belonging to a registered nessh host. */
export const machineOnly: MiddlewareHandler = async (_, next) => {
	const actor = Actor.use();
	if (actor.type !== 'machine') {
		throw new VisibleError(
			'forbidden',
			ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
			'Machine credentials required'
		);
	}
	return next();
};

/**
 * A box reporting about itself, or an operator reaching in.
 *
 * The two are not equivalent and routes behind this must not treat them so: a
 * machine may only speak for itself, while admin still has to say which host
 * it means. Keeping admin is what lets an operator repair state by hand.
 */
export const machineOrAdmin: MiddlewareHandler = async (_, next) => {
	const actor = Actor.use();
	if (actor.type !== 'machine' && actor.type !== 'admin') {
		throw new VisibleError(
			'forbidden',
			ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
			'Machine or admin credentials required'
		);
	}
	return next();
};

export const adminOnly: MiddlewareHandler = async (_, next) => {
	const actor = Actor.use();
	if (actor.type !== 'admin') {
		throw new VisibleError(
			'forbidden',
			ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
			'Admin access required'
		);
	}
	return next();
};
