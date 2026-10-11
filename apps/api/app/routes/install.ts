import { Env } from '@nestri/core/env';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';

// The installer, embedded at build time so the script and the API that redeems
// its token always ship as one version.
import script from '../../install/install.sh' with { type: 'text' };
import desktopScript from '../../install/desktop.sh' with { type: 'text' };
import { DESKTOP_VERSION } from '../../install/desktop-version';
import { presignGet } from '../utils/presign';

/**
 * The host installer and the binaries it downloads.
 *
 * The bucket behind these is never public. A download is answered with a
 * one-minute signed URL for exactly the object asked for, so every download
 * passes through here, where it can be logged, rate-limited or switched off.
 */
export namespace InstallApi {
	/** What may be downloaded: one component, versions and asset names by shape. */
	const COMPONENTS = new Set(['host', 'desktop']);
	const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;
	const ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

	const SIGNED_SECONDS = 60;

	/** The desktop app's asset for each platform a person can download it for. */
	const DESKTOP_ASSETS: Record<string, string> = {
		windows: 'Nestri.exe',
		linux: 'nestri-linux-x86_64'
	};

	function releases() {
		const env = Env.get();
		if (
			!env.RELEASES_BUCKET ||
			!env.RELEASES_ENDPOINT ||
			!env.RELEASES_ACCESS_KEY_ID ||
			!env.RELEASES_SECRET_ACCESS_KEY
		) {
			return null;
		}
		return {
			endpoint: env.RELEASES_ENDPOINT,
			bucket: env.RELEASES_BUCKET,
			region: env.RELEASES_REGION,
			accessKeyId: env.RELEASES_ACCESS_KEY_ID,
			secretAccessKey: env.RELEASES_SECRET_ACCESS_KEY
		};
	}

	export const route = new Hono()
		.get(
			'/install.sh',
			describeRoute({
				tags: ['Install'],
				summary: 'The host installer',
				description:
					'A POSIX shell script that installs the host agent for the calling user and registers the machine with a one-time install token. Pipe it to `sh -s -- <token>`.',
				responses: { 200: { description: 'The script' } }
			}),
			(c) =>
				c.body(script, 200, {
					'content-type': 'text/x-shellscript; charset=utf-8',
					'cache-control': 'no-cache'
				})
		)
		.get(
			'/install/:component/:version/:asset',
			describeRoute({
				tags: ['Install'],
				summary: 'Download an installable binary',
				description:
					'Redirects to a short-lived signed URL for one release asset. Used by the installer.',
				responses: {
					302: { description: 'Where to download it' },
					404: { description: 'No such asset' }
				}
			}),
			async (c) => {
				const { component, version, asset } = c.req.param();
				if (!COMPONENTS.has(component) || !VERSION.test(version) || !ASSET.test(asset)) {
					return c.notFound();
				}
				const bucket = releases();
				if (!bucket) {
					return c.json({ message: 'Downloads are not configured on this deployment.' }, 503);
				}
				const url = await presignGet(bucket, `${component}/${version}/${asset}`, SIGNED_SECONDS);
				return c.redirect(url, 302);
			}
		)
		.get(
			'/desktop.sh',
			describeRoute({
				tags: ['Install'],
				summary: 'The desktop app installer for Linux',
				description:
					'A POSIX shell script that installs the desktop app for the calling user, in ~/.local/bin with a launcher entry. Pipe it to `sh`.',
				responses: { 200: { description: 'The script' } }
			}),
			(c) =>
				c.body(desktopScript, 200, {
					'content-type': 'text/x-shellscript; charset=utf-8',
					'cache-control': 'no-cache'
				})
		)
		.get(
			'/download/:platform',
			describeRoute({
				tags: ['Install'],
				summary: 'Download the desktop app',
				description:
					'Redirects to a short-lived signed URL for the current desktop app on `windows` or `linux`. This link does not change between versions.',
				responses: {
					302: { description: 'Where to download it' },
					404: { description: 'Not available for that platform' }
				}
			}),
			async (c) => {
				const asset = DESKTOP_ASSETS[c.req.param('platform')];
				if (!asset) return c.notFound();
				const bucket = releases();
				if (!bucket) {
					return c.json({ message: 'Downloads are not configured on this deployment.' }, 503);
				}
				const url = await presignGet(bucket, `desktop/${DESKTOP_VERSION}/${asset}`, SIGNED_SECONDS);
				return c.redirect(url, 302);
			}
		);
}
