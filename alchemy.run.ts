import * as Alchemy from 'alchemy';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Cloudflare from 'alchemy/Cloudflare';
import { Redacted } from 'effect';
import * as Effect from 'effect/Effect';

const steamApiKey = Redacted.make(process.env.STEAM_API_KEY!);
const adminSharedSecret =
	process.env.ADMIN_SHARED_SECRET || 'dev-admin-shared-secret-change-in-prod';

/**
 * Stages where a missing setting is a deploy failure rather than a default.
 *
 * A stage somebody else can reach has to be configured; a throwaway one a
 * developer made this morning does not. The list is the same one that decides
 * observability and DNS below, named once so the two cannot drift apart.
 */
const PERMANENT_STAGES = ['production', 'sandbox', 'dev'];

/**
 * Mail settings, refused rather than defaulted when a stage needs them.
 *
 * Verifying an address is the only way to sign in, so a worker that cannot
 * send mail cannot sign anybody in — and the failure to catch is the one where
 * that is discovered by a person staring at a screen that says "check your
 * email". Checking here turns it into a deploy that stops with the name of the
 * variable it wanted.
 */
function mailEnv(stage: string) {
	const url = process.env.EMAIL_SEND_URL;
	const key = process.env.EMAIL_API_KEY;
	const from = process.env.EMAIL_FROM;

	if (PERMANENT_STAGES.includes(stage)) {
		const missing = [
			['EMAIL_SEND_URL', url],
			['EMAIL_API_KEY', key],
			['EMAIL_FROM', from]
		]
			.filter(([, value]) => !value)
			.map(([name]) => name);
		if (missing.length > 0) {
			throw new Error(
				`Stage "${stage}" serves sign-in, so it needs mail delivery configured. ` +
					`Missing: ${missing.join(', ')}.`
			);
		}
	}

	return {
		...(url ? { EMAIL_SEND_URL: url } : {}),
		...(key ? { EMAIL_API_KEY: Redacted.make(key) } : {}),
		...(from ? { EMAIL_FROM: from } : {}),
		// Printing a live sign-in code to the log is a thing you ask for by
		// name. It is never set on a stage anyone else can reach, and the
		// worker refuses to send without either this or real settings, so an
		// unconfigured deploy fails loudly instead of quietly logging codes.
		...(PERMANENT_STAGES.includes(stage) ? {} : { EMAIL_DEV_LOG: 'true' })
	};
}

const AuthStorage = Cloudflare.KV.Namespace('auth-storage');

const Database = Effect.gen(function* () {
	const { stage } = yield* Alchemy.Stack;
	const database = stage === 'production' ? 'defaultdb' : 'sandbox';
	return yield* Cloudflare.Hyperdrive.Connection('db', {
		origin: {
			scheme: 'postgres',
			host: 'public-nestri-pg-1-atdogthbymao.db.upclouddatabases.com',
			port: 11569,
			database,
			user: 'upadmin',
			password: Redacted.make(process.env.DATABASE_PASSWORD!)
		},
		dev: {
			scheme: 'postgres',
			host: 'localhost',
			port: 5432,
			database: 'nestri',
			user: 'postgres',
			sslmode: 'disable',
			password: Redacted.make('postgres')
		}
	});
});

export const Auth = Effect.gen(function* () {
	const { stage } = yield* Alchemy.Stack;
	const isPermanent = PERMANENT_STAGES.includes(stage);
	return yield* Cloudflare.Worker('auth', {
		main: 'apps/auth/src/index.ts',
		compatibility: { flags: ['nodejs_compat'] },
		// No Steam or SSH settings: the issuer serves one provider, and it is
		// the email one. Linking a Steam account is `apps/api`'s job and its
		// key is bound there.
		env: {
			AuthStorage,
			HYPERDRIVE: Database,
			...mailEnv(stage)
		},
		...(isPermanent ? { observability: { enabled: true } } : {})
	});
});

export const Api = Effect.gen(function* () {
	const { stage } = yield* Alchemy.Stack;
	const isPermanent = PERMANENT_STAGES.includes(stage);
	const prefix = stage === 'production' ? '' : `${stage}.`;
	const authDomain = ['production', 'sandbox'].includes(stage)
		? `${prefix}auth.nestri.io`
		: undefined;
	return yield* Cloudflare.Worker('api', {
		main: 'apps/api/app/index.ts',
		compatibility: { flags: ['nodejs_compat'] },
		env: {
			AUTH: Auth,
			AUTH_ISSUER_URL: authDomain ? `https://${authDomain}` : 'http://localhost:1337',
			HYPERDRIVE: Database,
			STEAM_API_KEY: steamApiKey,
			ADMIN_SHARED_SECRET: adminSharedSecret
		},
		...(isPermanent ? { observability: { enabled: true } } : {})
	});
});

export default Alchemy.Stack(
	'nestri',
	{
		providers: Cloudflare.providers(),
		state: Alchemy.localState()
	},
	Effect.gen(function* () {
		const { stage } = yield* Alchemy.Stack;

		yield* Database;
		const auth = yield* Auth;
		const api = yield* Api;

		if (stage === 'production' || stage === 'sandbox') {
			const zone = yield* Cloudflare.Zone.Zone('zone', {
				name: 'nestri.io'
			}).pipe(adopt(true));

			const prefix = stage === 'production' ? '' : `${stage}.`;

			yield* Cloudflare.DNS.Record('auth-dns', {
				zoneId: zone.zoneId,
				name: `${prefix}auth.nestri.io`,
				type: 'AAAA',
				content: '100::',
				proxied: true
			});

			yield* Cloudflare.DNS.Record('api-dns', {
				zoneId: zone.zoneId,
				name: `${prefix}api.nestri.io`,
				type: 'AAAA',
				content: '100::',
				proxied: true
			});

			yield* Cloudflare.Workers.WorkerRoute('auth-route', {
				zoneId: zone.zoneId,
				pattern: `${prefix}auth.nestri.io/*`,
				script: auth.workerName
			});

			yield* Cloudflare.Workers.WorkerRoute('api-route', {
				zoneId: zone.zoneId,
				pattern: `${prefix}api.nestri.io/*`,
				script: api.workerName
			});
		}

		return {
			authUrl: auth.url.as<string>(),
			apiUrl: api.url.as<string>()
		};
	})
);
