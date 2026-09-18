import { Polar as PolarSdk } from '@polar-sh/sdk';
import { validateEvent, WebhookVerificationError } from '@polar-sh/sdk/webhooks';
import z from 'zod';

import { Env } from '../env.js';
import { ErrorCodes, VisibleError } from '../error.js';
import { fn } from '../fn.js';
import { memo } from '../utils/memo.js';

/**
 * The payment provider, and the only part of this codebase that talks to one.
 *
 * Everything money-shaped that is *not* here is deliberate. We store no price,
 * no currency and no card detail: a subscription's existence and its state are
 * the whole of what crosses back, because those are the only two facts the
 * product needs and anything more would be a second copy of a record somebody
 * else is authoritative for.
 *
 * **Currency is not our problem, by design.** A product carries a price per
 * currency on their side and the customer's location picks one at checkout. So
 * there is no currency in this file, none in the database, and no place where a
 * rate could be stale — the alternative is holding prices in three currencies
 * and discovering one of them is wrong from a customer.
 *
 * The team id goes over as the customer's `externalCustomerId`, which makes the
 * mapping theirs to keep. A Polar customer id in our schema would be a foreign
 * primary key we would then have to keep in step with a system we do not
 * control.
 */
export namespace Polar {
	/** Which Polar instance. Sandbox is a separate server with separate data. */
	export const Server = z.enum(['sandbox', 'production']);
	export type Server = z.infer<typeof Server>;

	function settings() {
		const env = Env.get();
		if (!env.POLAR_ACCESS_TOKEN) {
			throw new VisibleError(
				'internal',
				ErrorCodes.Server.DEPENDENCY_FAILURE,
				'Billing is not configured'
			);
		}
		return {
			accessToken: env.POLAR_ACCESS_TOKEN,
			server: Server.parse(env.POLAR_SERVER ?? 'sandbox'),
			productId: env.POLAR_PRODUCT_ID,
			webhookSecret: env.POLAR_WEBHOOK_SECRET
		};
	}

	/** Whether billing can run at all. Every route here checks it first. */
	export function configured(): boolean {
		const env = Env.get();
		return Boolean(env.POLAR_ACCESS_TOKEN && env.POLAR_PRODUCT_ID);
	}

	const client = memo(() => {
		const { accessToken, server } = settings();
		return new PolarSdk({ accessToken, server });
	});

	/** Reset the memo. Tests change the environment between cases. */
	export function reset(): void {
		client.reset();
	}

	/**
	 * A checkout for a team, as the customer they already are.
	 *
	 * The team id travels as `externalCustomerId`, so a second checkout for the
	 * same team reaches the same customer rather than making another one — which
	 * is what keeps one team from ending up with two subscriptions and two
	 * invoices for the same month.
	 */
	export const checkout = fn(
		z.object({
			teamId: z.string(),
			email: z.email().optional(),
			successUrl: z.url().optional()
		}),
		async (input) => {
			const { productId } = settings();
			if (!productId) {
				throw new VisibleError(
					'internal',
					ErrorCodes.Server.DEPENDENCY_FAILURE,
					'Billing is not configured'
				);
			}
			const created = await client().checkouts.create({
				products: [productId],
				externalCustomerId: input.teamId,
				customerEmail: input.email,
				successUrl: input.successUrl
			});
			return { id: created.id, url: created.url };
		}
	);

	/**
	 * A link to where somebody manages what they are already paying.
	 *
	 * Cancelling, changing a card and reading an invoice all live there rather
	 * than here. Rebuilding any of it would mean holding payment details to show
	 * them, which is the one thing this integration exists to avoid.
	 */
	export const portal = fn(z.object({ teamId: z.string() }), async (input) => {
		const session = await client().customerSessions.create({
			externalCustomerId: input.teamId
		});
		return { url: session.customerPortalUrl };
	});

	/** The plan and status a team is on, as far as the provider is concerned. */
	export const Standing = z.object({
		plan: z.enum(['free', 'paid']),
		status: z.string()
	});

	export type Standing = z.infer<typeof Standing>;

	/**
	 * What a subscription event means for what a team may do.
	 *
	 * The rule is that **access follows the provider's own state and nothing
	 * else**, and the interesting cases are the ones where that is not the same
	 * as "are they paying right now":
	 *
	 * - `canceled` keeps the plan. Somebody who cancels has paid to the end of
	 *   the period and turning them off the moment they click it would be taking
	 *   something they bought.
	 * - `past_due` also keeps it. A failed card is a card that may yet work, and
	 *   a retry cycle that ends in payment should not have cost them access in
	 *   the middle of it.
	 * - `revoked` is the one that takes it away. That is the provider saying the
	 *   period is over and unpaid, which is the only moment there is nothing
	 *   left that was paid for.
	 *
	 * An unknown type returns null rather than guessing. New event types get
	 * added by people who do not know what we do with them, and a default that
	 * changed somebody's plan would be a default that eventually cancels an
	 * account nobody cancelled.
	 */
	export function standingFor(eventType: string): Standing | null {
		switch (eventType) {
			case 'subscription.created':
			case 'subscription.active':
			case 'subscription.updated':
			case 'subscription.uncanceled':
				return { plan: 'paid', status: 'active' };
			case 'subscription.canceled':
				return { plan: 'paid', status: 'canceled' };
			case 'subscription.past_due':
				return { plan: 'paid', status: 'past_due' };
			case 'subscription.revoked':
				return { plan: 'free', status: 'revoked' };
			default:
				return null;
		}
	}

	export interface Delivery {
		type: string;
		/** The team this is about, from the customer's external id. */
		teamId: string | null;
		standing: Standing | null;
	}

	/**
	 * Check a webhook is really from them, and say what it means.
	 *
	 * The signature is checked over the **raw body**, before anything is parsed:
	 * this is the one route in the API that no session protects, so the
	 * signature is the whole of its authentication, and a body that has been
	 * through `JSON.parse` and back is not the body that was signed.
	 *
	 * A bad signature is an authentication failure and not a server fault — it
	 * is what an attacker gets, and it must read the same as a stale secret so
	 * that neither tells anybody which it was.
	 */
	export const receive = fn(
		z.object({ body: z.string(), headers: z.record(z.string(), z.string()) }),
		(input): Delivery => {
			const { webhookSecret } = settings();
			if (!webhookSecret) {
				throw new VisibleError(
					'internal',
					ErrorCodes.Server.DEPENDENCY_FAILURE,
					'Billing is not configured'
				);
			}

			let event;
			try {
				event = validateEvent(input.body, input.headers, webhookSecret);
			} catch (error) {
				if (error instanceof WebhookVerificationError) {
					throw new VisibleError(
						'authentication',
						ErrorCodes.Authentication.INVALID_TOKEN,
						'Signature does not match'
					);
				}
				throw error;
			}

			const data = (event as { data?: Record<string, unknown> }).data ?? {};
			const customer = data.customer as { externalId?: string | null } | undefined;
			// `externalId` is the team id we sent at checkout. A delivery without
			// one is about a customer created some other way — by hand in their
			// dashboard, most likely — and there is nothing here it can change.
			const teamId = customer?.externalId ?? null;

			return { type: event.type, teamId, standing: standingFor(event.type) };
		}
	);
}
