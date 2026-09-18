import { Actor } from '@nestri/core/actor';
import { Billing } from '@nestri/core/billing/index';
import { Polar } from '@nestri/core/billing/polar';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { Team } from '@nestri/core/team/index';
import { User } from '@nestri/core/user/index';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';

import { ErrorResponses, notPublic, Result, validator } from '../utils';

/**
 * Paying, and seeing what has been spent.
 *
 * The webhook at the bottom is **the only route in this app that no session
 * protects**, and that is not an oversight: it is called by somebody else's
 * server, which has no account here and never will. What stands in for a
 * session is a signature over the raw body, and it is checked before the body
 * is looked at.
 *
 * Everything else is ordinary and team-scoped. Note what is missing: there is
 * no route that sets a plan. A plan is what the provider says it is, so the
 * only thing that writes one is a delivery that proved it came from them —
 * anything else would be an endpoint for granting yourself a subscription.
 */
export namespace BillingApi {
	/** The team the caller is acting for, which is who the bill belongs to. */
	async function payingTeam(): Promise<string> {
		const actor = Actor.use();
		if (actor.type === 'member') {
			return actor.properties.teamID;
		}
		const team = await Team.personalFor(Actor.userID);
		if (!team) {
			throw new VisibleError(
				'not_found',
				ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
				'You have no team to bill'
			);
		}
		return team.id;
	}

	function mustBeConfigured() {
		if (!Polar.configured()) {
			throw new VisibleError(
				'internal',
				ErrorCodes.Server.DEPENDENCY_FAILURE,
				'Billing is not configured on this deployment'
			);
		}
	}

	export const route = new Hono()
		.post(
			'/webhook',
			describeRoute({
				tags: ['Billing'],
				summary: 'Receive a subscription event',
				description:
					'Called by the payment provider, not by you. Authenticated by a signature over the raw body rather than by a session, because the caller has no account here. Deliveries for a customer we did not create are acknowledged and ignored — a retry loop against a delivery nothing can act on helps nobody.',
				responses: {
					200: { description: 'Delivery accepted' },
					401: ErrorResponses[401]
				}
			}),
			async (c) => {
				mustBeConfigured();

				// The raw body, before any parsing. A body that has been through
				// `JSON.parse` and re-serialized is not the body that was signed,
				// and the signature is the whole of this route's authentication.
				const body = await c.req.text();
				const headers: Record<string, string> = {};
				c.req.raw.headers.forEach((value, key) => {
					headers[key] = value;
				});

				const delivery = Polar.receive({ body, headers });

				// Acknowledged rather than refused. A delivery we cannot act on is
				// still a delivery that arrived intact, and answering an error
				// would have them retry it for days against a thing that will
				// never become actionable.
				if (!delivery.teamId || !delivery.standing) {
					return c.json({ data: { applied: false, type: delivery.type } });
				}

				const updated = await Team.setPlan({
					id: delivery.teamId,
					plan: delivery.standing.plan,
					subscriptionStatus: delivery.standing.status
				});

				return c.json({
					data: { applied: Boolean(updated), type: delivery.type }
				});
			}
		)
		.get(
			'/',
			notPublic,
			describeRoute({
				tags: ['Billing'],
				summary: 'What you are on, and what you have spent',
				description:
					'The plan, and where each of the three windows stands. This is what a meter is drawn from — the percentages here are the same numbers that decide whether a run may start, so a full bar and a refusal cannot disagree.',
				responses: {
					200: {
						content: { 'application/json': { schema: Result(Billing.State) } },
						description: 'Your standing'
					},
					401: ErrorResponses[401],
					404: ErrorResponses[404]
				}
			}),
			async (c) => c.json({ data: await Billing.state({ teamId: await payingTeam() }) })
		)
		.post(
			'/checkout',
			notPublic,
			describeRoute({
				tags: ['Billing'],
				summary: 'Start paying',
				description:
					'Returns a URL to send the person to. The price they are shown is set on the provider’s side per currency and chosen from where they are, so nothing here names an amount — there is no figure in this API that could drift from the one they are charged.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									z.object({
										id: z.string().meta({ description: 'The checkout' }),
										url: z.url().meta({ description: 'Where to send the person' })
									})
								)
							}
						},
						description: 'A checkout to send them to'
					},
					401: ErrorResponses[401],
					404: ErrorResponses[404],
					500: ErrorResponses[500]
				}
			}),
			validator(
				'json',
				z
					.object({
						successUrl: z.url().optional().meta({
							description: 'Where to return to once they have paid'
						})
					})
					.strict()
			),
			async (c) => {
				mustBeConfigured();
				const teamId = await payingTeam();
				const user = await User.fromID(Actor.userID);
				return c.json({
					data: await Polar.checkout({
						teamId,
						email: user?.email ?? undefined,
						successUrl: c.req.valid('json').successUrl
					})
				});
			}
		)
		.get(
			'/portal',
			notPublic,
			describeRoute({
				tags: ['Billing'],
				summary: 'Manage what you are paying',
				description:
					'A URL to the provider’s own portal, where a card is changed, an invoice is read and a subscription is cancelled. None of that is rebuilt here, because rebuilding it would mean holding payment details in order to show them.',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(z.object({ url: z.url() }))
							}
						},
						description: 'Where to manage it'
					},
					401: ErrorResponses[401],
					404: ErrorResponses[404],
					500: ErrorResponses[500]
				}
			}),
			async (c) => {
				mustBeConfigured();
				return c.json({ data: await Polar.portal({ teamId: await payingTeam() }) });
			}
		);
}
