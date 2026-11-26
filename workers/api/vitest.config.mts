import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

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
				},
			},
		}),
	],
});
