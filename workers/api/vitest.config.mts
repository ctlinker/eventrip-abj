import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

let lastTestMail: Record<string, unknown> | null = null;

export default defineConfig({
	test: {
		testTimeout: 15000,
	},
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				serviceBindings: {
					WEB_PUSH: async (request: Request) => {
						const url = new URL(request.url);
						if (url.pathname === '/vapid-key') {
							return Response.json({ publicKey: 'test-vapid-public-key', enabled: true });
						}
						if (url.pathname === '/publish') {
							return Response.json({ ok: true, delivered: 0 });
						}
						return Response.json({ ok: true });
					},
					MAIL: async (request: Request) => {
						const url = new URL(request.url);
						if (url.pathname === '/health') {
							return Response.json({
								ok: true,
								service: 'eventrip-mail',
								configured: true,
								from: 'Eventrip <noreply@eventrip-abj.com>',
							});
						}
						if (url.pathname === '/last-test-mail') {
							return Response.json({ mail: lastTestMail });
						}
						if (url.pathname === '/send') {
							const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
							lastTestMail = body;
							return Response.json({
								ok: true,
								id: 'test-mail-log-id',
								providerId: 're_test_123',
							});
						}
						return Response.json({ ok: true });
					},
				},
			},
		}),
	],
});
