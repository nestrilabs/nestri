/**
 * The screens for the pin code provider.
 *
 * ```ts
 * import { CodeUI } from "@nestri/auth/ui/code"
 * import { CodeProvider } from "@nestri/auth/provider/code"
 *
 * export default issuer({
 *   providers: {
 *     code: CodeProvider(
 *       CodeUI({
 *         copy: { code_info: "We'll send a pin code to your email" },
 *         sendCode: (claims, code) => console.log(claims.email, code)
 *       })
 *     )
 *   }
 * })
 * ```
 *
 * What this file contains is copy and flow — which alert belongs to which
 * error, what the two steps ask for. It contains no markup, because how a
 * screen is drawn is the renderer's business and describing it here is what
 * made every provider its own little design system.
 *
 * @packageDocumentation
 */

import type { CodeProviderOptions } from '../provider/code.js';
import type { Alert, Copy, Screen } from './screen.js';

const DEFAULT_COPY = {
	/**
	 * Copy for the email input.
	 */
	email_placeholder: 'Email',
	/**
	 * Error message when the email is invalid.
	 */
	email_invalid: 'Email address is not valid',
	/**
	 * Copy for the continue button.
	 */
	button_continue: 'Continue',
	/**
	 * Copy informing that the pin code will be emailed.
	 */
	code_info: "We'll send a pin code to your email.",
	/**
	 * Copy for the pin code input.
	 */
	code_placeholder: 'Code',
	/**
	 * Error message when the code is invalid.
	 */
	code_invalid: 'Invalid code',
	/**
	 * Copy for when the code was sent.
	 */
	code_sent: 'Code sent to ',
	/**
	 * Copy for when the code was resent.
	 */
	code_resent: 'Code resent to ',
	/**
	 * Copy for the link to resend the code.
	 */
	code_didnt_get: "Didn't get code?",
	/**
	 * Copy for the resend button.
	 */
	code_resend: 'Resend',
	/**
	 * Error message when too many codes have been asked for, or too many
	 * guesses made. Deliberately one message for both: which of the two it was
	 * is a fact about somebody else's mailbox.
	 */
	rate_limited: 'Too many attempts. Wait a moment and start again.',
	/**
	 * The consent line under the action, split around its two links so the
	 * sentence stays one translatable run rather than being glued together
	 * from fragments in the markup.
	 */
	terms_before:
		'By continuing, you acknowledge that you have read and understood, and agree to Nestri’s ',
	terms_label: 'Terms & Conditions',
	terms_url: 'https://nestri.io/terms',
	terms_between: ' and ',
	privacy_label: 'Privacy Policy',
	privacy_url: 'https://nestri.io/privacy',
	terms_after: '.'
};

export type CodeUICopy = typeof DEFAULT_COPY;

export interface CodeUIOptions {
	/**
	 * Callback to send the pin code to the user.
	 *
	 * The `claims` object contains the email or phone number of the user.
	 */
	sendCode: (claims: Record<string, string>, code: string) => Promise<void>;
	/**
	 * Custom copy for the UI.
	 */
	copy?: Partial<CodeUICopy>;
	/**
	 * The mode to use for the input.
	 * @default "email"
	 */
	mode?: 'email' | 'phone';
}

/**
 * Creates the screens for the code provider flow.
 * @param props - Configure the screens.
 */
export function CodeUI(props: CodeUIOptions): CodeProviderOptions {
	const copy = { ...DEFAULT_COPY, ...props.copy };
	const mode = props.mode ?? 'email';

	const terms: Copy = [
		copy.terms_before,
		{ text: copy.terms_label, href: copy.terms_url, external: true },
		copy.terms_between,
		{ text: copy.privacy_label, href: copy.privacy_url, external: true },
		copy.terms_after
	];

	return {
		sendCode: props.sendCode,
		length: 6,
		request: async (_req, state, _form, error): Promise<Screen> => {
			const alerts: Alert[] = [];
			if (error?.type === 'invalid_claim')
				alerts.push({ tone: 'danger', message: copy.email_invalid });
			if (error?.type === 'rate_limit') alerts.push({ tone: 'danger', message: copy.rate_limited });

			if (state.type === 'start') {
				return {
					kind: 'form',
					alerts,
					fields: [
						{ kind: 'hidden', name: 'action', value: 'request' },
						{
							kind: mode === 'email' ? 'email' : 'tel',
							name: mode === 'email' ? 'email' : 'phone',
							label: copy.email_placeholder,
							autocomplete: mode === 'email' ? 'email' : 'tel',
							autofocus: true
						}
					],
					submit: copy.button_continue,
					footer: terms
				};
			}

			if (error?.type === 'invalid_code')
				alerts.push({ tone: 'danger', message: copy.code_invalid });
			// Said after any error, so a person who mistyped still sees which
			// address the code they are looking for actually went to.
			alerts.push({
				tone: 'success',
				message: (state.resend ? copy.code_resent : copy.code_sent) + state.claims[mode]
			});

			return {
				kind: 'form',
				alerts,
				fields: [
					{ kind: 'hidden', name: 'action', value: 'verify' },
					{
						kind: 'segments',
						name: 'code',
						label: copy.code_placeholder,
						length: 6,
						numeric: true,
						autocomplete: 'one-time-code',
						autofocus: true
					}
				],
				submit: copy.button_continue,
				aside: {
					prompt: copy.code_didnt_get,
					submit: copy.code_resend,
					fields: [
						...Object.entries(state.claims).map(
							([name, value]) => ({ kind: 'hidden', name, value }) as const
						),
						{ kind: 'hidden', name: 'action', value: 'request' }
					]
				}
			};
		}
	};
}
