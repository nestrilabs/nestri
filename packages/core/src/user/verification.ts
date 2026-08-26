import { createHash, randomBytes } from 'node:crypto';

import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { fn } from '../fn.js';
import { Identifier } from '../id.js';
import { UserTable } from './user.sql.js';
import { VerificationKindEnum, VerificationTable } from './verification.sql.js';

export function hashCode(code: string): string {
	return createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
	const bytes = randomBytes(3);
	return String((bytes[0]! << 16) | (bytes[1]! << 8) | bytes[2]!)
		.padStart(6, '0')
		.slice(0, 6);
}

export const MAX_VERIFICATION_ATTEMPTS = 5;
export const VERIFICATION_TTL_MINUTES = 10;

export namespace Verification {
	export const create = fn(
		z.object({
			userId: z.string(),
			kind: z.enum(VerificationKindEnum.enumValues),
			code: z.string().optional()
		}),
		async (input) => {
			const code = input.code ?? generateCode();
			// Old codes must not stay valid once a fresh one exists.
			await Database.use(async (tx) => {
				await tx
					.update(VerificationTable)
					.set({ consumedAt: sql`now()` })
					.where(
						and(
							eq(VerificationTable.userId, input.userId),
							eq(VerificationTable.kind, input.kind),
							isNull(VerificationTable.consumedAt)
						)
					);
				await tx.insert(VerificationTable).values({
					id: Identifier.ascending('verification'),
					userId: input.userId,
					kind: input.kind,
					codeHash: hashCode(code),
					expiresAt: sql`now() + interval '${sql.raw(String(VERIFICATION_TTL_MINUTES))} minutes'`,
					attempts: 0,
					consumedAt: null
				});
			});
			return code;
		}
	);

	/**
	 * Redeem a code for the user's email.
	 *
	 * The whole flow — find the active code, check the hash, burn the code,
	 * flip the flag — happens in one transaction so a code cannot be raced
	 * into double use.
	 */
	export const verifyEmail = fn(
		z.object({ userId: z.string(), code: z.string() }),
		async (input) => {
			return Database.transaction(async (tx) => {
				const active = await tx
					.select()
					.from(VerificationTable)
					.where(
						and(
							eq(VerificationTable.userId, input.userId),
							eq(VerificationTable.kind, 'email'),
							isNull(VerificationTable.consumedAt),
							gt(VerificationTable.expiresAt, sql`now()`)
						)
					)
					.orderBy(desc(VerificationTable.timeCreated))
					.then((rows) => rows.at(0) ?? null);

				if (!active) {
					return { ok: false as const, reason: 'no_active_code' as const };
				}

				if (hashCode(input.code) !== active.codeHash) {
					const burn = active.attempts + 1 >= MAX_VERIFICATION_ATTEMPTS;
					await tx
						.update(VerificationTable)
						.set({
							attempts: sql`${VerificationTable.attempts} + 1`,
							// Exhausted codes are consumed so the next attempt
							// asks for a fresh one instead of counting forever.
							consumedAt: burn ? sql`now()` : undefined
						})
						.where(eq(VerificationTable.id, active.id));
					return { ok: false as const, reason: 'wrong_code' as const };
				}

				await tx
					.update(VerificationTable)
					.set({ consumedAt: sql`now()` })
					.where(eq(VerificationTable.id, active.id));
				await tx
					.update(UserTable)
					.set({ emailVerified: true })
					.where(eq(UserTable.id, input.userId));
				return { ok: true as const };
			});
		}
	);

	export const findActiveByUserAndKind = fn(
		z.object({ userId: z.string(), kind: z.enum(VerificationKindEnum.enumValues) }),
		async (input) => {
			return Database.use(async (tx) => {
				return tx
					.select()
					.from(VerificationTable)
					.where(
						and(
							eq(VerificationTable.userId, input.userId),
							eq(VerificationTable.kind, input.kind),
							isNull(VerificationTable.consumedAt),
							gt(VerificationTable.expiresAt, sql`now()`)
						)
					)
					.orderBy(desc(VerificationTable.timeCreated))
					.then((rows) => rows.at(0) ?? null);
			});
		}
	);

	export const consume = fn(z.string(), async (id) => {
		await Database.use(async (tx) => {
			await tx
				.update(VerificationTable)
				.set({ consumedAt: sql`now()` })
				.where(eq(VerificationTable.id, id));
		});
	});
}
