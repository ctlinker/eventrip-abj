import { betterAuth } from 'better-auth';
import { rawBetterAuthConfig } from './src/auth';
import BetterSqlite3 from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const Database = (BetterSqlite3 as any).default ?? BetterSqlite3;

const db = new Database(':memory:');

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

for (const migration of readdirSync(migrationsDir)
	.filter((file) => file.endsWith('.sql'))
	.sort()) {
	const content = readFileSync(join(migrationsDir, migration), 'utf8');
	db.exec(content);
}

export { db };

export const auth = betterAuth({
	...rawBetterAuthConfig,
	database: db,
});
