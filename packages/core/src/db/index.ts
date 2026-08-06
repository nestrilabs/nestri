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

	export function client() {
		const url = Env.get().DATABASE_URL || process.env.DATABASE_URL;
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
				const result = await TransactionContext.provide(
					{
						effects,
						tx: client()
					},
					() => callback(client())
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
