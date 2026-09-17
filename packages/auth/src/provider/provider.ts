import type { Context, Hono } from 'hono';

import { StorageAdapter } from '../storage/storage.js';
import type { Mark, Screen } from '../ui/screen.js';

export type ProviderRoute = Hono;

/**
 * How a provider is offered to a person choosing one.
 *
 * Declared by the provider rather than looked up by whatever draws the
 * chooser. That used to be two hardcoded records inside the rendering code, so
 * a provider the library had not been told about rendered as its own lowercase
 * identifier with no mark beside it — and there was no way to fix it from
 * outside the library.
 */
export interface ProviderDisplay {
	/** The name as a person reads it: `GitHub`, not `github`. */
	name: string;
	/** Raw SVG for the brand mark, from `ui/mark.ts`. */
	icon?: Mark;
}

export interface Provider<Properties = any> {
	type: string;
	/**
	 * What to call this provider, and what to draw beside it.
	 *
	 * Optional because a provider nobody picks from a list — one reached
	 * directly, or one with no browser in the flow at all — has nothing to
	 * display. Falling back to `type` is correct there and only there.
	 */
	display?: ProviderDisplay;
	init: (route: ProviderRoute, options: ProviderOptions<Properties>) => void;
	client?: (input: {
		clientID: string;
		clientSecret: string;
		params: Record<string, string>;
	}) => Promise<Properties>;
}

export interface ProviderOptions<Properties> {
	name: string;
	success: (
		ctx: Context,
		properties: Properties,
		opts?: {
			invalidate?: (subject: string) => Promise<void>;
		}
	) => Promise<Response>;
	forward: (ctx: Context, response: Response) => Response;
	/**
	 * Draw a screen and return it as this request's response.
	 *
	 * The only way a provider produces a page. It cannot reach the renderer
	 * itself, which is the point: a provider says what it needs to ask and
	 * never how it looks, so there is exactly one place that has to agree with
	 * the stylesheet.
	 */
	screen: (ctx: Context, screen: Screen) => Response;
	set: <T>(ctx: Context, key: string, maxAge: number, value: T) => Promise<void>;
	get: <T>(ctx: Context, key: string) => Promise<T>;
	unset: (ctx: Context, key: string) => Promise<void>;
	invalidate: (subject: string) => Promise<void>;
	storage: StorageAdapter;
}
export class ProviderError extends Error {}
export class ProviderUnknownError extends ProviderError {}
