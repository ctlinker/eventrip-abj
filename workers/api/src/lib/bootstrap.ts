import { getDB } from 'db';
import { tryCatch } from 'utils';
import { nowIso, writeAuditLog } from './utils';

export async function maybeBootstrapSuperAdmin(
	d1: D1Database,
	bootstrapEmail: string | undefined,
): Promise<boolean> {
	const email = bootstrapEmail?.trim().toLowerCase();
	if (!email) return false;

	const existing = await tryCatch(
		d1.prepare("SELECT id FROM user WHERE role = 'super_admin' LIMIT 1").first<{ id: string }>(),
	);
	if (!existing.ok || existing.data) {
		return false;
	}

	const now = nowIso();
	const res = await tryCatch(
		d1
			.prepare(
				"UPDATE user SET role = 'super_admin', updatedAt = ? WHERE lower(email) = ? AND NOT EXISTS (SELECT 1 FROM user WHERE role = 'super_admin') RETURNING id",
			)
			.bind(now, email)
			.first<{ id: string }>(),
	);

	if (!res.ok || !res.data) {
		return false;
	}

	await tryCatch(
		writeAuditLog(getDB(d1), {
			actorId: res.data.id,
			action: 'super_admin.bootstrap',
			entityType: 'user',
			entityId: res.data.id,
			newState: { role: 'super_admin', email },
		}),
	);

	return true;
}
