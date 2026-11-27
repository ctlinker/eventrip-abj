import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import migration001 from '../../../packages/db/migrations/001_better-auth.sql?raw';
import migration010 from '../../../packages/db/migrations/010_mail_quota_and_logs.sql?raw';

async function applySql(sql: string) {
	const cleaned = sql
		.split('\n')
		.filter((line) => !line.trim().startsWith('--'))
		.join('\n');
	const statements = cleaned
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean);
	for (const stmt of statements) {
		await env.DB.prepare(stmt).run();
	}
}

describe('Mail worker quotas & safeguards', () => {
	beforeAll(async () => {
		await applySql(migration001);
		await applySql(migration010);
	});

	it('reports service health and sender address', async () => {
		const res = await SELF.fetch('http://internal/health');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; service: string; from: string };
		expect(body.ok).toBe(true);
		expect(body.service).toBe('eventrip-mail');
		expect(body.from).toContain('noreply@eventrip-abj.com');
	});

	it('enforces kill-switch, per-recipient cooldown, and daily quota in D1', async () => {
		// 1. Kill-switch désactivé
		await env.DB.prepare('UPDATE mail_settings SET is_enabled = 0 WHERE id = ?')
			.bind('default')
			.run();

		const disabledRes = await SELF.fetch('http://internal/send', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				to: 'user1@eventrip-abj.com',
				subject: 'Test',
				html: '<p>Test</p>',
				template: 'password_reset',
			}),
		});
		expect(disabledRes.status).toBe(503);
		const disabledBody = (await disabledRes.json()) as { code: string };
		expect(disabledBody.code).toBe('MAIL_DISABLED');

		// 2. Réactiver avec plafond journalier = 1 et cooldown = 5 min
		await env.DB.prepare(
			'UPDATE mail_settings SET is_enabled = 1, daily_limit = 1, monthly_limit = 3000, cooldown_minutes = 5 WHERE id = ?',
		)
			.bind('default')
			.run();

		// Simuler un envoi réussi récent vers user1@eventrip-abj.com
		const nowIso = new Date().toISOString();
		await env.DB.prepare(
			`INSERT INTO mail_logs (id, recipient, subject, template, status, provider_id, created_at)
			 VALUES (?, ?, ?, ?, 'sent', 're_mock_1', ?)`,
		)
			.bind(crypto.randomUUID(), 'user1@eventrip-abj.com', 'Reset', 'password_reset', nowIso)
			.run();

		// Même destinataire dans la fenêtre de 5 min -> bloqué par cooldown (429 MAIL_COOLDOWN)
		const cooldownRes = await SELF.fetch('http://internal/send', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				to: 'user1@eventrip-abj.com',
				subject: 'Reset 2',
				html: '<p>Reset</p>',
				template: 'password_reset',
			}),
		});
		expect(cooldownRes.status).toBe(429);
		const cooldownBody = (await cooldownRes.json()) as { code: string };
		expect(cooldownBody.code).toBe('MAIL_COOLDOWN');

		// Autre destinataire mais daily_limit = 1 déjà consommé -> bloqué par quota (429 MAIL_QUOTA_EXCEEDED)
		const quotaRes = await SELF.fetch('http://internal/send', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				to: 'user2@eventrip-abj.com',
				subject: 'Reset User 2',
				html: '<p>Reset</p>',
				template: 'password_reset',
			}),
		});
		expect(quotaRes.status).toBe(429);
		const quotaBody = (await quotaRes.json()) as { code: string };
		expect(quotaBody.code).toBe('MAIL_QUOTA_EXCEEDED');

		// Vérifier la journalisation des blocages
		const logs = await env.DB.prepare(
			'SELECT status FROM mail_logs ORDER BY created_at ASC',
		).all<{ status: string }>();
		const statuses = logs.results.map((r) => r.status);
		expect(statuses).toContain('disabled_blocked');
		expect(statuses).toContain('cooldown_blocked');
		expect(statuses).toContain('quota_blocked');
	});
});
