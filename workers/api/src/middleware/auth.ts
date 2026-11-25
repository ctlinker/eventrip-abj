import { createMiddleware } from 'hono/factory';
import { getAuth, hasPermission, type Permission } from 'db';
import { maybeBootstrapSuperAdmin } from '../lib/bootstrap';
import type { AppEnv, AuthSession, AuthUser } from '../types';

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
	const auth = getAuth(c.env.DB);
	const result = await auth.api.getSession({
		headers: c.req.raw.headers,
	});

	if (!result || !result.user || !result.session) {
		return c.json({ error: 'Non authentifié' }, 401);
	}

	const user = result.user as unknown as AuthUser;
	if (user.is_active === 0) {
		return c.json({ error: 'Compte désactivé' }, 403);
	}

	const bootstrapEmail = (c.env.BOOTSTRAP_SUPER_ADMIN_EMAIL as string | undefined)
		?.trim()
		.toLowerCase();
	if (bootstrapEmail && user.email.toLowerCase() === bootstrapEmail && user.role !== 'super_admin') {
		const promoted = await maybeBootstrapSuperAdmin(c.env.DB, bootstrapEmail);
		if (promoted) {
			user.role = 'super_admin';
		}
	}

	c.set('user', user);
	c.set('session', result.session as unknown as AuthSession);
	await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
	const user = c.get('user');
	if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
		return c.json({ error: 'Accès réservé aux administrateurs' }, 403);
	}
	await next();
});

export const requireSuperAdmin = createMiddleware<AppEnv>(async (c, next) => {
	const user = c.get('user');
	if (!user || user.role !== 'super_admin') {
		return c.json({ error: 'Accès réservé au super administrateur' }, 403);
	}
	await next();
});

export function requirePermission(permission: Permission) {
	return createMiddleware<AppEnv>(async (c, next) => {
		const user = c.get('user');
		if (!user || !hasPermission(user, permission)) {
			return c.json({ error: `Permission manquante: ${permission}` }, 403);
		}
		await next();
	});
}
