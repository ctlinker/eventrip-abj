import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAuth, getDB } from 'db';
import { tryCatch } from 'utils';
import { maybeBootstrapSuperAdmin } from './lib/bootstrap';
import { writeAuditLog } from './lib/utils';
import { requireAuth } from './middleware/auth';
import { publicRoutes } from './routes/public';
import { clientRoutes } from './routes/client';
import { adminRoutes } from './routes/admin';
import { superAdminRoutes } from './routes/super-admin';
import {
	buildPasswordResetEmail,
	buildPasswordResetLink,
	sendMailViaBinding,
} from './services/mail';
import { flushNotificationOutbox } from './services/notifications';
import { expirePendingOrders, sendExpiringOrderReminders } from './services/orders';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

// Ne jamais envelopper une réponse 101 WebSocket avec le middleware CORS (Hono recréerait Response sans .webSocket)
app.get('/api/realtime/ws', requireAuth, async (c) => {
	const user = c.get('user');
	if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
		return c.json({ error: 'Upgrade WebSocket requis' }, 426);
	}
	if (!c.env.WEB_PUSH) {
		return c.json({ error: 'Service temps réel indisponible' }, 503);
	}

	const wsReq = new Request(
		`http://internal/ws?userId=${encodeURIComponent(user.id)}`,
		c.req.raw,
	);
	return c.env.WEB_PUSH.fetch(wsReq);
});

const corsMiddleware = cors({
	origin: (origin) => origin || '*',
	allowHeaders: ['Content-Type', 'Authorization'],
	allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
	credentials: true,
});

app.use('/api/*', async (c, next) => {
	if (c.req.header('Upgrade')?.toLowerCase() === 'websocket') {
		return next();
	}
	return corsMiddleware(c, next);
});

app.get('/api/health', (c) => {
	return c.json({ ok: true, service: 'eventrip-api' });
});

app.all('/api/auth/*', async (c) => {
	if (c.req.method === 'POST' && c.req.path === '/api/auth/sign-up/email') {
		const bodyRes = await tryCatch(
			c.req.raw.clone().json() as Promise<{ phone?: string; email?: string }>,
		);
		const phone = bodyRes.ok ? bodyRes.data?.phone?.trim() : '';
		if (phone) {
			const dupRes = await tryCatch(
				c.env.DB.prepare('SELECT id FROM "user" WHERE phone = ? LIMIT 1')
					.bind(phone)
					.first<{ id: string }>(),
			);
			if (dupRes.ok && dupRes.data) {
				const msg = 'Ce numéro de téléphone est déjà associé à un autre compte.';
				return c.json({ error: msg, message: msg, code: 'PHONE_ALREADY_EXISTS' }, 409);
			}
		}
	}

	const auth = getAuth(c.env.DB, {
		async sendResetPasswordEmail({ user, url, token, request }) {
			const resetLink = buildPasswordResetLink(url, token, request ?? c.req.raw);
			const mailContent = buildPasswordResetEmail({
				name: user.name,
				resetLink,
			});
			await sendMailViaBinding(c.env, {
				to: user.email,
				subject: mailContent.subject,
				html: mailContent.html,
				text: mailContent.text,
				template: 'password_reset',
			});
		},
		async onPasswordResetAudit({ user }) {
			await tryCatch(
				writeAuditLog(getDB(c.env.DB), {
					actorId: user.id,
					action: 'auth.password_reset',
					entityType: 'user',
					entityId: user.id,
					metadata: { method: 'email_token' },
				}),
			);
		},
	});

	let changePasswordActorId: string | null = null;
	if (c.req.method === 'POST' && c.req.path === '/api/auth/change-password') {
		const preSession = await tryCatch(
			auth.api.getSession({ headers: c.req.raw.headers }),
		);
		if (preSession.ok && preSession.data?.user?.id) {
			changePasswordActorId = preSession.data.user.id;
		}
	}

	const res = await auth.handler(c.req.raw);

	if (res.ok && changePasswordActorId) {
		await tryCatch(
			writeAuditLog(getDB(c.env.DB), {
				actorId: changePasswordActorId,
				action: 'auth.password_change',
				entityType: 'user',
				entityId: changePasswordActorId,
				metadata: { method: 'authenticated_session' },
			}),
		);
	}

	if (
		res.ok &&
		c.env.BOOTSTRAP_SUPER_ADMIN_EMAIL &&
		(c.req.path.includes('/sign-in') || c.req.path.includes('/sign-up'))
	) {
		await maybeBootstrapSuperAdmin(c.env.DB, c.env.BOOTSTRAP_SUPER_ADMIN_EMAIL);
	}
	return res;
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
		ctx.waitUntil(
			(async () => {
				await sendExpiringOrderReminders(env);
				await expirePendingOrders(env.DB, env);
				await flushNotificationOutbox(env);
			})(),
		);
	},
} satisfies ExportedHandler<Env>;
