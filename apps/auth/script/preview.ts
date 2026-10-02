/**
 * Every sign-in screen, side by side, reloading as you edit.
 *
 *   bun run preview        # from apps/auth, then open http://localhost:1338
 *
 * No database, no mail, no cookies. Each state is the real screen value — the
 * code provider's own `request` called with a made-up state, and the issuer's
 * screens from `ui/issuer.ts` — drawn by the real renderer with the real
 * theme. What differs from production is only how the page was reached.
 *
 * `preview-watch.ts` restarts this process when the UI's source changes —
 * the renderer, the stylesheet, the copy, the issuer's screens. Each page polls
 * for the restart and reloads itself, so saving a file is the whole loop.
 *
 * A state that is missing here is a state nobody will look at before it
 * ships. Adding a screen to the flow means adding it to `STATES`.
 */

import type { CodeProviderState } from '@nestri/auth/provider/code';
import { CodeUI } from '@nestri/auth/ui/code';
import { IssuerScreens } from '@nestri/auth/ui/issuer';
import { MARK_CODE, MARK_GITHUB, MARK_GOOGLE } from '@nestri/auth/ui/mark';
import { HtmlRenderer } from '@nestri/auth/ui/render';
import type { Screen } from '@nestri/auth/ui/screen';

import { THEME_NESTRI } from '../src/theme.js';

const PORT = Number(process.env.PORT ?? 1338);
const BOOT = crypto.randomUUID();
const renderer = HtmlRenderer({ theme: THEME_NESTRI });

// Matches `USER_CODE_LENGTH` in the issuer, which is local to it.
const DEVICE_CODE_LENGTH = 8;

const code = CodeUI({ sendCode: async () => {} });
const req = new Request(`http://localhost:${PORT}/`);
const email = 'someone@example.com';
const sent = {
	type: 'code',
	code: '123456',
	claims: { email },
	flow: 'x',
	expires: 0
} satisfies CodeProviderState;

interface State {
	id: string;
	group: string;
	label: string;
	screen: () => Promise<Screen> | Screen;
}

const STATES: State[] = [
	// Email code — what everyone sees.
	{
		id: 'email',
		group: 'Email',
		label: 'Enter email',
		screen: () => code.request(req, { type: 'start' }, new FormData())
	},
	{
		id: 'email-invalid',
		group: 'Email',
		label: 'Bad address',
		screen: () =>
			code.request(req, { type: 'start' }, new FormData(), {
				type: 'invalid_claim',
				key: 'email',
				value: 'nope'
			})
	},
	{
		id: 'email-rate-limit',
		group: 'Email',
		label: 'Rate limited (email)',
		screen: () =>
			code.request(req, { type: 'start' }, new FormData(), {
				type: 'rate_limit'
			})
	},
	{
		id: 'code',
		group: 'Email',
		label: 'Code sent',
		screen: () => code.request(req, sent, new FormData())
	},
	{
		id: 'code-resent',
		group: 'Email',
		label: 'Code resent',
		screen: () => code.request(req, { ...sent, resend: true }, new FormData())
	},
	{
		id: 'code-invalid',
		group: 'Email',
		label: 'Wrong code',
		screen: () => code.request(req, sent, new FormData(), { type: 'invalid_code' })
	},
	{
		id: 'code-rate-limit',
		group: 'Email',
		label: 'Rate limited (code)',
		screen: () => code.request(req, sent, new FormData(), { type: 'rate_limit' })
	},

	// Device grant — a TV or a CLI signing in through a browser.
	{
		id: 'device-enter',
		group: 'Device',
		label: 'Enter device code',
		screen: () => IssuerScreens.deviceEnter(DEVICE_CODE_LENGTH)
	},
	{
		id: 'device-confirm',
		group: 'Device',
		label: 'Is this you?',
		screen: () =>
			IssuerScreens.deviceConfirm({
				clientID: 'nestri-cli',
				userCode: 'BCDF3467',
				csrf: 'x'
			})
	},
	{
		id: 'device-approved',
		group: 'Device',
		label: 'Approved',
		screen: () => IssuerScreens.deviceApproved()
	},
	{
		id: 'device-denied',
		group: 'Device',
		label: 'Denied',
		screen: () => IssuerScreens.deviceDenied()
	},
	{
		id: 'device-invalid',
		group: 'Device',
		label: 'Code not valid',
		screen: () => IssuerScreens.deviceInvalidCode()
	},
	{
		id: 'device-too-many',
		group: 'Device',
		label: 'Too many tries',
		screen: () => IssuerScreens.deviceTooManyTries()
	},
	{
		id: 'device-expired',
		group: 'Device',
		label: 'Expired',
		screen: () => IssuerScreens.deviceExpired()
	},
	{
		id: 'device-answered',
		group: 'Device',
		label: 'Already answered',
		screen: () => IssuerScreens.deviceAlreadyAnswered()
	},
	{
		id: 'device-forged',
		group: 'Device',
		label: 'Forged form',
		screen: () => IssuerScreens.deviceForgedForm()
	},

	// Reached only by accident in production, which is why they need looking at.
	{
		id: 'unknown-state',
		group: 'Errors',
		label: 'Sign-in expired',
		screen: () => IssuerScreens.unknownState('The browser was in an unknown state.')
	},
	{
		// Not shown today: with one provider the chooser redirects straight
		// to it. Kept so a second provider does not arrive to an unstyled page.
		id: 'choose',
		group: 'Errors',
		label: 'Provider chooser (unused)',
		screen: () => ({
			kind: 'choose',
			options: [
				{ href: '#', label: 'Continue with Email', mark: MARK_CODE },
				{ href: '#', label: 'Continue with GitHub', mark: MARK_GITHUB },
				{ href: '#', label: 'Continue with Google', mark: MARK_GOOGLE }
			]
		})
	}
];

/** Polls for a restart of this process and reloads when it sees one. */
const RELOAD = `<script>(()=>{const boot=${JSON.stringify(BOOT)};setInterval(async()=>{try{const r=await fetch('/__boot',{cache:'no-store'});if((await r.text())!==boot)location.reload()}catch{}},400)})()</script>`;

async function page(state: State): Promise<Response> {
	const res = renderer.render(await state.screen(), req);
	const html = (await res.text()).replace('</body>', `${RELOAD}</body>`);
	// Always 200, so a 400 screen is not mistaken for a broken preview.
	return new Response(html, {
		headers: { 'Content-Type': 'text/html; charset=utf-8' }
	});
}

function gallery(): Response {
	const groups = [...new Set(STATES.map((s) => s.group))];
	const tiles = groups
		.map(
			(group) =>
				`<h2>${group}</h2><div class="grid">${STATES.filter((s) => s.group === group)
					.map(
						(s) =>
							`<figure><figcaption><a href="/s/${s.id}" target="_blank">${s.label}</a><code>${s.id}</code></figcaption><div class="vp"><iframe src="/s/${s.id}" loading="lazy" title="${s.label}"></iframe></div></figure>`
					)
					.join('')}</div>`
		)
		.join('');

	return new Response(
		`<!doctype html><html><head><meta charset="utf-8"><title>Auth preview</title>
<style>
:root{color-scheme:dark;--w:1440;--h:900;--scale:.3}
body{margin:0;padding:16px 24px 48px;background:#111;color:#ddd;font:13px/1.4 system-ui,sans-serif}
header{position:sticky;top:0;z-index:1;display:flex;gap:8px;align-items:center;padding:8px 0;background:#111}
header b{margin-right:12px}
button{background:#222;color:#ddd;border:1px solid #333;border-radius:6px;padding:4px 10px;cursor:pointer}
button[aria-pressed=true]{background:#ddd;color:#111}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:24px 0 8px}
.grid{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0}
figcaption{display:flex;gap:8px;align-items:baseline;margin-bottom:4px}
figcaption a{color:#ddd}
figcaption code{color:#666}
.vp{width:calc(var(--w)*var(--scale)*1px);height:calc(var(--h)*var(--scale)*1px);overflow:hidden;border:1px solid #2a2a2a;border-radius:4px}
iframe{width:calc(var(--w)*1px);height:calc(var(--h)*1px);border:0;transform:scale(var(--scale));transform-origin:0 0}
</style></head><body>
<header><b>Auth preview</b>
<button data-w="1440" data-h="900" data-s=".3">Desktop</button>
<button data-w="1440" data-h="900" data-s=".55">Desktop large</button>
<button data-w="390" data-h="844" data-s=".6">Phone</button>
<span style="color:#666;margin-left:auto">saves reload every frame · click a title to open full size</span></header>
${tiles}
<script>
const root=document.documentElement,buttons=[...document.querySelectorAll('header button')];
function pick(b){root.style.setProperty('--w',b.dataset.w);root.style.setProperty('--h',b.dataset.h);root.style.setProperty('--scale',b.dataset.s);buttons.forEach(x=>x.setAttribute('aria-pressed',x===b));try{localStorage.vp=buttons.indexOf(b)}catch{}}
buttons.forEach(b=>b.onclick=()=>pick(b));
let i=0;try{i=+localStorage.vp||0}catch{}pick(buttons[i]||buttons[0]);
</script>${RELOAD}</body></html>`,
		{ headers: { 'Content-Type': 'text/html; charset=utf-8' } }
	);
}

Bun.serve({
	port: PORT,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === '/__boot') return new Response(BOOT);
		if (url.pathname === '/') return gallery();
		const state = STATES.find((s) => url.pathname === `/s/${s.id}`);
		if (state) return page(state);
		// A form submitted inside a preview lands here; send it back.
		return Response.redirect(request.headers.get('referer') ?? '/', 303);
	}
});

console.log(`auth preview: http://localhost:${PORT}  (${STATES.length} states)`);
