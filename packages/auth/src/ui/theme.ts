/**
 * The handful of values a deployment sets that the stylesheet cannot.
 *
 * Deliberately small. This used to be the *only* way to influence how a sign-in
 * page looked — a fixed struct of colours, a radius and a font family — which
 * meant any design it could not express had to be written around it, and this
 * one was, in `css.ts`. Customising the pages now means supplying a
 * {@link Renderer}; what is left here is the per-deployment trim.
 *
 * ```ts
 * import type { Theme } from "@nestri/auth/ui/theme"
 *
 * const THEME: Theme = {
 *   title: "Login | Example",
 *   primary: "hsl(12 84% 53%)",
 *   favicon: "https://example.com/favicon.ico"
 * }
 * ```
 *
 * @packageDocumentation
 */

/** A value that differs between light and dark mode. */
export interface ColorScheme {
	dark: string;
	light: string;
}

export interface Theme {
	/** The page title. */
	title?: string;
	/** A URL to the favicon. */
	favicon?: string;
	/**
	 * The brand colour.
	 *
	 * The one value the stylesheet reads back out of the theme, so that the
	 * accent has a single source rather than being stated twice.
	 */
	primary: string | ColorScheme;
	/** A URL to the logo, if the built-in wordmark is not wanted. */
	logo?: string | ColorScheme;
	/**
	 * Extra CSS, added in a `<style>` tag.
	 *
	 * This is for `@import`ing a font and little else. A design expressed here
	 * is a design fighting the stylesheet; write a {@link Renderer} instead.
	 */
	css?: string;
}
