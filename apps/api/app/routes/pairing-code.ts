import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Identifier } from '@nestri/core/id';
import { PairingCode } from '@nestri/core/pairing-code/index';
import { Fingerprint } from '@nestri/core/user/fingerprint';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { adminOnly, ErrorResponses, notPublic, Result, validator } from '../utils';

/**
 * Device enrolment.
 *
 * A pairing code says "this SSH key is also me". It is deliberately not the
 * same thing as an invite, which says "you may use my box" — same shape of
 * secret, completely different authority, and merging them would let one be
 * redeemed for the other.
 *
 * Generating requires an authenticated session; claiming is done by nessh on
 * behalf of a device that has no identity yet, so it authenticates with the
 * shared admin token instead.
 */
export namespace PairingCodeApi {
	export const route = new Hono()
		.post(
			'/',
			notPublic,
			describeRoute({
				tags: ['PairingCode'],
				summary: 'Generate a pairing code',
				description:
					'Create a short-lived, single-use code that enrols another SSH key onto the current user.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({
										code: z.string().meta({ example: Examples.PairingCode.code }),
										expiresInMinutes: z.number()
									})
								)
							}
						},
						description: 'A freshly generated pairing code'
					},
					401: ErrorResponses[401],
					429: ErrorResponses[429]
				}
			}),
			validator(
				'json',
				z.object({
					ttlMinutes: z.number().int().min(1).max(60).default(10).meta({
						description: 'How long the code stays valid. Short by design.'
					})
				})
			),
			async (c) => {
				const { ttlMinutes } = c.req.valid('json');
				const code = await PairingCode.create({
					id: Identifier.ascending('pairingCode'),
					targetUserId: Actor.userID,
					ttlMinutes
				});

				return c.json({ data: { code, expiresInMinutes: ttlMinutes } });
			}
		)
		.post(
			'/claim',
			adminOnly,
			describeRoute({
				tags: ['PairingCode'],
				summary: 'Claim a pairing code for an SSH key',
				description:
					'Redeem a code and bind the supplied SSH fingerprint to the user who generated it. Admin only: the calling device has no identity yet, which is the entire point.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({
										userId: z.string().meta({ example: Examples.PairingCode.targetUserId })
									})
								)
							}
						},
						description: 'The fingerprint now belongs to this user'
					},
					400: ErrorResponses[400],
					403: ErrorResponses[403],
					404: ErrorResponses[404]
				}
			}),
			validator(
				'json',
				z.object({
					code: z.string().min(1).meta({ example: Examples.PairingCode.code }),
					fingerprint: z.string().min(1).meta({
						description: 'SSH public key fingerprint of the device being enrolled'
					})
				})
			),
			async (c) => {
				const { code, fingerprint } = c.req.valid('json');

				// Refuse before claiming: a code is single-use, so burning one on
				// a device that cannot be enrolled would strand the user.
				const existing = await Fingerprint.findByFingerprint(fingerprint);

				const claimed = await PairingCode.claim({ code, fingerprint });
				if (!claimed) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'That pairing code is unknown, already used, or expired'
					);
				}

				if (existing && existing.userId !== claimed.targetUserId) {
					// Handing a device between accounts is a different operation
					// with its own consequences for anything already linked to it;
					// `Steam.resolveSshIdentity` refuses the same case.
					throw new VisibleError(
						'forbidden',
						ErrorCodes.Permission.FORBIDDEN,
						'That SSH key is already enrolled to another user'
					);
				}

				if (existing) {
					await Fingerprint.touchLastSeen(existing.id);
				} else {
					await Fingerprint.create({
						id: Identifier.ascending('userFingerprint'),
						userId: claimed.targetUserId,
						fingerprint,
						name: null
					});
				}

				return c.json({ data: { userId: claimed.targetUserId } });
			}
		);
}
