/**
 * What a sign-in page asks for, described as data.
 *
 * Nothing here renders anything. A provider says *what it needs from the
 * person* — an address, a pin, a yes-or-no — and something else decides what
 * that looks like. That split is the whole point of this file, and it is worth
 * saying why, because the shape it replaced is the more obvious one.
 *
 * Previously each provider was handed a callback and asked to return a
 * `Response`. That makes every provider a small web framework: it has to know
 * about markup, about the stylesheet's class names, about how a page is
 * assembled. So each one grew its own callback signature, its own copy, its own
 * `new Response(jsx.toString())` — and there was no shared vocabulary left to
 * style, so adding a provider meant writing a page and adding a screen meant
 * writing CSS.
 *
 * With screens as data there is exactly one thing that knows about markup, and
 * a new provider describes itself in a dozen lines. The other half of the same
 * trade: a renderer can be swapped whole, because {@link Screen} is the entire
 * contract between the two halves.
 *
 * @packageDocumentation
 */

/**
 * Raw SVG markup for a brand mark.
 *
 * A string and not JSX so that `provider/*.ts` can name its own mark without
 * any of them importing a rendering library — a provider describing itself
 * must not drag in the thing that draws it. These are library constants,
 * written here, never assembled from anything a request carries.
 */
export type Mark = string;

/**
 * A fragment of a sentence, which may be a link.
 *
 * Copy that contains a link is a list of these rather than a string with
 * markup in it, because the alternative is either HTML in a translatable
 * string or a sentence glued together from fragments in the markup. Both put
 * the sentence somewhere a translator cannot see it whole.
 */
export type Run = string | { text: string; href: string; external?: boolean };

/** One line of prose, with or without links in it. */
export type Copy = string | Run[];

/** A link, as a person reads it. */
export interface Link {
	label: string;
	href: string;
	external?: boolean;
}

/** The banner above a form saying what went wrong, or what just happened. */
export interface Alert {
	tone: 'danger' | 'success';
	message: string;
}

/** A button that submits, and the form value it carries when it does. */
export interface Action {
	label: string;
	name?: string;
	value?: string;
}

/**
 * Something the person is asked to type.
 *
 * `kind` is the *meaning*, not the widget: `segments` is "a code read off one
 * screen and typed into another", which is both the emailed pin and the device
 * user code. Naming it by meaning is what lets the two share a treatment
 * without either one describing it.
 */
export type Field =
	| { kind: 'hidden'; name: string; value: string }
	| {
			kind: 'email' | 'tel' | 'text';
			name: string;
			label: string;
			autocomplete?: string;
			autofocus?: boolean;
			required?: boolean;
	  }
	| {
			kind: 'password';
			name: string;
			label: string;
			autocomplete?: string;
			autofocus?: boolean;
			required?: boolean;
	  }
	| {
			kind: 'segments';
			name: string;
			label: string;
			/** How many characters the code has, in total. */
			length: number;
			/** Insert a visual break every `group` characters. */
			group?: number;
			/** Digits only, which also brings up the numeric keypad. */
			numeric?: boolean;
			autocomplete?: string;
			autofocus?: boolean;
	  };

/** One way in, on the screen that offers a choice of them. */
export interface ChooseOption {
	href: string;
	label: string;
	mark?: Mark;
}

/**
 * Pick a way to sign in.
 *
 * The options are built from what the providers declare about themselves, so
 * this screen has no list of known providers in it and adding one does not
 * touch this file. That list used to live in the rendering code as two
 * hardcoded records, which meant a provider could not be added without editing
 * the library that drew it.
 */
export interface ChooseScreen {
	kind: 'choose';
	options: ChooseOption[];
	footer?: Copy;
	status?: number;
}

/** Ask for some values and submit them. */
export interface FormScreen {
	kind: 'form';
	method?: 'get' | 'post';
	action?: string;
	alerts?: Alert[];
	fields: Field[];
	submit: string;
	/**
	 * A second, smaller form under the first.
	 *
	 * This exists for one shape and should stay that narrow: an action that is
	 * a sentence rather than a button — "Didn't get code? Resend" — and that
	 * has to be its own form because it submits different values.
	 */
	aside?: { prompt?: string; fields?: Field[]; submit: string };
	/** Links under the form: "Already have an account? Login". */
	links?: { prompt?: string; link: Link }[];
	footer?: Copy;
	status?: number;
}

/**
 * Say what is about to happen and ask whether to do it.
 *
 * Distinct from a form with two buttons because the question is distinct: a
 * form collects something the person knows, and this one asks them to check a
 * fact in front of them and answer for it. `verify` is that fact — a code
 * shown back so it can be compared against the one on the device.
 */
export interface ConfirmScreen {
	kind: 'confirm';
	heading: string;
	body: Copy[];
	verify?: { code: string; group?: number };
	action?: string;
	fields?: Field[];
	approve: Action;
	deny: Action;
	status?: number;
}

/**
 * A dead end that says so.
 *
 * Every plain-text error reply is one of these. They were `c.text(...)`, which
 * is how a person following a link off a television ends up looking at
 * unstyled black-on-white in the middle of signing in.
 */
export interface MessageScreen {
	kind: 'message';
	tone: 'danger' | 'notice';
	heading: string;
	body: Copy[];
	link?: Link;
	status?: number;
}

export type Screen = ChooseScreen | FormScreen | ConfirmScreen | MessageScreen;
