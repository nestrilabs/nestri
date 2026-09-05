import { type ExtractTablesWithRelations } from 'drizzle-orm';
import { PgTransaction, type PgTransactionConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { type PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { Context } from '../context.js';
import { Env } from '../env.js';

export namespace Database {
	export async function ping() {
		const url = Env.get().DATABASE_URL || process.env.DATABASE_URL;
		const sql = url
			? postgres(url, { idle_timeout: 30, connect_timeout: 30 })
			: postgres({
					idle_timeout: 30,
					connect_timeout: 30,
					host: 'localhost',
					database: 'nestri',
					user: 'postgres',
					password: 'postgres',
					port: 5432
				});
		try {
			const [result] = await sql`SELECT 1`;
			return result ? true : false;
		} finally {
			await sql.end();
		}
	}

	/**
	 * One pool per connection string, kept.
	 *
	 * This used to build a fresh `postgres()` pool on **every call**, and
	 * {@link use} calls it twice per invocation — so a process doing real work
	 * accumulated pools of ten connections each, holding them for the 30 second
	 * idle timeout. In a Worker each request is short-lived and it never showed;
	 * the test suite crossed 100 connections and Postgres answered *"sorry, too
	 * many clients already"* in whichever file happened to run last, which
	 * looked like a flaky test rather than a leak.
	 *
	 * Keyed by URL rather than memoized once, because `Env.init` can point at a
	 * different database within one process and a cached client for the previous
	 * one would silently keep being used.
	 */
	function connect(url: string | undefined) {
		const c = url
			? postgres(url, { idle_timeout: 30, connect_timeout: 30 })
			: postgres({
					idle_timeout: 30,
					connect_timeout: 30,
					host: 'localhost',
					database: 'nestri',
					user: 'postgres',
					password: 'postgres',
					port: 5432
				});
		return drizzle({ client: c });
	}

	// Typed from `connect` rather than from `drizzle` directly: spelling it
	// `ReturnType<typeof drizzle>` widens the schema parameter to its default,
	// which makes `Transaction` and the plain client incompatible halves of
	// `TxOrDb` and breaks every caller.
	type Client = ReturnType<typeof connect>;

	const clients = new Map<string, Client>();

	/**
	 * Whether a pool may outlive the request that opened it.
	 *
	 * On a Worker it may not. An I/O object created while handling one request
	 * cannot be touched while handling another — *"Cannot perform I/O on behalf
	 * of a different request"* — so a kept socket is not a saving there, it is
	 * an error thrown on the second request that reuses it, and the first
	 * request always succeeds. That shape is why it went unnoticed: a single
	 * call works, and a sign-in is two.
	 *
	 * A long-lived process has the opposite problem, which is what the cache
	 * exists for — so the answer is not one rule but this test.
	 */
	const poolsOutliveRequests = !(
		typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
	);

	export function client(): Client {
		const url = Env.get().DATABASE_URL || process.env.DATABASE_URL;
		const key = url ?? 'local:nestri';

		if (!poolsOutliveRequests) {
			return connect(url);
		}

		const cached = clients.get(key);
		if (cached) {
			return cached;
		}

		const db = connect(url);
		clients.set(key, db);
		return db;
	}

	export type Transaction = PgTransaction<
		PostgresJsQueryResultHKT,
		Record<string, never>,
		ExtractTablesWithRelations<Record<string, never>>
	>;

	export type TxOrDb = Transaction | ReturnType<typeof client>;

	const TransactionContext = Context.create<{
		tx: TxOrDb;
		effects: (() => void | Promise<void>)[];
	}>();

	export async function use<T>(callback: (trx: TxOrDb) => Promise<T>) {
		try {
			const { tx } = TransactionContext.use();
			return tx.transaction(callback);
		} catch (err) {
			if (err instanceof Context.NotFound) {
				const effects: (() => void | Promise<void>)[] = [];
				// One client, used for both. These were two separate `client()`
				// calls, so the handle in the context was not the handle the
				// callback ran on — harmless by luck, since neither was a real
				// transaction, and twice the pools either way.
				const db = client();
				const result = await TransactionContext.provide(
					{ effects, tx: db },
					() => callback(db)
				);
				await Promise.all(effects.map((x) => x()));
				return result;
			}
			throw err;
		}
	}

	export async function fn<Input, T>(callback: (input: Input, trx: TxOrDb) => Promise<T>) {
		return (input: Input) => use(async (tx) => callback(input, tx));
	}

	export async function effect(effect: () => any | Promise<any>) {
		try {
			const { effects } = TransactionContext.use();
			effects.push(effect);
		} catch {
			await effect();
		}
	}

	export async function transaction<T>(
		callback: (tx: TxOrDb) => Promise<T>,
		config?: PgTransactionConfig
	) {
		try {
			const { tx } = TransactionContext.use();
			return callback(tx);
		} catch (err) {
			if (err instanceof Context.NotFound) {
				const effects: (() => void | Promise<void>)[] = [];
				const result = await client().transaction(async (tx) => {
					return TransactionContext.provide({ tx, effects }, () => callback(tx));
				}, config);
				await Promise.all(effects.map((x) => x()));
				return result;
			}
			throw err;
		}
	}
}
