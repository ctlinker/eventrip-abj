import type { getDB } from 'db';

type Database = ReturnType<typeof getDB>;

export type RevisionSeverity = 'minor' | 'important' | 'critical';

export interface FieldDiff {
	field: string;
	label: string;
	before: unknown;
	after: unknown;
}

export interface PurchaseSnapshot {
	event_id: string;
	event_title: string;
	event_starts_at: string;
	event_venue: string;
	event_version: number;
	convoy_id: string | null;
	convoy_name: string | null;
	convoy_commune: string | null;
	convoy_departure_at: string | null;
	convoy_meeting_point: string | null;
	convoy_version: number | null;
	unit_price_xof: number;
	purchased_at: string;
}

const SEVERITY_RANK: Record<RevisionSeverity, number> = {
	minor: 0,
	important: 1,
	critical: 2,
};

export function resolveSeverity(
	minSeverity: RevisionSeverity,
	requested?: string | null,
): RevisionSeverity {
	if (requested === 'minor' || requested === 'important' || requested === 'critical') {
		return SEVERITY_RANK[requested] >= SEVERITY_RANK[minSeverity] ? requested : minSeverity;
	}
	return minSeverity;
}

export function buildEventSnapshot(ev: {
	title: string;
	description: string;
	starts_at: string;
	ends_at: string | null;
	venue: string;
	price_xof: number;
	category_id: string | null;
	extra_info: string | null;
	wave_payment_url: string | null;
	status: string;
}): string {
	return JSON.stringify({
		title: ev.title,
		description: ev.description,
		starts_at: ev.starts_at,
		ends_at: ev.ends_at,
		venue: ev.venue,
		price_xof: ev.price_xof,
		category_id: ev.category_id,
		extra_info: ev.extra_info,
		wave_payment_url: ev.wave_payment_url,
		status: ev.status,
	});
}

export function buildConvoySnapshot(cv: {
	name: string;
	commune: string;
	departure_at: string;
	meeting_point: string;
	destination: string;
	trip_type: string;
	price_xof: number;
	capacity: number;
	extra_info: string | null;
	status: string;
}): string {
	return JSON.stringify({
		name: cv.name,
		commune: cv.commune,
		departure_at: cv.departure_at,
		meeting_point: cv.meeting_point,
		destination: cv.destination,
		trip_type: cv.trip_type,
		price_xof: cv.price_xof,
		capacity: cv.capacity,
		extra_info: cv.extra_info,
		status: cv.status,
	});
}

const EVENT_FIELD_META: Record<string, { label: string; severity: RevisionSeverity }> = {
	title: { label: 'Titre', severity: 'minor' },
	description: { label: 'Description', severity: 'minor' },
	starts_at: { label: 'Date de l’événement', severity: 'critical' },
	ends_at: { label: 'Date de fin', severity: 'minor' },
	venue: { label: 'Lieu', severity: 'important' },
	price_xof: { label: 'Prix (FCFA)', severity: 'minor' },
	category_id: { label: 'Catégorie', severity: 'minor' },
	extra_info: { label: 'Informations complémentaires', severity: 'minor' },
	wave_payment_url: { label: 'Lien Wave', severity: 'minor' },
	sales_start_at: { label: 'Début des ventes', severity: 'minor' },
	sales_end_at: { label: 'Fin des ventes', severity: 'minor' },
	status: { label: 'Statut', severity: 'minor' },
};

const CONVOY_FIELD_META: Record<string, { label: string; severity: RevisionSeverity }> = {
	name: { label: 'Nom du convoi', severity: 'minor' },
	commune: { label: 'Commune', severity: 'important' },
	departure_at: { label: 'Heure de départ', severity: 'important' },
	meeting_point: { label: 'Point de rassemblement', severity: 'important' },
	destination: { label: 'Destination', severity: 'important' },
	capacity: { label: 'Capacité', severity: 'minor' },
	extra_info: { label: 'Infos convoi', severity: 'minor' },
	status: { label: 'Statut convoi', severity: 'minor' },
};

function valuesDiffer(a: unknown, b: unknown): boolean {
	return (a ?? null) !== (b ?? null);
}

export function computeEventDiff(
	current: Record<string, unknown>,
	incoming: Record<string, unknown>,
): { diffs: FieldDiff[]; minSeverity: RevisionSeverity } {
	const diffs: FieldDiff[] = [];
	let minSeverity: RevisionSeverity = 'minor';

	for (const [field, meta] of Object.entries(EVENT_FIELD_META)) {
		if (!(field in incoming)) continue;
		const before = current[field] ?? null;
		const after = incoming[field] ?? null;
		if (!valuesDiffer(before, after)) continue;

		diffs.push({ field, label: meta.label, before, after });

		let sev = meta.severity;
		if (field === 'status' && (after === 'cancelled' || (before === 'published' && after === 'archived'))) {
			sev = 'critical';
		}
		if (SEVERITY_RANK[sev] > SEVERITY_RANK[minSeverity]) {
			minSeverity = sev;
		}
	}

	return { diffs, minSeverity };
}

export function computeConvoyDiff(
	current: Record<string, unknown>,
	incoming: Record<string, unknown>,
): { diffs: FieldDiff[]; minSeverity: RevisionSeverity } {
	const diffs: FieldDiff[] = [];
	let minSeverity: RevisionSeverity = 'minor';

	for (const [field, meta] of Object.entries(CONVOY_FIELD_META)) {
		if (!(field in incoming)) continue;
		const before = current[field] ?? null;
		const after = incoming[field] ?? null;
		if (!valuesDiffer(before, after)) continue;

		diffs.push({ field, label: meta.label, before, after });

		let sev = meta.severity;
		if (field === 'status' && (after === 'cancelled' || after === 'archived')) {
			sev = 'critical';
		}
		if (SEVERITY_RANK[sev] > SEVERITY_RANK[minSeverity]) {
			minSeverity = sev;
		}
	}

	return { diffs, minSeverity };
}

export function formatDiffValue(field: string, value: unknown): string {
	if (value === null || value === undefined || value === '') return '—';
	if (field === 'starts_at' || field === 'ends_at' || field === 'departure_at') {
		const d = new Date(String(value));
		if (!Number.isNaN(d.getTime())) {
			return d.toLocaleString('fr-FR', {
				day: '2-digit',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'Africa/Abidjan',
			});
		}
	}
	if (field === 'price_xof') {
		return `${Number(value).toLocaleString('fr-FR')} FCFA`;
	}
	return String(value);
}

export function formatDiffSummary(diffs: FieldDiff[]): string {
	return diffs
		.slice(0, 3)
		.map((d) => `${d.label} : ${formatDiffValue(d.field, d.before)} → ${formatDiffValue(d.field, d.after)}`)
		.join(' · ');
}

export async function getEventOrderStats(
	db: Database,
	eventId: string,
): Promise<{
	priceLocked: boolean;
	activeOrdersCount: number;
	affectedHoldersCount: number;
	affectedTicketsCount: number;
}> {
	const rows = await db
		.selectFrom('tickets as t')
		.innerJoin('orders as o', 'o.id', 't.order_id')
		.select(['t.id as ticket_id', 't.user_id', 't.status as ticket_status', 'o.id as order_id', 'o.status as order_status'])
		.where('t.event_id', '=', eventId)
		.where('o.status', 'in', ['pending_payment', 'under_review', 'confirmed'])
		.execute();

	const orderIds = new Set<string>();
	const holderIds = new Set<string>();
	let affectedTicketsCount = 0;

	for (const r of rows) {
		orderIds.add(r.order_id);
		if (r.ticket_status === 'valid' || r.ticket_status === 'pending') {
			holderIds.add(r.user_id);
			affectedTicketsCount += 1;
		}
	}

	return {
		priceLocked: orderIds.size > 0,
		activeOrdersCount: orderIds.size,
		affectedHoldersCount: holderIds.size,
		affectedTicketsCount,
	};
}

export async function getAffectedUserIdsForEvent(db: Database, eventId: string): Promise<string[]> {
	const rows = await db
		.selectFrom('tickets as t')
		.innerJoin('orders as o', 'o.id', 't.order_id')
		.select(['t.user_id'])
		.distinct()
		.where('t.event_id', '=', eventId)
		.where('t.status', 'in', ['valid', 'pending'])
		.where('o.status', 'in', ['pending_payment', 'under_review', 'confirmed'])
		.execute();
	return rows.map((r) => r.user_id);
}

export async function getAffectedUserIdsForConvoy(db: Database, convoyId: string): Promise<string[]> {
	const rows = await db
		.selectFrom('tickets as t')
		.innerJoin('orders as o', 'o.id', 't.order_id')
		.select(['t.user_id'])
		.distinct()
		.where('t.convoy_id', '=', convoyId)
		.where('t.status', 'in', ['valid', 'pending'])
		.where('o.status', 'in', ['pending_payment', 'under_review', 'confirmed'])
		.execute();
	return rows.map((r) => r.user_id);
}
