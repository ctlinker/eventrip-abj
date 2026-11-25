import { Hono } from 'hono';
import { getDB, type Permission, type UserRole } from 'db';
import { tryCatch } from 'utils';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import { nowIso, writeAuditLog } from '../lib/utils';
import type { AppEnv } from '../types';

export const superAdminRoutes = new Hono<AppEnv>();

superAdminRoutes.use('*', requireAuth, requireSuperAdmin);

superAdminRoutes.get('/users', async (c) => {
	const db = getDB(c.env.DB);
	const users = await db
		.selectFrom('user')
		.select(['id', 'name', 'email', 'phone', 'role', 'permissions', 'is_active', 'createdAt'])
		.orderBy('createdAt', 'desc')
		.execute();

	return c.json({ users });
});

superAdminRoutes.patch('/users/:id', async (c) => {
	const actor = c.get('user');
	const targetId = c.req.param('id');
	const parsedBody = await tryCatch(
		c.req.json<{ role?: UserRole; permissions?: Permission[]; is_active?: number }>(),
	);
	const body = parsedBody.ok ? parsedBody.data : {};

	const db = getDB(c.env.DB);
	const target = await db
		.selectFrom('user')
		.select(['id', 'role', 'permissions', 'is_active'])
		.where('id', '=', targetId)
		.executeTakeFirst();

	if (!target) {
		return c.json({ error: 'Utilisateur introuvable' }, 404);
	}

	const updates: { role?: string; permissions?: string; is_active?: number; updatedAt: string } = {
		updatedAt: nowIso(),
	};
	if (body.role) updates.role = body.role;
	if (Array.isArray(body.permissions)) updates.permissions = JSON.stringify(body.permissions);
	if (body.is_active === 0 || body.is_active === 1) updates.is_active = body.is_active;

	await db.updateTable('user').set(updates).where('id', '=', targetId).execute();

	await writeAuditLog(db, {
		actorId: actor.id,
		action: 'admin.permissions_update',
		entityType: 'user',
		entityId: targetId,
		oldState: {
			role: target.role,
			permissions: target.permissions,
			is_active: target.is_active,
		},
		newState: updates,
	});

	const updated = await db
		.selectFrom('user')
		.select(['id', 'name', 'email', 'phone', 'role', 'permissions', 'is_active'])
		.where('id', '=', targetId)
		.executeTakeFirst();

	return c.json({ user: updated });
});

superAdminRoutes.get('/audit-logs', async (c) => {
	const db = getDB(c.env.DB);
	const logs = await db
		.selectFrom('audit_logs')
		.selectAll()
		.orderBy('created_at', 'desc')
		.limit(100)
		.execute();

	return c.json({ logs });
});
