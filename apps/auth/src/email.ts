/**
 * Getting a pin code to a mailbox.
 *
 * Deliberately not tied to one mail vendor: it posts a small JSON body to
 * whatever endpoint is configured, so swapping providers is configuration and
 * not a code change. Three settings, all optional except in production —
 * `EMAIL_SEND_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`.
 */
export interface MailerConfig {
	EMAIL_SEND_URL?: string;
	EMAIL_API_KEY?: string;
	EMAIL_FROM?: string;
	NODE_ENV?: string;
}

/**
 * Send the code, or fail loudly.
 *
 * With no mailer configured this logs the code and carries on, which is what
 * makes a local sign-in possible without a mail account. In production the
 * same situation throws instead: a signup screen that says "check your email"
 * when nothing was sent is worse than one that says it is broken, because the
 * person waits instead of telling anybody.
 */
export async function sendVerificationCode(
	config: MailerConfig,
	email: string,
	code: string
): Promise<void> {
	const configured = config.EMAIL_SEND_URL && config.EMAIL_API_KEY && config.EMAIL_FROM;

	if (!configured) {
		if (config.NODE_ENV === 'production') {
			throw new Error('Email delivery is not configured, so no sign-in code can be sent');
		}
		console.log(`[auth] sign-in code for ${email}: ${code}`);
		return;
	}

	const response = await fetch(config.EMAIL_SEND_URL!, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${config.EMAIL_API_KEY}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			from: config.EMAIL_FROM,
			to: [email],
			subject: `${code} is your Nestri sign-in code`,
			text:
				`Your Nestri sign-in code is ${code}.\n\n` +
				`It expires shortly. If you did not ask to sign in, you can ignore this.`
		})
	});

	if (!response.ok) {
		// The body is included because the useful part of a delivery failure is
		// always the provider's own message, and it is otherwise lost.
		throw new Error(`Sending the sign-in code failed: ${response.status} ${await response.text()}`);
	}
}
