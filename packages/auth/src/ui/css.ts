/**
 * The sign-in screen's stylesheet.
 *
 * The design language is the product's own: a neutral grey ramp on black, one
 * brand accent, Mona Sans for display and Geist for everything read or typed,
 * and a page framed by dashed rules. It is expressed as utility classes
 * wherever it is built with a CSS framework; this page is a string rendered in
 * a Worker with no build step, so the same values are written out longhand
 * here. They are stated as literals on purpose — a token that is computed in
 * one place and copied in another drifts without anyone seeing it.
 *
 * **Dark only, deliberately.** The upstream stylesheet derived every colour
 * from the background's lightness through `oklch(from ...)` so one theme could
 * serve both schemes. That is what made the sign-in field black-on-black, and
 * the product has one scheme anyway. Colours here are stated, not derived.
 */
export default `
:root {
	color-scheme: dark;

	--color-gray-100: hsl(0 0% 10%);
	--color-gray-200: hsl(0 0% 12%);
	--color-gray-300: hsl(0 0% 16%);
	--color-gray-400: hsl(0 0% 18%);
	--color-gray-500: hsl(0 0% 27%);
	--color-gray-600: hsl(0 0% 53%);
	--color-gray-800: hsl(0 0% 49%);
	--color-gray-900: hsl(0 0% 63%);
	--color-gray-1000: hsl(0 0% 93%);

	--color-background-100: hsl(0 0% 4%);
	--color-background-200: hsl(0 0% 0%);

	/* Overridden per-request from the theme's \`primary\`, so the brand colour
	   has one source and this is only the fallback. */
	--color-brand: hsl(12 84% 53%);
	--color-border: var(--color-gray-200);
	--color-foreground: var(--color-gray-1000);
	--color-muted-foreground: var(--color-gray-900);
	--color-muted-foreground2: var(--color-gray-800);

	--color-red-600: hsl(358 75% 59%);
	--color-red-100: hsl(357 37% 12%);
	--color-green-600: hsl(151 55% 42%);
	--color-green-100: hsl(154 49% 9%);

	--font-sans: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
	--font-mona: 'Mona Sans Variable', var(--font-sans);

	--text-xxs: 11px;
	--text-xxs--line-height: 14px;

	/* 1440px. The band borders only close into a box once the page is at least
	   this wide; below it the dashed rules run to the viewport edge. */
	--width-max: 90rem;
}

*,
*::before,
*::after {
	box-sizing: border-box;
}

html {
	height: 100%;
}

body {
	margin: 0;
	min-height: 100%;
	background: var(--color-background-200);
	color: var(--color-foreground);
	font-family: var(--font-sans);
	font-size: 14px;
	line-height: 20px;
	-webkit-font-smoothing: antialiased;
	-moz-osx-font-smoothing: grayscale;
}

[data-component='page'] {
	display: flex;
	min-height: 100vh;
	width: 100%;
}

[data-component='frame'] {
	display: flex;
	min-height: 100vh;
	flex: 1 1 0%;
	flex-direction: column;
	width: 100%;
}

/* The two dashed rules across the top and bottom of the page. Their inner
   element is what carries the vertical edges, so the dashes meet in a corner
   rather than crossing. */
[data-component='band'] {
	display: flex;
	width: 100%;
	min-height: 5rem;
	border-color: var(--color-border);
	border-style: dashed;
	border-width: 0;
}

[data-component='band'][data-edge='top'] {
	border-bottom-width: 1px;
}

[data-component='band'][data-edge='bottom'] {
	border-top-width: 1px;
}

[data-component='band'] > div,
[data-component='main'] {
	width: 100%;
	max-width: var(--width-max);
	margin-inline: auto;
	flex: 1 1 0%;
	border-color: var(--color-border);
	border-style: dashed;
	border-width: 0;
}

[data-component='main'] {
	display: flex;
	height: 100%;
}

@media (min-width: 1440px) {
	[data-component='band'] > div,
	[data-component='main'] {
		border-left-width: 1px;
		border-right-width: 1px;
	}
}

/* The 48-column field the lockup is centred in. The two dashed verticals sit
   on the column-5 and column-44 gridlines and the content spans 6 to -6, so
   there is a full column of air between a rule and any text. */
[data-component='field'] {
	position: relative;
	display: grid;
	flex: 1 1 0%;
	width: 100%;
	align-items: center;
	grid-template-columns: repeat(48, minmax(0, 1fr));
	grid-template-rows: 1fr;
}

[data-component='rule'] {
	position: absolute;
	top: 0;
	bottom: 0;
	left: 0;
	grid-column: 5;
	transform: translateX(-50%);
	color: var(--color-border);
}

[data-component='rule'][data-side='end'] {
	grid-column: -5;
}

[data-component='center'] {
	position: relative;
	grid-column: 6 / -6;
	margin: auto;
	display: flex;
	width: 100%;
	max-width: 34.5rem;
	flex-direction: column;
	/* The rules run edge to edge behind this column; nothing here should eat a
	   click meant for the page. Interactive descendants opt back in. */
	pointer-events: none;
	user-select: none;
}

[data-component='stack'] {
	display: flex;
	width: 100%;
	flex-direction: column;
	align-items: center;
	padding: 1.75rem;
}

[data-component='logo'] {
	margin-bottom: 1.25rem;
	display: flex;
	height: 2.5rem;
	color: var(--color-brand);
}

[data-component='logo'] svg {
	height: 100%;
	width: auto;
}

[data-component='title'] {
	margin: 0;
	text-align: center;
	text-wrap: balance;
	letter-spacing: -0.05em;
	/* Balanced on narrow screens only, where an unbalanced last line leaves a
	   single orphaned word; the wide case is reset in the media query at the
	   foot of this file. */
	font-family: var(--font-mona);
	font-size: 1.875rem;
	line-height: 2.25rem;
	font-weight: 700;
	color: var(--color-muted-foreground);
	pointer-events: auto;
}

[data-component='title'] strong {
	font-weight: inherit;
	color: var(--color-foreground);
}

[data-component='title'] a {
	color: inherit;
	text-decoration: none;
}

[data-component='actions'] {
	pointer-events: auto;
	margin-top: 1.5rem;
	display: flex;
	width: 100%;
	flex-direction: column;
}

[data-component='form'] {
	display: flex;
	width: 100%;
	flex-direction: column;
	gap: 0.75rem;
	margin: 0;
}

[data-component='input'] {
	width: 100%;
	appearance: none;
	border-radius: 0.75rem;
	border: 1px solid var(--color-gray-300);
	background: var(--color-background-100);
	padding: 1.125rem 1.25rem;
	font-family: var(--font-sans);
	font-size: 1rem;
	line-height: 1.5rem;
	/* Stated rather than inherited: a form control does not take its parent's
	   colour, and leaving it to the UA put black glyphs on this field. */
	color: var(--color-foreground);
	caret-color: var(--color-brand);
	outline: none;
	transition:
		border-color 150ms,
		box-shadow 150ms;
}

[data-component='input']::placeholder {
	color: var(--color-muted-foreground2);
}

[data-component='input']:hover {
	border-color: var(--color-gray-400);
}

[data-component='input']:focus {
	border-color: var(--color-brand);
	box-shadow: 0 0 0 1px var(--color-brand);
}

/* Chrome paints its own background over an autofilled field and ignores
   \`background\`; an inset shadow is the only thing it honours. */
[data-component='input']:-webkit-autofill,
[data-component='input']:-webkit-autofill:hover,
[data-component='input']:-webkit-autofill:focus {
	-webkit-text-fill-color: var(--color-foreground);
	-webkit-box-shadow: 0 0 0 100px var(--color-background-100) inset;
	caret-color: var(--color-brand);
}

[data-component='button'] {
	position: relative;
	display: flex;
	width: 100%;
	cursor: pointer;
	appearance: none;
	align-items: center;
	justify-content: center;
	border: 0;
	border-radius: 0.75rem;
	background: var(--color-gray-1000);
	padding: 1.125rem 2.5rem;
	color: var(--color-gray-100);
	font-family: var(--font-mona);
	font-size: 1rem;
	line-height: 1.5rem;
	font-weight: 700;
	text-transform: uppercase;
	outline: none;
	transition: all 150ms;
}

[data-component='button']:hover {
	background: var(--color-gray-900);
	scale: 1.01;
}

[data-component='button']:focus-visible {
	box-shadow:
		0 0 0 2px var(--color-background-200),
		0 0 0 4px var(--color-brand);
}

[data-component='button']:disabled {
	cursor: not-allowed;
	background: var(--color-background-100);
	border: 1px solid var(--color-border);
	color: var(--color-muted-foreground2);
	scale: 1;
}

[data-component='form-footer'] {
	margin-top: 0.75rem;
	width: 100%;
	text-align: center;
	font-size: var(--text-xxs);
	line-height: var(--text-xxs--line-height);
	color: var(--color-muted-foreground2);
	pointer-events: auto;
}

[data-component='form-footer'] a {
	color: inherit;
	text-decoration: none;
	transition: color 150ms;
}

/* The resend control, which is a button behaving as a link and does need to
   look like one. */
[data-component='link'] {
	color: inherit;
	background: none;
	border: 0;
	padding: 0;
	font: inherit;
	cursor: pointer;
	text-decoration: underline;
	text-underline-offset: 0.125rem;
	transition: color 150ms;
}

[data-component='form-footer'] a:hover,
[data-component='link']:hover {
	color: var(--color-foreground);
}

[data-component='form-alert'] {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	border-radius: 0.75rem;
	border: 1px solid var(--color-red-600);
	background: var(--color-red-100);
	padding: 0.75rem 1rem;
	font-size: 0.8125rem;
	line-height: 1.25rem;
	color: var(--color-foreground);
	text-align: left;
}

[data-component='form-alert'][data-color='success'] {
	border-color: var(--color-green-600);
	background: var(--color-green-100);
}

[data-component='form-alert'] svg {
	height: 1.25rem;
	width: 1.25rem;
	flex-shrink: 0;
}

[data-component='form-alert'] [data-slot='icon-success'] {
	display: none;
	color: var(--color-green-600);
}

[data-component='form-alert'] [data-slot='icon-danger'] {
	display: block;
	color: var(--color-red-600);
}

[data-component='form-alert'][data-color='success'] [data-slot='icon-success'] {
	display: block;
}

[data-component='form-alert'][data-color='success'] [data-slot='icon-danger'] {
	display: none;
}

@media (min-width: 40rem) {
	[data-component='stack'] {
		padding: 2.5rem;
	}

	[data-component='logo'] {
		height: 3.5rem;
	}

	[data-component='title'] {
		font-size: 40px;
		line-height: 2.5rem;
		text-wrap: wrap;
	}

	[data-component='form-footer'] {
		line-height: 1.625;
	}
}

@media (prefers-reduced-motion: reduce) {
	[data-component='button'],
	[data-component='input'] {
		transition: none;
	}

	[data-component='button']:hover {
		scale: 1;
	}
}
`;
