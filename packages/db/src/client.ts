import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import type { DB } from './generated_types.ts';

export type Database = Kysely<DB>;

let cachedDB: Kysely<DB>;
let lastD1Binding: D1Database | undefined;

export function initDB(DB: D1Database): void {
	if (!cachedDB || lastD1Binding !== DB) {
		lastD1Binding = DB;
		cachedDB = new Kysely<DB>({
			dialect: new D1Dialect({ database: DB }),
		});
	}
}

export function getDB(DB?: D1Database): typeof cachedDB {
	if (DB) {
		initDB(DB);
	}

	if (!cachedDB) {
		throw new Error('Database not initialized. Call initDB(env) first.');
	}

	return cachedDB;
}
