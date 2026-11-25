import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAuth, getDB } from 'db';
import { requireAuth } from './middleware/auth';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

app.use(
	'/api/*',
	cors({
		origin: (origin) => origin || '*',
		allowHeaders: ['Content-Type', 'Authorization'],
		allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		credentials: true,
	}),
);

app.get('/api/health', (c) => {
	return c.json({ ok: true, service: 'eventrip-api' });
});

app.all('/api/auth/*', (c) => {
	const auth = getAuth(c.env.DB);
	return auth.handler(c.req.raw);
});

app.get('/api/me', requireAuth, (c) => {
	return c.json({ user: c.get('user') });
});

export default {
	fetch: app.fetch,
	async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		// TODO (Jalon 2): Expiration automatique des commandes en pending_payment > 2h
		getDB(env.DB);
	},
} satisfies ExportedHandler<Env>;
