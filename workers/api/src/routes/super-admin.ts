import { Hono } from 'hono';
import { getDB, type Permission, type UserRole } from 'db';
import { tryCatch } from 'utils';
import { requireAuth, requireSuperAdmin } from '../middleware/auth';
import { nowIso, writeAuditLog } from '../lib/utils';
import type { AppEnv } from '../types';

export const superAdminRoutes = new Hono<AppEnv>();

superAdminRoutes.use('*', requireAuth, requireSuperAdmin);

const DEFAULT_MAIL_SETTINGS = {
	id: 'default',
	is_enabled: 1,
	daily_limit: 100,
	monthly_limit: 3000,
	cooldown_minutes: 5,
};

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
	const actionFilter = c.req.query('action')?.trim() || '';
	const entityTypeFilter = c.req.query('entity_type')?.trim() || '';
	const search = c.req.query('q')?.trim().toLowerCase() || '';
	const rawLimit = Number.parseInt(c.req.query('limit') || '100', 10);
	const limit = Number.isFinite(rawLimit) ? Math.min(250, Math.max(1, rawLimit)) : 100;

	let query = db
		.selectFrom('audit_logs')
		.leftJoin('user', 'user.id', 'audit_logs.actor_id')
		.select([
			'audit_logs.id',
			'audit_logs.actor_id',
			'audit_logs.action',
			'audit_logs.entity_type',
			'audit_logs.entity_id',
			'audit_logs.old_state',
			'audit_logs.new_state',
			'audit_logs.metadata',
			'audit_logs.created_at',
			'user.name as actor_name',
			'user.email as actor_email',
			'user.role as actor_role',
		]);

	if (actionFilter) {
		query = query.where('audit_logs.action', '=', actionFilter);
	}
	if (entityTypeFilter) {
		query = query.where('audit_logs.entity_type', '=', entityTypeFilter);
	}
	if (search) {
		const pattern = `%${search}%`;
		query = query.where((eb) =>
			eb.or([
				eb('audit_logs.action', 'like', pattern),
				eb('audit_logs.entity_id', 'like', pattern),
				eb('audit_logs.entity_type', 'like', pattern),
				eb('user.name', 'like', pattern),
				eb('user.email', 'like', pattern),
			]),
		);
	}

	const logs = await query.orderBy('audit_logs.created_at', 'desc').limit(limit).execute();

	return c.json({ logs });
});

superAdminRoutes.get('/mail-quota', async (c) => {
	const now = nowIso();
	const dayStartIso = `${now.slice(0, 10)}T00:00:00.000Z`;
	const monthStartIso = `${now.slice(0, 7)}-01T00:00:00.000Z`;

	const [settingsRes, statsRes, healthRes] = await Promise.all([
		tryCatch(
			c.env.DB.prepare(
				'SELECT id, is_enabled, daily_limit, monthly_limit, cooldown_minutes, updated_by, updated_at FROM mail_settings WHERE id = ? LIMIT 1',
			)
				.bind('default')
				.first<{
					id: string;
					is_enabled: number;
					daily_limit: number;
					monthly_limit: number;
					cooldown_minutes: number;
					updated_by: string | null;
					updated_at: string;
				}>(),
		),
		tryCatch(
			c.env.DB.prepare(
				`SELECT
					SUM(CASE WHEN status = 'sent' AND created_at >= ? THEN 1 ELSE 0 END) AS daily_sent,
					SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS monthly_sent,
					SUM(CASE WHEN status IN ('quota_blocked', 'cooldown_blocked', 'disabled_blocked') AND created_at >= ? THEN 1 ELSE 0 END) AS daily_blocked,
					SUM(CASE WHEN status = 'failed' AND created_at >= ? THEN 1 ELSE 0 END) AS daily_failed
				 FROM mail_logs
				 WHERE created_at >= ?`,
			)
				.bind(dayStartIso, dayStartIso, dayStartIso, monthStartIso)
				.first<{
					daily_sent: number | null;
					monthly_sent: number | null;
					daily_blocked: number | null;
					daily_failed: number | null;
				}>(),
		),
		c.env.MAIL
			? tryCatch(
					c.env.MAIL.fetch(new Request('http://internal/health')).then(
						(r) => r.json() as Promise<{ configured?: boolean; from?: string }>,
					),
				)
			: Promise.resolve({ ok: false as const, error: new Error('No binding') }),
	]);

	const settings =
		settingsRes.ok && settingsRes.data
			? settingsRes.data
			: { ...DEFAULT_MAIL_SETTINGS, updated_by: null, updated_at: now };

	const usage = {
		daily_sent: statsRes.ok ? Number(statsRes.data?.daily_sent ?? 0) : 0,
		monthly_sent: statsRes.ok ? Number(statsRes.data?.monthly_sent ?? 0) : 0,
		daily_blocked: statsRes.ok ? Number(statsRes.data?.daily_blocked ?? 0) : 0,
		daily_failed: statsRes.ok ? Number(statsRes.data?.daily_failed ?? 0) : 0,
	};

	const worker = {
		configured: healthRes.ok ? Boolean(healthRes.data?.configured) : false,
		from: healthRes.ok
			? healthRes.data?.from || 'Eventrip <noreply@eventrip-abj.com>'
			: 'Eventrip <noreply@eventrip-abj.com>',
	};

	return c.json({ settings, usage, worker });
});

superAdminRoutes.patch('/mail-quota', async (c) => {
	const actor = c.get('user');
	const parsedBody = await tryCatch(
		c.req.json<{
			is_enabled?: number | boolean;
			daily_limit?: number;
			monthly_limit?: number;
			cooldown_minutes?: number;
		}>(),
	);

	if (!parsedBody.ok) {
		return c.json({ error: 'Corps de requête invalide' }, 400);
	}

	const body = parsedBody.data;
	const existingRes = await tryCatch(
		c.env.DB.prepare(
			'SELECT is_enabled, daily_limit, monthly_limit, cooldown_minutes FROM mail_settings WHERE id = ? LIMIT 1',
		)
			.bind('default')
			.first<{
				is_enabled: number;
				daily_limit: number;
				monthly_limit: number;
				cooldown_minutes: number;
			}>(),
	);

	const previous =
		existingRes.ok && existingRes.data
			? existingRes.data
			: {
					is_enabled: DEFAULT_MAIL_SETTINGS.is_enabled,
					daily_limit: DEFAULT_MAIL_SETTINGS.daily_limit,
					monthly_limit: DEFAULT_MAIL_SETTINGS.monthly_limit,
					cooldown_minutes: DEFAULT_MAIL_SETTINGS.cooldown_minutes,
				};

	const nextEnabled =
		body.is_enabled !== undefined ? (body.is_enabled ? 1 : 0) : previous.is_enabled;
	const nextDaily =
		body.daily_limit !== undefined ? Math.trunc(Number(body.daily_limit)) : previous.daily_limit;
	const nextMonthly =
		body.monthly_limit !== undefined
			? Math.trunc(Number(body.monthly_limit))
			: previous.monthly_limit;
	const nextCooldown =
		body.cooldown_minutes !== undefined
			? Math.trunc(Number(body.cooldown_minutes))
			: previous.cooldown_minutes;

	if (!Number.isFinite(nextDaily) || nextDaily < 0 || nextDaily > 1_000_000) {
		return c.json({ error: 'Quota journalier invalide (0 à 1 000 000).' }, 400);
	}
	if (!Number.isFinite(nextMonthly) || nextMonthly < 0 || nextMonthly > 10_000_000) {
		return c.json({ error: 'Quota mensuel invalide (0 à 10 000 000).' }, 400);
	}
	if (nextMonthly > 0 && nextDaily > nextMonthly) {
		return c.json({ error: 'Le quota journalier ne peut pas dépasser le quota mensuel.' }, 400);
	}
	if (!Number.isFinite(nextCooldown) || nextCooldown < 0 || nextCooldown > 1440) {
		return c.json({ error: 'Le délai anti-spam doit être compris entre 0 et 1440 minutes.' }, 400);
	}

	const updatedAt = nowIso();
	const upsertRes = await tryCatch(
		c.env.DB.prepare(
			`INSERT INTO mail_settings (id, is_enabled, daily_limit, monthly_limit, cooldown_minutes, updated_by, updated_at)
			 VALUES ('default', ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
				is_enabled = excluded.is_enabled,
				daily_limit = excluded.daily_limit,
				monthly_limit = excluded.monthly_limit,
				cooldown_minutes = excluded.cooldown_minutes,
				updated_by = excluded.updated_by,
				updated_at = excluded.updated_at`,
		)
			.bind(nextEnabled, nextDaily, nextMonthly, nextCooldown, actor.id, updatedAt)
			.run(),
	);

	if (!upsertRes.ok) {
		return c.json({ error: 'Erreur lors de la mise à jour des quotas mail.' }, 500);
	}

	const nextState = {
		is_enabled: nextEnabled,
		daily_limit: nextDaily,
		monthly_limit: nextMonthly,
		cooldown_minutes: nextCooldown,
	};

	await writeAuditLog(getDB(c.env.DB), {
		actorId: actor.id,
		action: 'admin.mail_quota_update',
		entityType: 'mail_settings',
		entityId: 'default',
		oldState: previous,
		newState: nextState,
	});

	return c.json({
		settings: {
			id: 'default',
			...nextState,
			updated_by: actor.id,
			updated_at: updatedAt,
		},
	});
});

superAdminRoutes.get('/mail-logs', async (c) => {
	const statusFilter = c.req.query('status')?.trim() || '';
	const rawLimit = Number.parseInt(c.req.query('limit') || '50', 10);
	const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50;

	const sql = statusFilter
		? `SELECT id, recipient, subject, template, status, provider_id, error_message, created_at
		   FROM mail_logs
		   WHERE status = ?
		   ORDER BY created_at DESC
		   LIMIT ?`
		: `SELECT id, recipient, subject, template, status, provider_id, error_message, created_at
		   FROM mail_logs
		   ORDER BY created_at DESC
		   LIMIT ?`;

	const res = await tryCatch(
		statusFilter
			? c.env.DB.prepare(sql).bind(statusFilter, limit).all()
			: c.env.DB.prepare(sql).bind(limit).all(),
	);

	return c.json({
		logs: res.ok ? res.data.results : [],
	});
});
