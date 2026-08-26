import { Actor } from '@nestri/core/actor';
import { Env } from '@nestri/core/env';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { User } from '@nestri/core/user/index';
import { Fingerprint } from '@nestri/core/user/fingerprint';
import { VERIFICATION_TTL_MINUTES, Verification } from '@nestri/core/user/verification';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, notPublic, Result, validator } from '../utils';

const userResponses = {
	200: {
		content: {
			'application/json': {
				schema: Result(
					User.Info.meta({
						description: 'Current user profile',
						example: Examples.User
					})
				)
			}
		},
		description: 'Current user'
	},
	400: ErrorResponses[400],
	404: ErrorResponses[404],
	429: ErrorResponses[429]
} as const;

export namespace UserApi {
	export const route = new Hono()
		.use(notPublic)
		.get(
			'/',
			describeRoute({
				tags: ['User'],
				summary: 'Get current user',
				description: "Get the authenticated user's profile",
				responses: userResponses
			}),
			async (c) => {
				const user = await User.fromID(Actor.userID);

				if (!user) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'Authenticated user not found'
					);
				}

				return c.json({ data: user });
			}
		)
		.post(
			'/email',
			describeRoute({
				tags: ['User'],
				summary: 'Set your email address',
				description:
					'Attach (or replace) the authenticated users email. Verification is reset until the new address is verified.',
				responses: {
					...userResponses,
					200: {
						content: {
							'application/json': {
								schema: Result(
									User.Info.meta({
										description: 'The updated user profile',
										example: Examples.User
									})
								)
							}
						},
						description: 'Email updated'
					}
				}
			}),
			validator(
				'json',
				z.object({
					email: z.email().meta({
						description: 'The new email address',
						example: Examples.User.email
					})
				})
			),
			async (c) => {
				const { email } = c.req.valid('json');
				const user = await User.setEmail({
					id: Actor.userID,
					email,
					emailVerified: false
				});
				return c.json({ data: user });
			}
		)
		.post(
			'/email/send-code',
			describeRoute({
				tags: ['User'],
				summary: 'Send an email verification code',
				description:
					'Create a fresh verification code for the users email. In development and test the code is returned as devCode; production will deliver it by email.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({
										expiresInMinutes: z.number(),
										devCode: z.string().optional().meta({
											description: 'The code itself — only in development and test environments'
										})
									})
								)
							}
						},
						description: 'Verification code created'
					},
					400: ErrorResponses[400],
					429: ErrorResponses[429]
				}
			}),
			async (c) => {
				const user = await User.fromID(Actor.userID);
				if (!user?.email) {
					throw new VisibleError(
						'validation',
						ErrorCodes.Validation.INVALID_STATE,
						'Set an email address before requesting a verification code'
					);
				}

				const code = await Verification.create({
					userId: Actor.userID,
					kind: 'email'
				});

				const isProd = Env.get().NODE_ENV === 'production';
				return c.json({
					data: {
						expiresInMinutes: VERIFICATION_TTL_MINUTES,
						...(isProd ? {} : { devCode: code })
					}
				});
			}
		)
		.post(
			'/email/verify',
			describeRoute({
				tags: ['User'],
				summary: 'Verify your email address',
				description: 'Redeem a verification code to mark the email address as verified.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({ verified: z.boolean() })
								)
							}
						},
						description: 'Email verified'
					},
					400: ErrorResponses[400],
					429: ErrorResponses[429]
				}
			}),
			validator(
				'json',
				z.object({
					code: z.string().min(6).max(6).meta({
						description: 'The 6-digit code from the email',
						example: '123456'
					})
				})
			),
			async (c) => {
				const { code } = c.req.valid('json');
				const result = await Verification.verifyEmail({ userId: Actor.userID, code });

				if (result.reason === 'no_active_code') {
					throw new VisibleError(
						'validation',
						ErrorCodes.Validation.INVALID_STATE,
						'No active verification code — request a new one first'
					);
				}
				if (result.reason === 'wrong_code') {
					throw new VisibleError(
						'validation',
						ErrorCodes.Validation.INVALID_PARAMETER,
						'That verification code is not correct'
					);
				}
				return c.json({ data: { verified: true } });
			}
		)
		.get(
			'/devices',
			describeRoute({
				tags: ['User'],
				summary: 'List your devices',
				description: 'Every SSH key (fingerprint) enrolled to the authenticated user.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.array(Fingerprint.Info).meta({
										description: 'Enrolled devices',
										example: [Examples.Fingerprint]
									})
								)
							}
						},
						description: 'Devices'
					},
					429: ErrorResponses[429]
				}
			}),
			async (c) => {
				const rows = await Fingerprint.listByUser(Actor.userID);
				return c.json({ data: rows.map((row) => Fingerprint.serialize(row)) });
			}
		)
		.patch(
			'/devices/:id',
			describeRoute({
				tags: ['User'],
				summary: 'Rename a device',
				description: 'Give one of your SSH devices a human-readable name.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									Fingerprint.Info.meta({
										description: 'The renamed device',
										example: Examples.Fingerprint
									})
								)
							}
						},
						description: 'Device renamed'
					},
					400: ErrorResponses[400],
					404: ErrorResponses[404]
				}
			}),
			validator(
				'param',
				z.object({
					id: z.string().meta({
						description: 'ID of the device to rename',
						example: Examples.Fingerprint.id
					})
				})
			),
			validator(
				'json',
				z.object({
					name: z.string().min(1).max(64).nullable().meta({
						description: 'The new name (or null to clear it)',
						example: 'MacBook Air'
					})
				})
			),
			async (c) => {
				const { id } = c.req.valid('param');
				const { name } = c.req.valid('json');
				const userId = Actor.userID;

				const device = await Fingerprint.fromID(id);
				if (!device || device.userId !== userId) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						`Device ${id} not found`
					);
				}

				await Fingerprint.updateName({ id, name });
				const updated = await Fingerprint.fromID(id);
				return c.json({ data: updated ? Fingerprint.serialize(updated) : null });
			}
		)
		.get(
			'/:id',
			describeRoute({
				tags: ['User'],
				summary: 'Get user',
				description: 'Get a user by their ID',
				responses: userResponses
			}),
			validator(
				'param',
				z.object({
					id: z.string().meta({
						description: 'ID of the user to get',
						example: Examples.User.id
					})
				})
			),
			async (c) => {
				const userID = c.req.valid('param').id;

				const user = await User.fromID(userID);

				if (!user) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						`User ${userID} does not exist`
					);
				}

				return c.json({
					data: user
				});
			}
		);
}
