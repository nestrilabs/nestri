import type { Context } from 'hono';

export type Prettify<T> = {
	[K in keyof T]: T[K];
};

export function getRelativeUrl(ctx: Context, path: string) {
	const result = new URL(path, ctx.req.url);
	result.host = ctx.req.header('x-forwarded-host') || result.host;
	result.protocol = ctx.req.header('x-forwarded-proto') || result.protocol;
	result.port = ctx.req.header('x-forwarded-port') || result.port;
	return result.toString();
}

const twoPartTlds = [
	'co.uk',
	'co.jp',
	'co.kr',
	'co.nz',
	'co.za',
	'co.in',
	'com.au',
	'com.br',
	'com.cn',
	'com.mx',
	'com.tw',
	'net.au',
	'org.uk',
	'ne.jp',
	'ac.uk',
	'gov.uk',
	'edu.au',
	'gov.au'
];

export function isDomainMatch(a: string, b: string): boolean {
	if (a === b) return true;
	const partsA = a.split('.');
	const partsB = b.split('.');
	const hasTwoPartTld = twoPartTlds.some((tld) => a.endsWith('.' + tld) || b.endsWith('.' + tld));
	const numParts = hasTwoPartTld ? -3 : -2;
	const min = Math.min(partsA.length, partsB.length, numParts);
	const tailA = partsA.slice(min).join('.');
	const tailB = partsB.slice(min).join('.');
	return tailA === tailB;
}

export function lazy<T>(fn: () => T): () => T {
	let value: T | undefined;
	return () => {
		if (value === undefined) {
			value = fn();
		}
		return value;
	};
}

/**
 * The SHA-256 of a string, hex encoded.
 *
 * Used wherever a bearer credential has to be recognised later without being
 * kept in a form that could be presented. Whoever can read the store learns
 * that a token existed and not what it was.
 */
export async function sha256hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
