import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			miniflare: {
				bindings: {
					RESEND_API_KEY: '',
					MAIL_FROM: 'Eventrip <noreply@eventrip-abj.com>',
				},
			},
		}),
	],
});
