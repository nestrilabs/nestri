import { Actor } from '@nestri/core/actor';
import { Env } from '@nestri/core/env';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Examples } from '@nestri/core/examples';
import { Steam } from '@nestri/core/steam/index';
import { SteamLinkRequest } from '@nestri/core/steam/link-request';
import { LinkedAccount } from '@nestri/core/user/linked-account';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, notPublic, Result, validator } from '../utils';

export namespace SteamApi {
	/**
	 * Where Steam sends the browser back to, for one link request.
	 *
	 * This API's own public address: `API_URL` when set, otherwise the host the
	 * request arrived on — over https, because a proxy in front of the API
	 * forwards plain http and Steam must be sent somewhere a browser can reach.
	 */
	function callbackUrl(requestUrl: string, nonce: string): string {
		const here = new URL(requestUrl);
		const local = here.hostname === 'localhost' || here.hostname === '127.0.0.1';
		const base = Env.get().API_URL ?? `${local ? here.protocol : 'https:'}//${here.host}`;
		return `${base.replace(/\/$/, '')}/steam/link/callback?state=${encodeURIComponent(nonce)}`;
	}

	function page(title: string, body: string, status: 200 | 400) {
		return new Response(
			`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:90vh;margin:0"><p>${body}</p>`,
			{ status, headers: { 'content-type': 'text/html; charset=utf-8' } }
		);
	}

	/**
	 * Steam's way back. Public, because a browser returning from Steam carries
	 * no bearer token: the one-time request is what says who this is for.
	 */
	export const publicRoute = new Hono().get('/link/callback', async (c) => {
		const params = Object.fromEntries(new URL(c.req.url).searchParams.entries());
		const nonce = params.state ?? '';
		const steamId = await SteamLinkRequest.verify(params, callbackUrl(c.req.url, nonce));
		if (!steamId) {
			return page(
				'Not linked',
				'Steam did not confirm that sign-in. Start again from Nestri.',
				400
			);
		}
		const userId = await SteamLinkRequest.consume(nonce);
		if (!userId) {
			return page(
				'Not linked',
				'That link has expired or was already used. Start again from Nestri.',
				400
			);
		}
		await Steam.link({ steamId, userId });
		return page('Steam linked', 'Your Steam account is linked. You can close this tab.', 200);
	});

	export const route = new Hono()
		.use(notPublic)
		.get(
			'/linked',
			describeRoute({
				tags: ['Steam'],
				summary: 'Get your linked Steam account',
				description: 'The Steam account linked to the authenticated user, or null if none.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.union([LinkedAccount.Info, z.null()]).meta({
										description: 'The linked Steam account, or null',
										example: Examples.LinkedAccount
									})
								)
							}
						},
						description: 'Linked Steam account'
					},
					401: ErrorResponses[401],
					429: ErrorResponses[429]
				}
			}),
			async (c) => {
				const linked = await LinkedAccount.findSteamByUser(Actor.userID);
				return c.json({ data: linked ? LinkedAccount.serialize(linked) : null });
			}
		)
		.post(
			'/unlink',
			describeRoute({
				tags: ['Steam'],
				summary: 'Unlink your Steam account',
				description: 'Detach the Steam account from the authenticated user.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(z.object({ unlinked: z.boolean() }))
							}
						},
						description: 'Steam account unlinked'
					},
					401: ErrorResponses[401],
					404: ErrorResponses[404],
					429: ErrorResponses[429]
				}
			}),
			async (c) => {
				const linked = await LinkedAccount.findSteamByUser(Actor.userID);
				if (!linked) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						'No Steam account is linked to this user'
					);
				}
				await LinkedAccount.remove(linked.id);
				return c.json({ data: { unlinked: true } });
			}
		)
		.post(
			'/link/start',
			describeRoute({
				tags: ['Steam'],
				summary: 'Start linking a Steam account',
				description:
					'Returns a Steam sign-in URL. Open it in a browser: signing in to Steam there is what proves the account is yours, and the account is linked when Steam sends the browser back. The URL is good for ten minutes and one sign-in. A Steam id on its own is public, so no route links one on trust.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({
										url: z.string().meta({ description: 'Open this to sign in to Steam' })
									})
								)
							}
						},
						description: 'Where to sign in'
					},
					401: ErrorResponses[401]
				}
			}),
			async (c) => {
				const nonce = await SteamLinkRequest.create(Actor.userID);
				return c.json({ data: { url: SteamLinkRequest.signInUrl(callbackUrl(c.req.url, nonce)) } });
			}
		);
}
