/**
 * The one place that turns a {@link Screen} into markup.
 *
 * Everything that knows what a button looks like is in this file. A provider
 * describes what it needs, this decides how it is drawn, and the two are
 * swappable independently — which is the property the previous arrangement did
 * not have, because each provider returned a finished `Response` and therefore
 * had an opinion about markup.
 *
 * The components below are deliberately not exported. A `data-component`
 * attribute is a contract with the stylesheet and nothing else should be
 * writing one: it is a string, so a typo in it is silent, and the whole reason
 * to have typed components is that nobody adding a screen ever types one again.
 *
 * @packageDocumentation
 */
/** @jsxImportSource hono/jsx */

import { Layout } from './base.js';
import segments from './segments.js';
import type {
	Alert,
	ChooseScreen,
	ConfirmScreen,
	Copy,
	Field,
	FormScreen,
	Mark,
	MessageScreen,
	Screen
} from './screen.js';
import type { Theme } from './theme.js';

/**
 * Draws a screen.
 *
 * One method, on purpose. It is the entire boundary between what the auth flow
 * needs to ask and how it is presented, so replacing the presentation wholesale
 * means implementing this and nothing else.
 */
export interface Renderer {
	render(screen: Screen, req: Request): Response;
}

export interface HtmlRendererOptions {
	/**
	 * Page title, favicon, brand colour and any extra stylesheet.
	 *
	 * Held in the closure rather than in a module global, so two renderers with
	 * two themes can exist at once and a component can be rendered in a test
	 * without arranging global state first.
	 */
	theme?: Theme;
}

/**
 * The default renderer: server-rendered HTML that works with script off. The
 * one script, `segments.ts`, only redraws a code field as boxes.
 */
export function HtmlRenderer(options?: HtmlRendererOptions): Renderer {
	const theme = options?.theme;

	return {
		render(screen, _req) {
			const body = (() => {
				switch (screen.kind) {
					case 'choose':
						return <Choose theme={theme} screen={screen} />;
					case 'form':
						return <Form theme={theme} screen={screen} />;
					case 'confirm':
						return <Confirm theme={theme} screen={screen} />;
					case 'message':
						return <Message theme={theme} screen={screen} />;
				}
			})();

			// The doctype is prepended rather than being part of the tree
			// because the JSX runtime will not emit one, and without it every
			// one of these pages renders in quirks mode.
			return new Response(`<!doctype html>${body.toString()}`, {
				status: screen.status ?? 200,
				headers: { 'Content-Type': 'text/html; charset=utf-8' }
			});
		}
	};
}

/* -------------------------------------------------------------------------- */
/*  Screens                                                                    */
/* -------------------------------------------------------------------------- */

function Choose(props: { theme?: Theme; screen: ChooseScreen }) {
	return (
		<Layout theme={props.theme}>
			<div data-component="form">
				{props.screen.options.map((option) => (
					<a href={option.href} data-component="button" data-color="ghost">
						{option.mark && <Glyph mark={option.mark} />}
						{option.label}
					</a>
				))}
			</div>
			{props.screen.footer && <Footer copy={props.screen.footer} />}
		</Layout>
	);
}

function Form(props: { theme?: Theme; screen: FormScreen }) {
	const screen = props.screen;
	return (
		<Layout theme={props.theme}>
			<form data-component="form" method={screen.method ?? 'post'} action={screen.action}>
				{screen.fields.map((field) => (
					<Input field={field} />
				))}
				{screen.alerts?.map((alert) => (
					<Note alert={alert} />
				))}
				<button data-component="button">{screen.submit}</button>
			</form>

			{screen.links && screen.links.length > 0 && (
				<div data-component="form-footer">
					{screen.links.map((entry) => (
						<span>
							{entry.prompt ? `${entry.prompt} ` : ''}
							<Anchor
								href={entry.link.href}
								external={entry.link.external}
								label={entry.link.label}
							/>
						</span>
					))}
				</div>
			)}

			{screen.aside && (
				<form method={screen.method ?? 'post'} action={screen.action}>
					{screen.aside.fields?.map((field) => (
						<Input field={field} />
					))}
					<div data-component="form-footer">
						<span>
							{screen.aside.prompt ? `${screen.aside.prompt} ` : ''}
							<button data-component="link">{screen.aside.submit}</button>
						</span>
					</div>
				</form>
			)}

			{screen.footer && <Footer copy={screen.footer} />}
		</Layout>
	);
}

function Confirm(props: { theme?: Theme; screen: ConfirmScreen }) {
	const screen = props.screen;
	return (
		<Layout theme={props.theme} headline={<Headline text={screen.heading} />}>
			{screen.verify && (
				<p data-component="verify">{group(screen.verify.code, screen.verify.group)}</p>
			)}
			<div data-component="prose">
				{screen.body.map((line) => (
					<p>
						<Prose copy={line} />
					</p>
				))}
			</div>
			<form data-component="form" method="post" action={screen.action}>
				{screen.fields?.map((field) => (
					<Input field={field} />
				))}
				<button data-component="button" name={screen.approve.name} value={screen.approve.value}>
					{screen.approve.label}
				</button>
				<button
					data-component="button"
					data-color="ghost"
					name={screen.deny.name}
					value={screen.deny.value}>
					{screen.deny.label}
				</button>
			</form>
			{screen.footer && <Footer copy={screen.footer} />}
		</Layout>
	);
}

function Message(props: { theme?: Theme; screen: MessageScreen }) {
	const screen = props.screen;
	return (
		<Layout theme={props.theme} headline={<Headline text={screen.heading} />}>
			<div data-component="prose" data-tone={screen.tone}>
				{screen.body.map((line) => (
					<p>
						<Prose copy={line} />
					</p>
				))}
			</div>
			{screen.link && (
				<div data-component="form">
					<a href={screen.link.href} data-component="button" data-color="ghost">
						{screen.link.label}
					</a>
				</div>
			)}
		</Layout>
	);
}

/* -------------------------------------------------------------------------- */
/*  Pieces                                                                     */
/* -------------------------------------------------------------------------- */

function Headline(props: { text: string }) {
	return (
		<h2 data-component="title">
			<strong>{props.text}</strong>
		</h2>
	);
}

/**
 * A field, drawn according to what it means rather than what it is.
 *
 * `segments` is the one that earns its own case: a code read off one screen and
 * typed into another wants to be wide, tracked out and unambiguous, and it is
 * the same treatment whether the code arrived by email or is showing on a
 * television. Both used to describe that separately, in different files.
 */
function Input(props: { field: Field }) {
	const field = props.field;

	if (field.kind === 'hidden') {
		return <input type="hidden" name={field.name} value={field.value} />;
	}

	if (field.kind === 'segments') {
		// A grouped code is shown with a separator, `BCDF-3467`, and will be
		// typed or pasted the way it was read. Room for the separators, and a
		// pattern that allows them, or the box truncates a correct code to
		// `BCDF-346` before the server — which ignores them — ever sees it.
		const char = field.numeric ? '[0-9]' : '[A-Za-z0-9]';
		const groups = field.group && field.group > 0 ? Math.ceil(field.length / field.group) : 1;
		const sizes = Array.from({ length: groups }, (_, i) =>
			Math.min(field.group ?? field.length, field.length - i * (field.group ?? field.length))
		);
		// One box per character once `segments.ts` has run; this single field
		// until then, and for good if it never does.
		return (
			<>
				<div
					data-component="segments"
					data-length={field.length}
					data-group={field.group}
					data-numeric={field.numeric ? 'true' : 'false'}>
					<input
						data-component="input"
						data-variant="code"
						type="text"
						name={field.name}
						aria-label={field.label}
						placeholder={field.label}
						minLength={field.length}
						maxLength={field.length + groups - 1}
						// Whole and well-formed, or `:invalid` — which is what the stylesheet
						// dims the button on. `minLength` alone is not checked until edited.
						pattern={sizes.map((n) => `${char}{${n}}`).join('[\\- ]?')}
						size={field.length + groups - 1}
						required
						spellcheck={false}
						autocapitalize="characters"
						inputmode={field.numeric ? 'numeric' : 'text'}
						autocomplete={field.autocomplete}
						autofocus={field.autofocus}
					/>
				</div>
				<script dangerouslySetInnerHTML={{ __html: segments }} />
			</>
		);
	}

	if (field.kind === 'password') {
		return (
			<input
				data-component="input"
				type="password"
				name={field.name}
				aria-label={field.label}
				placeholder={field.label}
				required={field.required ?? true}
				autocomplete={field.autocomplete}
				autofocus={field.autofocus}
			/>
		);
	}

	return (
		<input
			data-component="input"
			type={field.kind === 'email' ? 'email' : field.kind === 'tel' ? 'tel' : 'text'}
			name={field.name}
			aria-label={field.label}
			placeholder={field.label}
			inputmode={field.kind === 'email' ? 'email' : field.kind === 'tel' ? 'numeric' : undefined}
			required={field.required ?? true}
			autocomplete={field.autocomplete}
			autofocus={field.autofocus}
		/>
	);
}

/**
 * A line of small text under the fields: red when something went wrong, green
 * when something just happened. No box and no icon, so it reads as part of the
 * input it is about rather than as a second thing on the page.
 */
function Note(props: { alert: Alert }) {
	return (
		<p
			data-component="form-alert"
			data-color={props.alert.tone}
			role={props.alert.tone === 'danger' ? 'alert' : 'status'}>
			{props.alert.message}
		</p>
	);
}

function Footer(props: { copy: Copy }) {
	return (
		<p data-component="form-footer">
			<Prose copy={props.copy} />
		</p>
	);
}

/** One line of copy, with its links kept inside the sentence they belong to. */
function Prose(props: { copy: Copy }) {
	if (typeof props.copy === 'string') return <>{props.copy}</>;
	return (
		<>
			{props.copy.map((run) =>
				typeof run === 'string' ? (
					<>{run}</>
				) : (
					<Anchor href={run.href} external={run.external} label={run.text} />
				)
			)}
		</>
	);
}

function Anchor(props: { href: string; label: string; external?: boolean }) {
	return (
		<a
			href={props.href}
			{...(props.external ? { rel: 'noopener noreferrer', target: '_blank' } : {})}>
			{props.label}
		</a>
	);
}

/**
 * A brand mark.
 *
 * The markup comes from a library constant in `mark.ts` and never from anything
 * a request carries, which is what makes injecting it here safe. A provider
 * naming its own mark is the reason marks are strings at all.
 */
function Glyph(props: { mark: Mark }) {
	return <i data-slot="icon" dangerouslySetInnerHTML={{ __html: props.mark }} />;
}

/** `ABCD1234` shown as `ABCD-1234`, so it can be read aloud and compared. */
function group(code: string, size?: number): string {
	if (!size || size <= 0 || code.length <= size) return code;
	const parts: string[] = [];
	for (let at = 0; at < code.length; at += size) parts.push(code.slice(at, at + size));
	return parts.join('-');
}
