import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateVAPIDKeys } from 'web-push';

const args = new Set(process.argv.slice(2));
const force = args.has('--force');
const pushProd = args.has('--prod');

const cwd = process.cwd();
const devVarsPath = join(cwd, '.dev.vars');

function parseEnvFile(content: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) continue;
		const idx = line.indexOf('=');
		if (idx <= 0) continue;
		out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
	}
	return out;
}

const existing = existsSync(devVarsPath) ? parseEnvFile(readFileSync(devVarsPath, 'utf8')) : {};
const hasKeys = Boolean(existing.VAPID_PUBLIC_KEY && existing.VAPID_PRIVATE_KEY);

let publicKey = existing.VAPID_PUBLIC_KEY;
let privateKey = existing.VAPID_PRIVATE_KEY;
const subject = existing.VAPID_SUBJECT || 'mailto:contact@eventrip.ci';

if (!hasKeys || force) {
	const generated = generateVAPIDKeys();
	publicKey = generated.publicKey;
	privateKey = generated.privateKey;

	const merged: Record<string, string> = {
		...existing,
		VAPID_PUBLIC_KEY: publicKey,
		VAPID_PRIVATE_KEY: privateKey,
		VAPID_SUBJECT: subject,
	};

	const serialized = `${Object.entries(merged)
		.map(([k, v]) => `${k}=${v}`)
		.join('\n')}\n`;
	writeFileSync(devVarsPath, serialized, 'utf8');
	console.log(`✓ Clés VAPID générées et enregistrées dans ${devVarsPath}`);
} else {
	console.log(`• Clés VAPID déjà présentes dans ${devVarsPath} (utilisez --force pour régénérer)`);
}

if (pushProd) {
	const secrets: Array<[string, string]> = [
		['VAPID_PUBLIC_KEY', publicKey],
		['VAPID_PRIVATE_KEY', privateKey],
		['VAPID_SUBJECT', subject],
	];

	for (const [name, value] of secrets) {
		const res = spawnSync('bunx', ['wrangler', 'secret', 'put', name], {
			cwd,
			input: `${value}\n`,
			stdio: ['pipe', 'inherit', 'inherit'],
			encoding: 'utf8',
		});
		if (res.status !== 0) {
			console.error(`✗ Échec lors de l'envoi du secret ${name}`);
			process.exit(res.status ?? 1);
		}
	}
	console.log('✓ Secrets VAPID déployés sur Cloudflare Workers');
} else {
	console.log('• Pour pousser ces secrets en production : bun run --cwd workers/web-push setup -- --prod');
}
