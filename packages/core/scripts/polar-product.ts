/**
 * Create the paid product, against whichever environment you point it at.
 *
 * Sandbox and production are separate servers with separate data, so nothing
 * made in one can be moved to the other — a product designed in sandbox has to
 * be *recreated* in production, and two things typed twice are two things that
 * drift. So the product is written down once here, and promoting it is running
 * this again with the other token.
 *
 *   POLAR_ACCESS_TOKEN=$(cat ~/.polar_sandbox_token) \
 *   POLAR_SERVER=sandbox \
 *   bun run packages/core/scripts/polar-product.ts
 *
 * Add `--apply` to actually create it. Without it nothing is written and the
 * script prints what it would do, because this talks to a live payment account
 * and a product created by accident is visible to customers.
 *
 * It refuses to make a second product with the same name rather than quietly
 * making a duplicate — two products called the same thing is how a checkout
 * ends up pointing at the wrong one.
 */
import { Polar } from '@polar-sh/sdk';
import type { PresentmentCurrency } from '@polar-sh/sdk/models/components/presentmentcurrency.js';

type Price = { currency: PresentmentCurrency; amount: number };

/**
 * The paid rung of the self-serve ladder.
 *
 * One recurring monthly product, priced per currency. The customer's location
 * picks which price they see, so these are *presentment* prices rather than a
 * conversion of one another — that is the point of listing three rather than
 * charging one and letting a card issuer decide.
 *
 * Amounts are in minor units: 2000 is 20.00.
 */
const PRODUCTS = [
	{
		env: 'POLAR_FREE_PRODUCT_ID',
		name: 'Nestri Free',
		description: 'Sessions on hardware you own, and a monthly burn allowance.',
		// Recurring, and priced at nothing. It has to be a *subscription* rather
		// than a one-time purchase, because a team is put on it outright at
		// signup and a one-time product has no subscription to create.
		recurringInterval: 'month' as const,
		prices: [{ currency: 'usd', amount: 0 }] satisfies Price[]
	},
	{
		env: 'POLAR_PRODUCT_ID',
		name: 'Nestri Pro',
		description: 'Cloud sessions on Nestri hardware, and a larger burn allowance.',
		recurringInterval: 'month' as const,
		prices: [
			{ currency: 'usd', amount: 2000 },
			{ currency: 'eur', amount: 2000 },
			{ currency: 'gbp', amount: 2000 }
		] satisfies Price[]
	}
];

const apply = process.argv.includes('--apply');
const accessToken = process.env.POLAR_ACCESS_TOKEN;
const server = (process.env.POLAR_SERVER ?? 'sandbox') as 'sandbox' | 'production';

if (!accessToken) {
	console.error('POLAR_ACCESS_TOKEN is not set');
	process.exit(1);
}

const polar = new Polar({ accessToken, server });

/**
 * An organization token already names its organization.
 *
 * Sending `organizationId` alongside one is refused outright rather than
 * ignored, so which kind of token this is has to be known before the call. A
 * personal token can see several organizations and must say which.
 */
const scopedToOrganization = accessToken.startsWith('polar_oat_');

const organizations = await polar.organizations.listOrganizations({ limit: 2 });
const organization = organizations.result.items.at(0);
if (!organization) {
	console.error('that token can see no organization');
	process.exit(1);
}
if (organizations.result.items.length > 1) {
	// Which one to use would be a guess, and the wrong guess bills the wrong
	// company.
	console.error('that token can see more than one organization; refusing to choose');
	process.exit(1);
}

console.log(`server:       ${server}`);
console.log(`organization: ${organization.name} (${organization.id})`);

const existing = await polar.products.list({ organizationId: organization.id, limit: 100 });

for (const product of PRODUCTS) {
	const clash = existing.result.items.find((p) => p.name === product.name && !p.isArchived);
	if (clash) {
		// Same name is not the same product. A one-time product where a
		// subscription is wanted cannot be subscribed to at all, and reporting
		// it as already-there would hand back an id that fails at the first use.
		if (clash.recurringInterval !== product.recurringInterval) {
			console.log(`\nwrong shape: ${product.name} (${clash.id})`);
			console.log(
				`  wanted every ${product.recurringInterval}, found ${clash.recurringInterval ?? 'one-time'}`
			);
			console.log('  archive it first, then run this again.');
			continue;
		}
		console.log(`\nalready there: ${product.name}`);
		console.log(`  ${product.env}=${clash.id}`);
		continue;
	}

	console.log(`\nwould create: ${product.name}, every ${product.recurringInterval}`);
	for (const price of product.prices) {
		console.log(`  ${price.currency.toUpperCase()} ${(price.amount / 100).toFixed(2)}`);
	}

	if (!apply) {
		continue;
	}

	const created = await polar.products.create({
		...(scopedToOrganization ? {} : { organizationId: organization.id }),
		name: product.name,
		description: product.description,
		recurringInterval: product.recurringInterval,
		prices: product.prices.map((price) => ({
			amountType: 'fixed' as const,
			priceCurrency: price.currency,
			priceAmount: price.amount
		}))
	});
	console.log(`  created: ${product.env}=${created.id}`);
}

if (!apply) {
	console.log('\nnothing written. Re-run with --apply to create them.');
}
