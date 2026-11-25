import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAuth } from 'db';
import { requireAuth } from './middleware/auth';
import { publicRoutes } from './routes/public';
import { clientRoutes } from './routes/client';
import { adminRoutes } from './routes/admin';
import { superAdminRoutes } from './routes/super-admin';
import { expirePendingOrders } from './services/orders';
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

app.route('/api', publicRoutes);
app.route('/api', clientRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/super-admin', superAdminRoutes);

export default {
	fetch: app.fetch,
	async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(expirePendingOrders(env.DB));
	},
} satisfies ExportedHandler<Env>;
