/**
 * The screens for the password provider.
 *
 * ```ts
 * import { PasswordUI } from "@nestri/auth/ui/password"
 * import { PasswordProvider } from "@nestri/auth/provider/password"
 *
 * export default issuer({
 *   providers: {
 *     password: PasswordProvider(
 *       PasswordUI({
 *         copy: { error_email_taken: "This email is already taken." },
 *         sendCode: (email, code) => console.log(email, code)
 *       })
 *     )
 *   }
 * })
 * ```
 *
 * Six screens across three flows, and not one of them mentions a colour, a
 * class name or a tag. That is the difference the {@link Screen} boundary
 * makes: this file was markup for six pages, drifting from the design language
 * every time the design language moved, and none of it was noticed because
 * nobody had turned password sign-in on yet.
 *
 * @packageDocumentation
 */

import type {
	PasswordChangeError,
	PasswordChangeState,
	PasswordConfig,
	PasswordLoginError,
	PasswordRegisterError,
	PasswordRegisterState
} from '../provider/password.js';
import type { Alert, Field, Screen } from './screen.js';

const DEFAULT_COPY = {
	/** Error message when email is already taken. */
	error_email_taken: 'There is already an account with this email.',
	/** Error message when the confirmation code is incorrect. */
	error_invalid_code: 'Code is incorrect.',
	/** Error message when the email is invalid. */
	error_invalid_email: 'Email is not valid.',
	/** Error message when the password is incorrect. */
	error_invalid_password: 'Password is incorrect.',
	/** Error message when the passwords do not match. */
	error_password_mismatch: 'Passwords do not match.',
	/** Error message when the user enters a password that fails validation. */
	error_validation_error: 'Password does not meet requirements.',
	/** Copy for the register button. */
	register: 'Register',
	/** Copy for the register link. */
	register_prompt: "Don't have an account?",
	/** Copy for the login link. */
	login_prompt: 'Already have an account?',
	/** Copy for the login button. */
	login: 'Login',
	/** Copy for the forgot password link. */
	change_prompt: 'Forgot password?',
	/** Copy for the resend code button. */
	code_resend: 'Resend code',
	/** Copy for the "Back to" link. */
	code_return: 'Back to',
	/** Copy for the email input. */
	input_email: 'Email',
	/** Copy for the password input. */
	input_password: 'Password',
	/** Copy for the code input. */
	input_code: 'Code',
	/** Copy for the repeat password input. */
	input_repeat: 'Repeat password',
	/** Copy for the continue button. */
	button_continue: 'Continue'
} satisfies {
	[key in `error_${
		| PasswordLoginError['type']
		| PasswordRegisterError['type']
		| PasswordChangeError['type']}`]: string;
} & Record<string, string>;

export type PasswordUICopy = typeof DEFAULT_COPY;

export interface PasswordUIOptions extends Pick<PasswordConfig, 'sendCode' | 'validatePassword'> {
	/**
	 * Custom copy for the UI.
	 */
	copy?: Partial<PasswordUICopy>;
}

/**
 * Creates the screens for the password provider flow.
 * @param input - Configure the screens.
 */
export function PasswordUI(input: PasswordUIOptions): PasswordConfig {
	const copy = { ...DEFAULT_COPY, ...input.copy };

	/**
	 * The banner for whatever just went wrong.
	 *
	 * One function for all three flows because the error types overlap almost
	 * entirely, and a `validation_error` carries its own message — the only
	 * case where the provider knows better than the copy table what to say.
	 */
	function alerts(
		error?: PasswordLoginError | PasswordRegisterError | PasswordChangeError
	): Alert[] {
		if (!error) return [];
		if (error.type === 'validation_error') {
			return [{ tone: 'danger', message: error.message || copy.error_validation_error }];
		}
		return [{ tone: 'danger', message: copy[`error_${error.type}`] }];
	}

	const codeField: Field = {
		kind: 'segments',
		name: 'code',
		label: copy.input_code,
		length: 6,
		numeric: true,
		autocomplete: 'one-time-code',
		autofocus: true
	};

	return {
		validatePassword: input.validatePassword,
		sendCode: input.sendCode,

		login: async (_req, _form, error): Promise<Screen> => ({
			kind: 'form',
			alerts: alerts(error),
			fields: [
				{
					kind: 'email',
					name: 'email',
					label: copy.input_email,
					autocomplete: 'email',
					autofocus: true
				},
				{
					kind: 'password',
					name: 'password',
					label: copy.input_password,
					autocomplete: 'current-password'
				}
			],
			submit: copy.button_continue,
			links: [
				{ prompt: copy.register_prompt, link: { label: copy.register, href: 'register' } },
				{ link: { label: copy.change_prompt, href: 'change' } }
			]
		}),

		register: async (_req, state: PasswordRegisterState, _form, error): Promise<Screen> => {
			if (state.type === 'code') {
				return {
					kind: 'form',
					alerts: alerts(error),
					fields: [{ kind: 'hidden', name: 'action', value: 'verify' }, codeField],
					submit: copy.button_continue,
					links: [{ prompt: copy.code_return, link: { label: copy.login, href: 'authorize' } }]
				};
			}

			return {
				kind: 'form',
				alerts: alerts(error),
				fields: [
					{ kind: 'hidden', name: 'action', value: 'register' },
					{
						kind: 'email',
						name: 'email',
						label: copy.input_email,
						autocomplete: 'email',
						autofocus: true
					},
					{
						kind: 'password',
						name: 'password',
						label: copy.input_password,
						autocomplete: 'new-password'
					},
					{
						kind: 'password',
						name: 'repeat',
						label: copy.input_repeat,
						autocomplete: 'new-password'
					}
				],
				submit: copy.button_continue,
				links: [{ prompt: copy.login_prompt, link: { label: copy.login, href: 'authorize' } }]
			};
		},

		change: async (_req, state: PasswordChangeState, _form, error): Promise<Screen> => {
			if (state.type === 'code') {
				return {
					kind: 'form',
					alerts: alerts(error),
					fields: [{ kind: 'hidden', name: 'action', value: 'verify' }, codeField],
					submit: copy.button_continue,
					links: [{ prompt: copy.code_return, link: { label: copy.login, href: 'authorize' } }]
				};
			}

			if (state.type === 'update') {
				return {
					kind: 'form',
					alerts: alerts(error),
					fields: [
						{ kind: 'hidden', name: 'action', value: 'update' },
						{
							kind: 'password',
							name: 'password',
							label: copy.input_password,
							autocomplete: 'new-password',
							autofocus: true
						},
						{
							kind: 'password',
							name: 'repeat',
							label: copy.input_repeat,
							autocomplete: 'new-password'
						}
					],
					submit: copy.button_continue
				};
			}

			return {
				kind: 'form',
				alerts: alerts(error),
				fields: [
					{ kind: 'hidden', name: 'action', value: 'code' },
					{
						kind: 'email',
						name: 'email',
						label: copy.input_email,
						autocomplete: 'email',
						autofocus: true
					}
				],
				submit: copy.button_continue,
				links: [{ prompt: copy.code_return, link: { label: copy.login, href: 'authorize' } }]
			};
		}
	};
}
