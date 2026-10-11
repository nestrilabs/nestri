import { describe, expect, test } from 'bun:test';

import { app } from '../app/index';

describe('the desktop app download', () => {
	test('the Linux installer is served as a script', async () => {
		const res = await app.request('/desktop.sh');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('shellscript');
		expect(await res.text()).toContain('/download/linux');
	});

	test('a platform that is not offered is not found', async () => {
		expect((await app.request('/download/macos')).status).toBe(404);
	});

	test('a desktop asset is a known component', async () => {
		// No bucket in tests: the route got past its allow-list to the config check.
		const res = await app.request('/install/desktop/0.1.0/Nestri.exe');
		expect([302, 503]).toContain(res.status);
	});
});
