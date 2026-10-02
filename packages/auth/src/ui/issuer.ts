/**
 * The screens the issuer draws itself, rather than a provider.
 *
 * They were written inline in the route handlers, which kept each next to the
 * condition that reaches it but meant the only way to look at one was to
 * arrange that condition — an expired cookie, a refused grant, a code guessed
 * wrong ten times. Here each is a value that can be rendered on its own, which
 * is what the preview in `apps/auth/script/preview.ts` does with every one.
 *
 * Copy and status only. How any of them looks is `render.tsx`'s business.
 *
 * @packageDocumentation
 */

import type { Screen } from './screen.js';

/** The confirmation a device grant asks for, before it is approved. */
export interface DeviceConfirmCopy {
	userCode: string;
	csrf: string;
}

export const IssuerScreens = {
	/** The authorization state a request named is missing or unreadable. */
	unknownState(message: string): Screen {
		return {
			kind: 'message',
			tone: 'danger',
			heading: 'That sign-in has expired',
			body: [message, 'Start again from wherever you were signing in.'],
			status: 400
		};
	},

	/**
	 * What a device grant says once there is nothing left to answer.
	 *
	 * Written once because three different dead ends reach it — a cookie that
	 * timed out, a grant that expired, a confirmation that was already given —
	 * and the person on the other end can do the same one thing about all
	 * three.
	 */
	deviceExpired(): Screen {
		return {
			kind: 'message',
			tone: 'danger',
			heading: 'That sign-in request has expired',
			body: ['Start it again from the app.'],
			status: 400
		};
	},

	deviceEnter(length: number): Screen {
		return {
			kind: 'form',
			method: 'get',
			action: '/device',
			fields: [
				{
					kind: 'segments',
					name: 'user_code',
					label: 'Enter the code shown in the app',
					length,
					autocomplete: 'off',
					autofocus: true
				}
			],
			submit: 'Continue'
		};
	},

	deviceTooManyTries(): Screen {
		return {
			kind: 'message',
			tone: 'danger',
			heading: 'Too many tries',
			body: ['Wait a while, then start again from the app.'],
			status: 429
		};
	},

	deviceInvalidCode(): Screen {
		return {
			kind: 'message',
			tone: 'danger',
			heading: 'That code is not valid',
			body: ['It may have expired, or already been used. Ask the app for a new one.'],
			status: 400
		};
	},

	deviceConfirm(confirmation: DeviceConfirmCopy): Screen {
		return {
			kind: 'confirm',
			heading: 'Is this you?',
			verify: { code: confirmation.userCode, group: 4 },
			// Not the client id. It is chosen by whoever started the grant, so
			// naming it would let a stranger's request introduce itself as
			// anything it likes — and to the person reading, it is a device.
			body: [
				'A device is asking to sign in to your account. The code above should match the one it is showing you.'
			],
			action: '/device/confirm',
			fields: [{ kind: 'hidden', name: 'csrf', value: confirmation.csrf }],
			approve: { label: 'Approve', name: 'action', value: 'approve' },
			deny: { label: 'Deny', name: 'action', value: 'deny' },
			footer:
				'If it does not, or you did not start this on a device of your own, choose Deny. Nobody can sign in as you unless you approve here.'
		};
	},

	deviceForgedForm(): Screen {
		return {
			kind: 'message',
			tone: 'danger',
			heading: 'That form was not the one we sent',
			body: ['Start again from the app.'],
			status: 400
		};
	},

	deviceDenied(): Screen {
		return {
			kind: 'message',
			tone: 'notice',
			heading: 'Refused',
			body: ['That sign-in request was refused. You can close this page.']
		};
	},

	deviceAlreadyAnswered(): Screen {
		return {
			kind: 'message',
			tone: 'danger',
			heading: 'Already answered',
			body: ['That sign-in request has already been answered.'],
			status: 400
		};
	},

	deviceApproved(): Screen {
		return {
			kind: 'message',
			tone: 'notice',
			heading: 'You are signed in',
			body: ['You can close this page and go back to the app.']
		};
	}
};
