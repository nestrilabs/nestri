import { z } from 'zod';

import { Context } from './context.js';
import { ErrorCodes, VisibleError } from './error.js';

const Public = z.object({
	type: z.literal('public'),
	properties: z.object({})
});

const User = z.object({
	type: z.literal('user'),
	properties: z.object({
		userID: z.string(),
		linkedAccountID: z.string(),
		fingerprint: z.string().optional()
	})
});

const Member = z.object({
	type: z.literal('member'),
	properties: z.object({
		userID: z.string(),
		teamID: z.string(),
		role: z.enum(['owner', 'admin', 'member'])
	})
});

const System = z.object({
	type: z.literal('system'),
	properties: z.object({
		teamID: z.string()
	})
});

const Admin = z.object({
	type: z.literal('admin'),
	properties: z.object({})
});

/**
 * A registered nessh host, authenticated by its own credentials.
 *
 * Deliberately not a `user`: the box acts on behalf of whoever is logged into
 * it, which is not the same authority as its owner. It carries `ownerUserID`
 * for attribution, but `Actor.userID` refuses it, so a route written for a
 * signed-in human cannot silently accept a box instead.
 */
const Machine = z.object({
	type: z.literal('machine'),
	properties: z.object({
		machineID: z.string(),
		ownerUserID: z.string(),
		teamID: z.string().optional()
	})
});

const ActorInfo = z.discriminatedUnion('type', [Public, User, Member, System, Admin, Machine]);
type ActorInfo = z.infer<typeof ActorInfo>;

const _context = Context.create<ActorInfo>();

function _use(): ActorInfo {
	return _context.use();
}

function _with<T>(value: ActorInfo, fn: () => T): T {
	return _context.provide(value, fn);
}

function _assert<T extends ActorInfo['type']>(type: T): Extract<ActorInfo, { type: T }> {
	const actor = _use();
	if (actor.type !== type) {
		throw new VisibleError(
			'internal',
			ErrorCodes.Server.INTERNAL_ERROR,
			`Expected actor type ${type}, got ${actor.type}`
		);
	}
	return actor as Extract<ActorInfo, { type: T }>;
}

export const Actor = {
	Info: ActorInfo,

	use: _use,
	with: _with,
	assert: _assert,

	get type(): ActorInfo['type'] {
		return _use().type;
	},

	get userID(): string {
		const actor = _use();
		if (actor.type === 'user' || actor.type === 'member') {
			return actor.properties.userID;
		}
		if (actor.type === 'machine') {
			// A box holds credentials but is not its owner. Refusing here is
			// what keeps a route written for a human from accepting a box —
			// and it is a caller error, not a server fault, so it must not
			// surface as a 500.
			throw new VisibleError(
				'forbidden',
				ErrorCodes.Permission.INSUFFICIENT_PERMISSIONS,
				'A machine cannot act as its owner; this route requires a user session'
			);
		}
		throw new VisibleError(
			'internal',
			ErrorCodes.Server.INTERNAL_ERROR,
			`Actor type ${actor.type} has no userID`
		);
	},

	get machineID(): string {
		const actor = _use();
		if (actor.type === 'machine') {
			return actor.properties.machineID;
		}
		throw new VisibleError(
			'internal',
			ErrorCodes.Server.INTERNAL_ERROR,
			`Actor type ${actor.type} has no machineID`
		);
	},

	get linkedAccountID(): string {
		const actor = _use();
		if (actor.type === 'user') {
			return actor.properties.linkedAccountID;
		}
		throw new VisibleError(
			'internal',
			ErrorCodes.Server.INTERNAL_ERROR,
			`Actor type ${actor.type} has no linkedAccountID`
		);
	},

	get fingerprint(): string | undefined {
		const actor = _use();
		if (actor.type === 'user') {
			return actor.properties.fingerprint;
		}
		return undefined;
	},

	get useTeam(): string {
		const actor = _use();
		if (actor.type === 'member' || actor.type === 'system') {
			return actor.properties.teamID;
		}
		throw new VisibleError(
			'internal',
			ErrorCodes.Server.INTERNAL_ERROR,
			`Actor type ${actor.type} has no team scope`
		);
	},

	get role(): 'owner' | 'admin' | 'member' {
		const actor = _use();
		if (actor.type === 'member') {
			return actor.properties.role;
		}
		throw new VisibleError(
			'internal',
			ErrorCodes.Server.INTERNAL_ERROR,
			`Actor type ${actor.type} has no role`
		);
	},

	get isSignedIn(): boolean {
		try {
			return _use().type !== 'public';
		} catch {
			return false;
		}
	}
};
