import { Examples } from '@nestri/core/examples';
import { Waitlist } from '@nestri/core/waitlist/index';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { adminOnly, ErrorResponses, Result, validator } from '../utils';

/**
 * Public signups for not-yet-launched features (the machines waitlist).
 *
 * Deliberately unauthenticated: a visitor without an account should be able
 * to leave an email. The list itself is admin-only so a scraper cannot mine
 * every address out of the response.
 */
export namespace WaitlistApi {
	export const route = new Hono()
		.post(
			'/',
			describeRoute({
				tags: ['Waitlist'],
				summary: 'Join the waitlist',
				description: 'Leave an email to be notified when a feature launches. Public.',
				responses: {
					201: {
						content: {
							'application/json': {
								schema: Result(
									Waitlist.Info.meta({
										description: 'The waitlist entry (the existing one if already joined)',
										example: Examples.WaitlistEntry
									})
								)
							}
						},
						description: 'Joined the waitlist'
					},
					400: ErrorResponses[400]
				}
			}),
			validator(
				'json',
				z.object({
					email: z.email().meta({
						description: 'The email to notify',
						example: Examples.WaitlistEntry.email
					}),
					source: z.string().default('machines').meta({
						description: 'What the signup is for',
						example: Examples.WaitlistEntry.source
					})
				})
			),
			async (c) => {
				const { email, source } = c.req.valid('json');
				const entry = await Waitlist.join({ email, source });
				return c.json({ data: entry }, 201);
			}
		)
		.get(
			'/',
			adminOnly,
			describeRoute({
				tags: ['Waitlist'],
				summary: 'List waitlist entries',
				description: 'Every email currently on the waitlist. Admin only.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.array(Waitlist.Info).meta({
										description: 'All waitlist entries',
										example: [Examples.WaitlistEntry]
									})
								)
							}
						},
						description: 'Waitlist entries'
					},
					403: ErrorResponses[403]
				}
			}),
			async (c) => c.json({ data: await Waitlist.list() })
		);
}
