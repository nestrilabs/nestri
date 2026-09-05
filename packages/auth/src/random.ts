import { timingSafeEqual } from 'node:crypto';

export function generateUnbiasedDigits(length: number): string {
	const result: number[] = [];
	while (result.length < length) {
		const buffer = crypto.getRandomValues(new Uint8Array(length * 2));
		for (const byte of buffer) {
			if (byte < 250 && result.length < length) {
				result.push(byte % 10);
			}
		}
	}
	return result.join('');
}

export function timingSafeCompare(a: string, b: string): boolean {
	if (typeof a !== 'string' || typeof b !== 'string') {
		return false;
	}
	if (a.length !== b.length) {
		return false;
	}
	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * A random string over an explicit alphabet, without modulo bias.
 *
 * Bytes that fall outside the largest whole multiple of the alphabet size are
 * thrown away rather than folded in, because folding them makes the first few
 * symbols more likely than the rest — which for a short code that gates an
 * account is a real narrowing of the search space and not a rounding error.
 */
export function generateUnbiasedString(alphabet: string, length: number): string {
	const limit = 256 - (256 % alphabet.length);
	let result = '';
	while (result.length < length) {
		const buffer = crypto.getRandomValues(new Uint8Array(length * 2));
		for (const byte of buffer) {
			if (byte < limit && result.length < length) {
				result += alphabet[byte % alphabet.length];
			}
		}
	}
	return result;
}
