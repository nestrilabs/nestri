import { db } from ".";
import {
  PgTransaction,
  type PgTransactionConfig
} from "drizzle-orm/pg-core";
import type {
  PostgresJsQueryResultHKT
} from "drizzle-orm/postgres-js";
import { createContext } from "../context";
import type { ExtractTablesWithRelations } from "drizzle-orm";

export type Transaction = PgTransaction<
  PostgresJsQueryResultHKT,
  Record<string, never>,
  ExtractTablesWithRelations<Record<string, never>>
>;

type TxOrDb = Transaction | typeof db;

const TransactionContext = createContext<{
  tx: Transaction;
  effects: (() => void | Promise<void>)[];
}>();

export async function useTransaction<T>(callback: (trx: TxOrDb) => Promise<T>) {
  try {
    const { tx } = TransactionContext.use();
    return callback(tx);
  } catch {
    return callback(db);
  }
}

export async function afterTx(effect: () => any | Promise<any>) {
  try {
    const { effects } = TransactionContext.use();
    effects.push(effect);
  } catch {
    await effect();
  }
}

export async function createTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
  isolationLevel?: PgTransactionConfig["isolationLevel"],
): Promise<T> {
  try {
    const { tx } = TransactionContext.use();
    return callback(tx);
  } catch {
    const effects: (() => void | Promise<void>)[] = [];
    const result = await db.transaction(
      async (tx) => {
        return TransactionContext.provide({ tx, effects }, () => callback(tx));
      },
      {
        isolationLevel: isolationLevel || "read committed",
      },
    );
    await Promise.all(effects.map((x) => x()));
    return result as T;
  }
}