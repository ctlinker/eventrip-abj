import type { Database } from 'db';

export function nowIso(): string {
	return new Date().toISOString();
}

export function addHoursIso(iso: string, hours: number): string {
	const d = new Date(iso);
	d.setTime(d.getTime() + hours * 60 * 60 * 1000);
	return d.toISOString();
}

export function generateOrderReference(): string {
	const d = new Date();
	const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
	const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
	return `EVT-${ymd}-${rand}`;
}

export function generateTicketCode(): string {
	const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
	return `TKT-${rand}`;
}

export function slugify(input: string): string {
	return input
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

export function buildWavePaymentUrl(
	eventWaveUrlOrMerchantId: string | null | undefined,
	amountXof: number,
	fallbackMerchantId?: string,
): string | null {
	const raw = eventWaveUrlOrMerchantId?.trim() || fallbackMerchantId?.trim();
	if (!raw) return null;

	let base = raw;
	if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
		base = `https://pay.wave.com/m/${encodeURIComponent(raw)}/c/ci`;
	}

	const url = new URL(base);
	url.searchParams.set('amount', String(amountXof));
	return url.toString();
}

export async function writeAuditLog(
	db: Database,
	params: {
		actorId?: string | null;
		action: string;
		entityType: string;
		entityId: string;
		oldState?: unknown;
		newState?: unknown;
		metadata?: unknown;
	},
): Promise<void> {
	await db
		.insertInto('audit_logs')
		.values({
			id: crypto.randomUUID(),
			actor_id: params.actorId ?? null,
			action: params.action,
			entity_type: params.entityType,
			entity_id: params.entityId,
			old_state: params.oldState !== undefined ? JSON.stringify(params.oldState) : null,
			new_state: params.newState !== undefined ? JSON.stringify(params.newState) : null,
			metadata: params.metadata !== undefined ? JSON.stringify(params.metadata) : null,
			created_at: nowIso(),
		})
		.execute();
}

export async function createNotification(
	db: Database,
	params: {
		userId: string;
		type: string;
		title: string;
		body: string;
		link?: string | null;
	},
): Promise<void> {
	await db
		.insertInto('notifications')
		.values({
			id: crypto.randomUUID(),
			user_id: params.userId,
			type: params.type,
			title: params.title,
			body: params.body,
			link: params.link ?? null,
			is_read: 0,
			created_at: nowIso(),
		})
		.execute();
}
