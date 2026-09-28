import { describe, expect, test } from 'bun:test';

import { presignGet } from '../app/utils/presign';

describe('presignGet', () => {
	// The example in AWS's SigV4 query-string documentation, which publishes the
	// signature it must produce. If this passes, every other signature is the
	// same arithmetic with different inputs.
	test('matches the published AWS example', async () => {
		const url = await presignGet(
			{
				endpoint: 'https://s3.amazonaws.com',
				bucket: 'examplebucket',
				region: 'us-east-1',
				accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
				secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
				virtualHost: true
			},
			'test.txt',
			86400,
			new Date('2013-05-24T00:00:00Z')
		);
		expect(url).toContain('https://examplebucket.s3.amazonaws.com/test.txt?');
		expect(url).toEndWith(
			'X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404'
		);
	});

	test('path style puts the bucket in the path', async () => {
		const url = await presignGet(
			{
				endpoint: 'https://objects.example.net',
				bucket: 'releases',
				region: 'europe-1',
				accessKeyId: 'k',
				secretAccessKey: 's'
			},
			'host/0.1.0/SHA256SUMS',
			60
		);
		expect(url).toStartWith('https://objects.example.net/releases/host/0.1.0/SHA256SUMS?');
		expect(url).toContain('X-Amz-Expires=60');
	});
});
