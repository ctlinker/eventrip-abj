import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = './migrations';

const existing = readdirSync(migrationsDir)
	.map((name) => name.match(/^(\d+)_.*\.sql$/))
	.filter((match) => match !== null)
	.map((match) => Number(match[1]));

const next = Math.max(0, ...existing) + 1;
const output = join(migrationsDir, `${String(next).padStart(3, '0')}_better-auth.sql`);

const proc = Bun.spawnSync(['bunx', '@better-auth/cli', 'generate', '--yes', '--config', './better-auth.schema.ts', '--output', output], {
	stdout: 'pipe',
	stderr: 'inherit',
});

if (proc.exitCode !== 0) {
	process.exit(proc.exitCode ?? 1);
}

if (/Your schema is already up to date/.exec(proc.stdout.toString())) {
	console.log('Nothing to do');
} else {
	console.log(`Generated ${output}`);
}
