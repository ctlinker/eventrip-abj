import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('Eventrip API worker', () => {
	it('responds on /api/health', async () => {
		const response = await SELF.fetch('https://example.com/api/health');
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, service: 'eventrip-api' });
	});
});
