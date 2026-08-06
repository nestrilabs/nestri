import { Actor } from '@nestri/core/actor';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { User } from '@nestri/core/user/index';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, notPublic, Result, validator } from '../utils';

export namespace UserApi {
	export const route = new Hono()
		.use(notPublic)
		.get(
			'/',
			describeRoute({
				tags: ['User'],
				summary: 'Get current user',
				description: "Get the authenticated user's profile",
				responses: {
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
				}
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
		.get(
			'/:id',
			describeRoute({
				tags: ['User'],
				summary: 'Get user',
				description: 'Get a user by their ID',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									User.Info.meta({
										description: 'User details',
										example: Examples.User
									})
								)
							}
						},
						description: 'User details'
					},
					400: ErrorResponses[400],
					429: ErrorResponses[429]
				}
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
