import Database from 'better-sqlite3';
import { readdirSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const migrationsDir = './migrations';
const tempDir = './.tmp';
const dbPath = join(tempDir, 'codegen.sqlite');

mkdirSync(tempDir, { recursive: true });
rmSync(dbPath, { force: true });

const db = new Database(dbPath);

try {
	const migrations = readdirSync(migrationsDir)
		.filter((name) => name.endsWith('.sql'))
		.sort();

	for (const migration of migrations) {
		db.exec(readFileSync(join(migrationsDir, migration), 'utf8'));
	}
} finally {
	db.close();
}

const result = spawnSync('bunx', ['kysely-codegen', '--out-file', './src/generated_types.ts'], {
	stdio: 'inherit',
	env: {
		...process.env,
		DATABASE_URL: dbPath,
	},
});

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
