/**
 * A presigned S3 GET, by hand: AWS Signature Version 4 in query-string form.
 *
 * Written against Web Crypto rather than an SDK so it runs the same under
 * every runtime this API is deployed on, and because a GET presign is the whole
 * of what is needed — a dependency the size of an S3 client for one signature
 * is a dependency the size of an S3 client.
 *
 * Path-style URLs (`<endpoint>/<bucket>/<key>`), which every S3-compatible
 * store accepts and which need no DNS per bucket.
 */

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
	return Array.from(new Uint8Array(buf))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function sha256(s: string): Promise<string> {
	return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

async function hmac(key: ArrayBuffer | Uint8Array, s: string): Promise<ArrayBuffer> {
	const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign'
	]);
	return crypto.subtle.sign('HMAC', k, enc.encode(s));
}

/** RFC 3986 encoding, which is what SigV4 means by "URI-encode". */
function rfc3986(s: string): string {
	return encodeURIComponent(s).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);
}

export type Bucket = {
	endpoint: string;
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** `<bucket>.<endpoint>/<key>` instead of `<endpoint>/<bucket>/<key>`. */
	virtualHost?: boolean;
};

export async function presignGet(
	b: Bucket,
	key: string,
	expiresSeconds: number,
	now: Date = new Date()
): Promise<string> {
	const endpoint = new URL(b.endpoint);
	const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
	const day = amzDate.slice(0, 8);
	const scope = `${day}/${b.region}/s3/aws4_request`;
	const host = b.virtualHost ? `${b.bucket}.${endpoint.host}` : endpoint.host;
	const encodedKey = key.split('/').map(rfc3986).join('/');
	const path = b.virtualHost ? `/${encodedKey}` : `/${rfc3986(b.bucket)}/${encodedKey}`;

	const query: [string, string][] = [
		['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
		['X-Amz-Credential', `${b.accessKeyId}/${scope}`],
		['X-Amz-Date', amzDate],
		['X-Amz-Expires', String(expiresSeconds)],
		['X-Amz-SignedHeaders', 'host']
	];
	const canonicalQuery = query
		.map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([k, v]) => `${k}=${v}`)
		.join('&');

	const canonicalRequest = [
		'GET',
		path,
		canonicalQuery,
		`host:${host}\n`,
		'host',
		'UNSIGNED-PAYLOAD'
	].join('\n');
	const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonicalRequest)].join('\n');

	let k = await hmac(enc.encode(`AWS4${b.secretAccessKey}`), day);
	k = await hmac(k, b.region);
	k = await hmac(k, 's3');
	k = await hmac(k, 'aws4_request');
	const signature = hex(await hmac(k, toSign));

	return `${endpoint.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
