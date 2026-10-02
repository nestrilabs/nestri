import type { Theme } from '@nestri/auth/ui/theme';

/**
 * The sign-in screen's theme.
 *
 * Almost everything that used to live here is now stated in
 * `packages/auth/src/ui/css.ts`, which states the product's design language
 * longhand. What is left here is the handful of values the
 * issuer itself needs — and `primary`, which is the one colour the stylesheet
 * reads back from the theme so the brand has a single source.
 *
 * There is no `background` and no light variant on purpose: the page is dark
 * only, and the derived-colour scheme that made two schemes possible is
 * exactly what rendered the sign-in field's text the colour of its own
 * background.
 */
export const THEME_NESTRI: Theme = {
	title: 'Login | Nestri',
	primary: 'hsl(12 84% 53%)',
	favicon: 'https://nestri.io/images/favicon.ico',
	// Mona Sans for the display line and the action, Geist for everything a
	// person reads or types. Served from the Fontsource CDN because the
	// self-hosted font packages need a bundler and nothing preprocesses this
	// page — it is assembled as a string at request time. The family names must
	// match the ones the stylesheet asks for.
	css: `@import url('https://cdn.jsdelivr.net/fontsource/css/mona-sans:vf@latest/wght.css');@import url('https://cdn.jsdelivr.net/fontsource/css/geist:vf@latest/wght.css');`
};
