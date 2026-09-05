/**
 * Getting a pin code to a mailbox.
 *
 * Deliberately not tied to one mail vendor: it posts a small JSON body to
 * whatever endpoint is configured, so swapping providers is configuration and
 * not a code change. Three settings — `EMAIL_SEND_URL`, `EMAIL_API_KEY`,
 * `EMAIL_FROM` — and a fourth, `EMAIL_DEV_LOG`, that asks for the code to be
 * printed instead of sent.
 */
export interface MailerConfig {
	EMAIL_SEND_URL?: string;
	EMAIL_API_KEY?: string;
	EMAIL_FROM?: string;
	/**
	 * Print the code to the log rather than sending it. `'true'` and nothing
	 * else, so a variable left holding `'false'` or `'0'` cannot switch it on.
	 */
	EMAIL_DEV_LOG?: string;
}

/**
 * Send the code, or refuse.
 *
 * The rule is that printing a live sign-in code to a log is something you ask
 * for by name, and that anything else is an error. It reads that way round
 * because the alternative — treat an unconfigured mailer as "must be a
 * developer" — fails *open*: the deployment that forgets its mail settings is
 * exactly the deployment with no marker saying it is a real one, so it takes
 * the developer branch, logs every recipient and every usable code to a
 * retained log, and reports success while nobody receives anything.
 *
 * Configuration is also all-or-nothing. Two settings out of three is somebody
 * halfway through wiring a provider up, and quietly falling back would hide
 * the half that is missing.
 */
export async function sendVerificationCode(
	config: MailerConfig,
	email: string,
	code: string
): Promise<void> {
	const present = [config.EMAIL_SEND_URL, config.EMAIL_API_KEY, config.EMAIL_FROM].filter(Boolean);

	if (present.length === 0) {
		if (config.EMAIL_DEV_LOG === 'true') {
			console.log(`[auth] sign-in code for ${email}: ${code}`);
			return;
		}
		throw new Error(
			'Email delivery is not configured, so no sign-in code can be sent. ' +
				'Set EMAIL_SEND_URL, EMAIL_API_KEY and EMAIL_FROM, or set EMAIL_DEV_LOG=true ' +
				'to print codes to the log instead.'
		);
	}

	if (present.length < 3) {
		throw new Error(
			'Email delivery is half configured: EMAIL_SEND_URL, EMAIL_API_KEY and EMAIL_FROM ' +
				'are needed together.'
		);
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
