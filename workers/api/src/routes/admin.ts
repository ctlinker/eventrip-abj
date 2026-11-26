import { Hono } from 'hono';
import { getDB } from 'db';
import { isUniqueConstraintError, tryCatch } from 'utils';
import { requireAdmin, requireAuth, requirePermission } from '../middleware/auth';
import { createNotification, nowIso, parsePosterKeys, slugify, writeAuditLog } from '../lib/utils';
import {
	buildNotificationStatements,
	buildRealtimeSignalStatement,
	scheduleOutboxFlush,
} from '../services/notifications';
import { releaseOrderReservations } from '../services/orders';
import {
	buildConvoySnapshot,
	buildEventSnapshot,
	computeConvoyDiff,
	computeEventDiff,
	formatDiffSummary,
	getAffectedUserIdsForConvoy,
	getAffectedUserIdsForEvent,
	getEventOrderStats,
	resolveSeverity,
} from '../services/revisions';
import type { AppEnv } from '../types';

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use('*', requireAuth, requireAdmin);

adminRoutes.get('/dashboard', async (c) => {
	const db = getDB(c.env.DB);
	const eventId = c.req.query('event_id');

	const [ordersStats, paymentsStats, ticketsStats] = await Promise.all([
		db.selectFrom('orders').select(['id', 'status']).execute(),
		db.selectFrom('payments').select(['id', 'status', 'expected_amount_xof']).execute(),
		(eventId
			? db.selectFrom('tickets').select(['id', 'status', 'item_type']).where('event_id', '=', eventId)
			: db.selectFrom('tickets').select(['id', 'status', 'item_type'])
		).execute(),
	]);

	const confirmedPayments = paymentsStats.filter((p) => p.status === 'confirmed');
	const pendingPayments = paymentsStats.filter((p) => p.status === 'pending');

	return c.json({
		kpis: {
			total_orders: ordersStats.length,
			pending_payments: pendingPayments.length,
			confirmed_payments: confirmedPayments.length,
			confirmed_revenue_xof: confirmedPayments.reduce((s, p) => s + p.expected_amount_xof, 0),
			total_tickets: ticketsStats.length,
			valid_tickets: ticketsStats.filter((t) => t.status === 'valid').length,
			used_tickets: ticketsStats.filter((t) => t.status === 'used').length,
			convoy_seats_sold: ticketsStats.filter(
				(t) => t.item_type === 'convoy_ticket' && (t.status === 'valid' || t.status === 'used'),
			).length,
		},
	});
});

adminRoutes.get('/event-categories', async (c) => {
	const db = getDB(c.env.DB);
	const eventCategories = await db
		.selectFrom('event_categories')
		.selectAll()
		.orderBy('name', 'asc')
		.execute();
	return c.json({ event_categories: eventCategories });
});

adminRoutes.post('/event-categories', async (c) => {
	const bodyRes = await tryCatch(c.req.json<{ name?: string }>());
	const name = bodyRes.ok ? bodyRes.data.name?.trim() : '';
	if (!name) {
		return c.json({ error: 'Le nom de la catégorie est requis' }, 400);
	}

	const slug = slugify(name);
	if (!slug) {
		return c.json({ error: 'Nom de catégorie invalide' }, 400);
	}

	const id = `cat-${slug}-${crypto.randomUUID().slice(0, 4)}`;
	const now = nowIso();
	const db = getDB(c.env.DB);

	const insertRes = await tryCatch(
		db
			.insertInto('event_categories')
			.values({
				id,
				name,
				slug,
				created_at: now,
			})
			.execute(),
	);

	if (!insertRes.ok) {
		if (isUniqueConstraintError(insertRes.error)) {
			return c.json({ error: 'Cette catégorie existe déjà' }, 409);
		}
		return c.json({ error: 'Impossible de créer la catégorie' }, 500);
	}

	const category = await db
		.selectFrom('event_categories')
		.selectAll()
		.where('id', '=', id)
		.executeTakeFirst();

	return c.json({ category }, 201);
});

adminRoutes.get('/communes', async (c) => {
	const db = getDB(c.env.DB);
	const communes = await db.selectFrom('communes').selectAll().orderBy('name', 'asc').execute();
	return c.json({ communes });
});

adminRoutes.post('/communes', async (c) => {
	const bodyRes = await tryCatch(c.req.json<{ name?: string }>());
	const name = bodyRes.ok ? bodyRes.data.name?.trim() : '';
	if (!name) {
		return c.json({ error: 'Le nom de la commune est requis' }, 400);
	}

	const slug = slugify(name);
	if (!slug) {
		return c.json({ error: 'Nom de commune invalide' }, 400);
	}

	const id = `com-${slug}-${crypto.randomUUID().slice(0, 4)}`;
	const now = nowIso();
	const db = getDB(c.env.DB);

	const insertRes = await tryCatch(
		db
			.insertInto('communes')
			.values({
				id,
				name,
				slug,
				created_at: now,
			})
			.execute(),
	);

	if (!insertRes.ok) {
		if (isUniqueConstraintError(insertRes.error)) {
			return c.json({ error: 'Cette commune existe déjà' }, 409);
		}
		return c.json({ error: 'Impossible de créer la commune' }, 500);
	}

	const commune = await db
		.selectFrom('communes')
		.selectAll()
		.where('id', '=', id)
		.executeTakeFirst();

	return c.json({ commune }, 201);
});

adminRoutes.get('/events', async (c) => {
	const db = getDB(c.env.DB);
	const [events, eventCategories, communes] = await Promise.all([
		db
			.selectFrom('events as e')
			.leftJoin('event_categories as ec', 'ec.id', 'e.category_id')
			.selectAll('e')
			.select(['ec.name as category_name', 'ec.slug as category_slug'])
			.orderBy('e.created_at', 'desc')
			.execute(),
		db.selectFrom('event_categories').selectAll().orderBy('name', 'asc').execute(),
		db.selectFrom('communes').selectAll().orderBy('name', 'asc').execute(),
	]);
	const categories = events.length
		? await db.selectFrom('ticket_categories').selectAll().execute()
		: [];
	const convoys = events.length ? await db.selectFrom('convoys').selectAll().execute() : [];
	const activeTicketRows = events.length
		? await db
				.selectFrom('tickets as t')
				.innerJoin('orders as o', 'o.id', 't.order_id')
				.select([
					't.event_id',
					't.convoy_id',
					't.user_id',
					't.status as ticket_status',
					'o.id as order_id',
				])
				.where('o.status', 'in', ['pending_payment', 'under_review', 'confirmed'])
				.execute()
		: [];

	const eventOrders = new Map<string, Set<string>>();
	const eventHolders = new Map<string, Set<string>>();
	const eventTicketCounts = new Map<string, number>();
	const convoyHolders = new Map<string, Set<string>>();
	const convoyTicketCounts = new Map<string, number>();

	for (const r of activeTicketRows) {
		if (!eventOrders.has(r.event_id)) eventOrders.set(r.event_id, new Set());
		eventOrders.get(r.event_id)!.add(r.order_id);

		if (r.ticket_status === 'valid' || r.ticket_status === 'pending') {
			if (!eventHolders.has(r.event_id)) eventHolders.set(r.event_id, new Set());
			eventHolders.get(r.event_id)!.add(r.user_id);
			eventTicketCounts.set(r.event_id, (eventTicketCounts.get(r.event_id) || 0) + 1);

			if (r.convoy_id) {
				if (!convoyHolders.has(r.convoy_id)) convoyHolders.set(r.convoy_id, new Set());
				convoyHolders.get(r.convoy_id)!.add(r.user_id);
				convoyTicketCounts.set(r.convoy_id, (convoyTicketCounts.get(r.convoy_id) || 0) + 1);
			}
		}
	}

	return c.json({
		default_wave_merchant_id: c.env.WAVE_MERCHANT_ID,
		event_categories: eventCategories,
		communes,
		events: events.map((ev) => {
			const activeOrdersCount = eventOrders.get(ev.id)?.size ?? 0;
			return {
				...ev,
				price_locked: activeOrdersCount > 0,
				active_orders_count: activeOrdersCount,
				affected_holders_count: eventHolders.get(ev.id)?.size ?? 0,
				affected_tickets_count: eventTicketCounts.get(ev.id) ?? 0,
				poster_keys: parsePosterKeys(ev.poster_key),
				categories: categories.filter((cat) => cat.event_id === ev.id),
				convoys: convoys
					.filter((cv) => cv.event_id === ev.id)
					.map((cv) => ({
						...cv,
						affected_holders_count: convoyHolders.get(cv.id)?.size ?? 0,
						affected_tickets_count: convoyTicketCounts.get(cv.id) ?? 0,
					})),
			};
		}),
	});
});

adminRoutes.post('/events', async (c) => {
	const user = c.get('user');
	const body = await c.req
		.json<{
			title?: string;
			slug?: string;
			description?: string;
			starts_at?: string;
			ends_at?: string | null;
			venue?: string;
			price_xof?: number;
			category_id?: string | null;
			extra_info?: string | null;
			wave_payment_url?: string | null;
			sales_start_at?: string | null;
			sales_end_at?: string | null;
			status?: 'draft' | 'published' | 'archived';
			initial_departure?: {
				commune?: string;
				meeting_point?: string;
				departure_at?: string;
				capacity?: number;
			};
		}>()
		.catch(
			(): {
				title?: string;
				slug?: string;
				description?: string;
				starts_at?: string;
				ends_at?: string | null;
				venue?: string;
				price_xof?: number;
				category_id?: string | null;
				extra_info?: string | null;
				wave_payment_url?: string | null;
				sales_start_at?: string | null;
				sales_end_at?: string | null;
				status?: 'draft' | 'published' | 'archived';
				initial_departure?: {
					commune?: string;
					meeting_point?: string;
					departure_at?: string;
					capacity?: number;
				};
			} => ({}),
		);

	const dep = body.initial_departure;
	const cleanTitle = body.title?.trim() || '';
	const cleanVenue = body.venue?.trim() || '';
	if (
		!cleanTitle ||
		!body.description ||
		!body.starts_at ||
		!cleanVenue ||
		!Number.isInteger(body.price_xof) ||
		(body.price_xof as number) < 0 ||
		!dep?.commune?.trim() ||
		!dep?.meeting_point?.trim() ||
		!dep?.departure_at
	) {
		return c.json(
			{
				error:
					'Champs requis : title, description, starts_at, venue, price_xof (>= 0) et initial_departure (commune, meeting_point, departure_at)',
			},
			400,
		);
	}

	const id = crypto.randomUUID();
	const convoyId = crypto.randomUUID();
	const now = nowIso();
	const recentCutoff = new Date(Date.now() - 60_000).toISOString();
	const baseSlug = slugify(body.slug || cleanTitle) || id.slice(0, 8);
	const slug = `${baseSlug}-${id.slice(0, 4)}`;
	const capacity =
		Number.isInteger(dep.capacity) && (dep.capacity as number) > 0 ? dep.capacity! : 55;
	const db = getDB(c.env.DB);

	// Insertion atomique bloquant tout double-publish identique dans la fenêtre de 60s
	const insertRes = await tryCatch(
		c.env.DB.prepare(
			`INSERT INTO events (
				id, slug, title, description, poster_key, starts_at, ends_at,
				venue, price_xof, category_id, extra_info, wave_payment_url,
				sales_start_at, sales_end_at, status, created_by, created_at, updated_at
			)
			SELECT ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
			WHERE NOT EXISTS (
				SELECT 1 FROM events
				WHERE created_by = ?
				  AND LOWER(TRIM(title)) = LOWER(?)
				  AND starts_at = ?
				  AND LOWER(TRIM(venue)) = LOWER(?)
				  AND created_at >= ?
			)
			RETURNING id`,
		)
			.bind(
				id,
				slug,
				cleanTitle,
				body.description,
				body.starts_at,
				body.ends_at ?? null,
				cleanVenue,
				body.price_xof!,
				body.category_id ?? null,
				body.extra_info ?? null,
				body.wave_payment_url ?? null,
				body.sales_start_at ?? null,
				body.sales_end_at ?? null,
				body.status ?? 'draft',
				user.id,
				now,
				now,
				user.id,
				cleanTitle,
				body.starts_at,
				cleanVenue,
				recentCutoff,
			)
			.first<{ id: string }>(),
	);

	if (!insertRes.ok) {
		if (isUniqueConstraintError(insertRes.error)) {
			return c.json({ error: 'Un événement avec ce slug existe déjà' }, 409);
		}
		return c.json({ error: 'Erreur lors de la création de l’événement' }, 500);
	}

	if (!insertRes.data) {
		return c.json({ error: 'Cet événement vient déjà d’être publié.' }, 409);
	}

	const eventRevId = `evrev-${id}-v1`;
	const convoyRevId = `cvrev-${convoyId}-v1`;
	const initialEventSnapshot = buildEventSnapshot({
		title: cleanTitle,
		description: body.description,
		starts_at: body.starts_at,
		ends_at: body.ends_at ?? null,
		venue: cleanVenue,
		price_xof: body.price_xof!,
		category_id: body.category_id ?? null,
		extra_info: body.extra_info ?? null,
		wave_payment_url: body.wave_payment_url ?? null,
		status: body.status ?? 'draft',
	});
	const initialConvoySnapshot = buildConvoySnapshot({
		name: `Départ ${dep.commune.trim()}`,
		commune: dep.commune.trim(),
		departure_at: dep.departure_at,
		meeting_point: dep.meeting_point.trim(),
		destination: cleanVenue,
		trip_type: 'round_trip',
		price_xof: 0,
		capacity,
		extra_info: null,
		status: 'published',
	});

	await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO event_revisions (id, event_id, version_number, snapshot_json, severity, change_summary, changes_json, changed_by, created_at)
       VALUES (?, ?, 1, ?, 'minor', 'Version initiale', NULL, ?, ?)`,
		).bind(eventRevId, id, initialEventSnapshot, user.id, now),
		c.env.DB.prepare(
			`UPDATE events SET revision_number = 1, current_revision_id = ? WHERE id = ?`,
		).bind(eventRevId, id),
		c.env.DB.prepare(
			`INSERT INTO convoys (id, event_id, name, commune, departure_at, meeting_point, destination, trip_type, price_xof, capacity, reserved_count, extra_info, status, revision_number, current_revision_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'round_trip', 0, ?, 0, NULL, 'published', 1, ?, ?, ?)`,
		).bind(
			convoyId,
			id,
			`Départ ${dep.commune.trim()}`,
			dep.commune.trim(),
			dep.departure_at,
			dep.meeting_point.trim(),
			cleanVenue,
			capacity,
			convoyRevId,
			now,
			now,
		),
		c.env.DB.prepare(
			`INSERT INTO convoy_revisions (id, convoy_id, version_number, snapshot_json, severity, change_summary, changes_json, changed_by, created_at)
       VALUES (?, ?, 1, ?, 'minor', 'Version initiale', NULL, ?, ?)`,
		).bind(convoyRevId, convoyId, initialConvoySnapshot, user.id, now),
	]);

	const [event, convoy] = await Promise.all([
		db
			.selectFrom('events as e')
			.leftJoin('event_categories as ec', 'ec.id', 'e.category_id')
			.selectAll('e')
			.select(['ec.name as category_name', 'ec.slug as category_slug'])
			.where('e.id', '=', id)
			.executeTakeFirst(),
		db.selectFrom('convoys').selectAll().where('id', '=', convoyId).executeTakeFirst(),
	]);

	return c.json(
		{
			event: event
				? {
						...event,
						poster_keys: [],
						categories: [],
						convoys: convoy ? [convoy] : [],
					}
				: null,
		},
		201,
	);
});

adminRoutes.patch('/events/:id', async (c) => {
	const admin = c.get('user');
	const id = c.req.param('id');
	const bodyRes = await tryCatch(c.req.json<Record<string, unknown>>());
	const body = bodyRes.ok ? bodyRes.data : {};
	const db = getDB(c.env.DB);

	const existing = await db.selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst();
	if (!existing) return c.json({ error: 'Événement introuvable' }, 404);

	const allowedFields = [
		'title',
		'description',
		'starts_at',
		'ends_at',
		'venue',
		'price_xof',
		'category_id',
		'extra_info',
		'wave_payment_url',
		'sales_start_at',
		'sales_end_at',
		'status',
	] as const;

	const incoming: Record<string, unknown> = {};
	for (const field of allowedFields) {
		if (field in body) {
			incoming[field] = body[field];
		}
	}

	if ('price_xof' in incoming) {
		const nextPrice = Number(incoming.price_xof);
		if (!Number.isInteger(nextPrice) || nextPrice < 0) {
			return c.json({ error: 'Le prix (price_xof) doit être un entier positif ou nul' }, 400);
		}
		incoming.price_xof = nextPrice;
		if (nextPrice !== existing.price_xof) {
			const stats = await getEventOrderStats(db, id);
			if (stats.priceLocked) {
				return c.json(
					{
						error:
							'Le prix est verrouillé après la première commande. Utilisez « Dupliquer & Archiver » pour créer une nouvelle édition tarifaire.',
						code: 'PRICE_LOCKED',
					},
					409,
				);
			}
		}
	}

	const { diffs, minSeverity } = computeEventDiff(existing as unknown as Record<string, unknown>, incoming);
	if (diffs.length === 0) {
		return c.json({ event: existing, unchanged: true, notified_users_count: 0 });
	}

	const severity = resolveSeverity(
		minSeverity,
		typeof body.severity === 'string' ? body.severity : null,
	);
	const customSummary =
		typeof body.change_summary === 'string' && body.change_summary.trim()
			? body.change_summary.trim()
			: null;
	const changeSummary = customSummary || formatDiffSummary(diffs);

	const now = nowIso();
	const nextVersion = (existing.revision_number ?? 1) + 1;
	const revisionId = `evrev-${id}-v${nextVersion}-${crypto.randomUUID().slice(0, 6)}`;

	const merged = {
		...existing,
		...incoming,
		updated_at: now,
		revision_number: nextVersion,
		current_revision_id: revisionId,
	};

	const snapshotJson = buildEventSnapshot({
		title: String(merged.title),
		description: String(merged.description),
		starts_at: String(merged.starts_at),
		ends_at: merged.ends_at ? String(merged.ends_at) : null,
		venue: String(merged.venue),
		price_xof: Number(merged.price_xof),
		category_id: merged.category_id ? String(merged.category_id) : null,
		extra_info: merged.extra_info ? String(merged.extra_info) : null,
		wave_payment_url: merged.wave_payment_url ? String(merged.wave_payment_url) : null,
		status: String(merged.status),
	});

	const setCols: string[] = [];
	const setVals: unknown[] = [];
	for (const [k, v] of Object.entries(incoming)) {
		setCols.push(`"${k}" = ?`);
		setVals.push(v);
	}
	setCols.push('"revision_number" = ?', '"current_revision_id" = ?', '"updated_at" = ?');
	setVals.push(nextVersion, revisionId, now, id);

	const batch: D1PreparedStatement[] = [
		c.env.DB.prepare(`UPDATE events SET ${setCols.join(', ')} WHERE id = ?`).bind(...setVals),
		c.env.DB.prepare(
			`INSERT INTO event_revisions (id, event_id, version_number, snapshot_json, severity, change_summary, changes_json, changed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			revisionId,
			id,
			nextVersion,
			snapshotJson,
			severity,
			changeSummary,
			JSON.stringify(diffs),
			admin.id,
			now,
		),
		c.env.DB.prepare(
			`INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, old_state, new_state, metadata, created_at)
       VALUES (?, ?, 'event.revision', 'event', ?, ?, ?, ?, ?)`,
		).bind(
			crypto.randomUUID(),
			admin.id,
			id,
			JSON.stringify(Object.fromEntries(diffs.map((d) => [d.field, d.before]))),
			JSON.stringify(Object.fromEntries(diffs.map((d) => [d.field, d.after]))),
			JSON.stringify({ revision_id: revisionId, version_number: nextVersion, severity, change_summary: changeSummary }),
			now,
		),
	];

	const shouldNotify =
		severity === 'important' || severity === 'critical' || body.notify_customers === true;
	const outboxIds: string[] = [];
	let notifiedUsersCount = 0;

	if (shouldNotify) {
		const affectedUserIds = await getAffectedUserIdsForEvent(db, id);
		notifiedUsersCount = affectedUserIds.length;
		const notifTitle =
			severity === 'critical'
				? `Changement important — ${merged.title}`
				: `Mise à jour — ${merged.title}`;
		const notifBody = `${changeSummary} (Révision v${nextVersion} · Vos billets restent valides).`;

		for (const uid of affectedUserIds) {
			const built = buildNotificationStatements(c.env.DB, {
				userId: uid,
				type: 'event_updated',
				title: notifTitle,
				body: notifBody,
				link: '/tickets',
				tag: `event-rev-${id}-v${nextVersion}`,
				push: true,
				now,
			});
			batch.push(...built.statements);
			outboxIds.push(built.outboxId);
		}
	}

	await c.env.DB.batch(batch);
	if (outboxIds.length > 0) {
		scheduleOutboxFlush(c.env, c.executionCtx, outboxIds);
	}

	const [event, revision] = await Promise.all([
		db.selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst(),
		db.selectFrom('event_revisions').selectAll().where('id', '=', revisionId).executeTakeFirst(),
	]);
	return c.json({ event, revision, notified_users_count: notifiedUsersCount });
});

adminRoutes.get('/events/:id/revisions', async (c) => {
	const id = c.req.param('id');
	const db = getDB(c.env.DB);

	const event = await db.selectFrom('events').select(['id', 'title']).where('id', '=', id).executeTakeFirst();
	if (!event) return c.json({ error: 'Événement introuvable' }, 404);

	const [eventRevisions, convoys] = await Promise.all([
		db
			.selectFrom('event_revisions as r')
			.leftJoin('user as u', 'u.id', 'r.changed_by')
			.selectAll('r')
			.select(['u.name as changed_by_name'])
			.where('r.event_id', '=', id)
			.orderBy('r.version_number', 'desc')
			.execute(),
		db.selectFrom('convoys').select(['id', 'name', 'commune']).where('event_id', '=', id).execute(),
	]);

	const convoyIds = convoys.map((cv) => cv.id);
	const convoyNameMap = new Map(convoys.map((cv) => [cv.id, cv.commune || cv.name]));
	const convoyRevisions = convoyIds.length
		? await db
				.selectFrom('convoy_revisions as r')
				.leftJoin('user as u', 'u.id', 'r.changed_by')
				.selectAll('r')
				.select(['u.name as changed_by_name'])
				.where('r.convoy_id', 'in', convoyIds)
				.orderBy('r.created_at', 'desc')
				.execute()
		: [];

	return c.json({
		event_revisions: eventRevisions,
		convoy_revisions: convoyRevisions.map((r) => ({
			...r,
			convoy_label: convoyNameMap.get(r.convoy_id) ?? r.convoy_id,
		})),
	});
});

adminRoutes.post('/events/:id/clone-archive', async (c) => {
	const admin = c.get('user');
	const sourceId = c.req.param('id');
	const bodyRes = await tryCatch(
		c.req.json<{
			price_xof?: number;
			title?: string;
			status?: 'draft' | 'published';
			convoys?: Array<{
				source_convoy_id: string;
				capacity: number;
				commune?: string;
				meeting_point?: string;
				departure_at?: string;
			}>;
		}>(),
	);
	const body = bodyRes.ok ? bodyRes.data : {};

	if (!Number.isInteger(body.price_xof) || (body.price_xof as number) < 0) {
		return c.json({ error: 'Un nouveau prix (price_xof >= 0) est requis' }, 400);
	}

	const db = getDB(c.env.DB);
	const source = await db.selectFrom('events').selectAll().where('id', '=', sourceId).executeTakeFirst();
	if (!source) return c.json({ error: 'Événement source introuvable' }, 404);

	const sourceConvoys = await db
		.selectFrom('convoys')
		.selectAll()
		.where('event_id', '=', sourceId)
		.execute();

	const now = nowIso();
	const newEventId = crypto.randomUUID();
	const nextTitle = body.title?.trim() || source.title;
	const newSlug = `${slugify(nextTitle)}-${crypto.randomUUID().slice(0, 4)}`;
	const nextStatus = body.status === 'draft' ? 'draft' : 'published';
	const newEventRevId = `evrev-${newEventId}-v1`;

	const archiveNextVer = (source.revision_number ?? 1) + 1;
	const archiveRevId = `evrev-${sourceId}-v${archiveNextVer}-${crypto.randomUUID().slice(0, 6)}`;
	const archiveSnapshot = buildEventSnapshot({
		...source,
		status: 'archived',
	});

	const newEventSnapshot = buildEventSnapshot({
		title: nextTitle,
		description: source.description,
		starts_at: source.starts_at,
		ends_at: source.ends_at,
		venue: source.venue,
		price_xof: body.price_xof!,
		category_id: source.category_id,
		extra_info: source.extra_info,
		wave_payment_url: source.wave_payment_url,
		status: nextStatus,
	});

	const batch: D1PreparedStatement[] = [
		// 1. Archiver l'événement source sans toucher aux commandes/billets/réservations existants
		c.env.DB.prepare(
			`UPDATE events SET status = 'archived', revision_number = ?, current_revision_id = ?, updated_at = ? WHERE id = ?`,
		).bind(archiveNextVer, archiveRevId, now, sourceId),
		c.env.DB.prepare(
			`INSERT INTO event_revisions (id, event_id, version_number, snapshot_json, severity, change_summary, changes_json, changed_by, created_at)
       VALUES (?, ?, ?, ?, 'minor', ?, ?, ?, ?)`,
		).bind(
			archiveRevId,
			sourceId,
			archiveNextVer,
			archiveSnapshot,
			`Archivé suite à la création d’une nouvelle édition tarifaire (${body.price_xof} FCFA)`,
			JSON.stringify([{ field: 'status', label: 'Statut', before: source.status, after: 'archived' }]),
			admin.id,
			now,
		),
		// 2. Créer le nouvel événement indépendant (v1)
		c.env.DB.prepare(
			`INSERT INTO events (
				id, slug, title, description, poster_key, starts_at, ends_at,
				venue, price_xof, category_id, extra_info, wave_payment_url,
				sales_start_at, sales_end_at, status, revision_number, current_revision_id,
				created_by, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
		).bind(
			newEventId,
			newSlug,
			nextTitle,
			source.description,
			source.poster_key,
			source.starts_at,
			source.ends_at,
			source.venue,
			body.price_xof!,
			source.category_id,
			source.extra_info,
			source.wave_payment_url,
			source.sales_start_at,
			source.sales_end_at,
			nextStatus,
			newEventRevId,
			admin.id,
			now,
			now,
		),
		c.env.DB.prepare(
			`INSERT INTO event_revisions (id, event_id, version_number, snapshot_json, severity, change_summary, changes_json, changed_by, created_at)
       VALUES (?, ?, 1, ?, 'minor', ?, NULL, ?, ?)`,
		).bind(
			newEventRevId,
			newEventId,
			newEventSnapshot,
			`Cloné depuis ${source.title} (${source.price_xof} → ${body.price_xof} FCFA)`,
			admin.id,
			now,
		),
	];

	const overrideBySourceId = new Map(
		(body.convoys || []).map((ov) => [ov.source_convoy_id, ov]),
	);

	for (const cv of sourceConvoys) {
		const ov = overrideBySourceId.get(cv.id);
		const defaultRemaining = Math.max(1, cv.capacity - cv.reserved_count);
		const nextCap =
			ov && Number.isInteger(ov.capacity) && ov.capacity >= 0 ? ov.capacity : defaultRemaining;
		if (nextCap === 0) continue;

		const newConvoyId = crypto.randomUUID();
		const newConvoyRevId = `cvrev-${newConvoyId}-v1`;
		const nextCommune = ov?.commune?.trim() || cv.commune;
		const nextMeeting = ov?.meeting_point?.trim() || cv.meeting_point;
		const nextDeparture = ov?.departure_at || cv.departure_at;
		const nextName = `Départ ${nextCommune}`;

		const cvSnap = buildConvoySnapshot({
			name: nextName,
			commune: nextCommune,
			departure_at: nextDeparture,
			meeting_point: nextMeeting,
			destination: cv.destination,
			trip_type: cv.trip_type,
			price_xof: 0,
			capacity: nextCap,
			extra_info: cv.extra_info,
			status: 'published',
		});

		batch.push(
			c.env.DB.prepare(
				`INSERT INTO convoys (id, event_id, name, commune, departure_at, meeting_point, destination, trip_type, price_xof, capacity, reserved_count, extra_info, status, revision_number, current_revision_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, 'published', 1, ?, ?, ?)`,
			).bind(
				newConvoyId,
				newEventId,
				nextName,
				nextCommune,
				nextDeparture,
				nextMeeting,
				cv.destination,
				cv.trip_type,
				nextCap,
				cv.extra_info,
				newConvoyRevId,
				now,
				now,
			),
			c.env.DB.prepare(
				`INSERT INTO convoy_revisions (id, convoy_id, version_number, snapshot_json, severity, change_summary, changes_json, changed_by, created_at)
         VALUES (?, ?, 1, ?, 'minor', 'Version initiale (clonée)', NULL, ?, ?)`,
			).bind(newConvoyRevId, newConvoyId, cvSnap, admin.id, now),
		);
	}

	batch.push(
		c.env.DB.prepare(
			`INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, old_state, new_state, metadata, created_at)
       VALUES (?, ?, 'event.clone_archive', 'event', ?, ?, ?, ?, ?)`,
		).bind(
			crypto.randomUUID(),
			admin.id,
			sourceId,
			JSON.stringify({ status: source.status, price_xof: source.price_xof }),
			JSON.stringify({ status: 'archived', new_event_id: newEventId, new_price_xof: body.price_xof }),
			JSON.stringify({ source_event_id: sourceId, new_event_id: newEventId }),
			now,
		),
	);

	await c.env.DB.batch(batch);

	const [newEvent, newConvoys] = await Promise.all([
		db.selectFrom('events').selectAll().where('id', '=', newEventId).executeTakeFirst(),
		db.selectFrom('convoys').selectAll().where('event_id', '=', newEventId).execute(),
	]);

	return c.json(
		{
			archived_event_id: sourceId,
			event: newEvent
				? {
						...newEvent,
						poster_keys: parsePosterKeys(newEvent.poster_key),
						convoys: newConvoys,
					}
				: null,
		},
		201,
	);
});

adminRoutes.delete('/events/:id', async (c) => {
	const admin = c.get('user');
	const id = c.req.param('id');
	const db = getDB(c.env.DB);

	const event = await db
		.selectFrom('events')
		.select(['id', 'title', 'poster_key'])
		.where('id', '=', id)
		.executeTakeFirst();
	if (!event) return c.json({ error: 'Événement introuvable' }, 404);

	const [hasTickets, hasReservedConvoy, hasReservedCat] = await Promise.all([
		db.selectFrom('tickets').select(['id']).where('event_id', '=', id).executeTakeFirst(),
		db
			.selectFrom('convoys')
			.select(['id'])
			.where('event_id', '=', id)
			.where('reserved_count', '>', 0)
			.executeTakeFirst(),
		db
			.selectFrom('ticket_categories')
			.select(['id'])
			.where('event_id', '=', id)
			.where('reserved_count', '>', 0)
			.executeTakeFirst(),
	]);

	if (hasTickets || hasReservedConvoy || hasReservedCat) {
		return c.json(
			{
				error:
					'Impossible de supprimer un événement ayant déjà des réservations (archivez-le à la place)',
			},
			409,
		);
	}

	const posterKeys = parsePosterKeys(event.poster_key);
	for (const key of posterKeys) {
		await tryCatch(c.env.UPLOADS.delete(key));
	}

	await db.deleteFrom('events').where('id', '=', id).execute();
	await writeAuditLog(db, {
		actorId: admin.id,
		action: 'event.delete',
		entityType: 'event',
		entityId: id,
		oldState: { title: event.title },
	});

	return c.json({ ok: true });
});

adminRoutes.post('/events/:id/poster', async (c) => {
	const id = c.req.param('id');
	const db = getDB(c.env.DB);
	const event = await db
		.selectFrom('events')
		.select(['id', 'poster_key'])
		.where('id', '=', id)
		.executeTakeFirst();
	if (!event) return c.json({ error: 'Événement introuvable' }, 404);

	const formRes = await tryCatch(c.req.formData());
	const formData = formRes.ok ? formRes.data : null;
	if (!formData) {
		return c.json({ error: 'Requête multipart invalide' }, 400);
	}

	const rawFiles = [...formData.getAll('files'), formData.get('file')].filter(
		(f): f is File => f instanceof File && f.size > 0,
	);
	if (rawFiles.length === 0) {
		return c.json({ error: 'Au moins une image ("file" ou "files") est requise' }, 400);
	}

	const mimeMap: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
	};

	const uploadedKeys: string[] = [];
	for (const file of rawFiles) {
		const ext = mimeMap[file.type];
		if (!ext || file.size > 5 * 1024 * 1024) {
			return c.json({ error: 'Chaque image doit être JPEG/PNG/WebP <= 5 Mo' }, 400);
		}
		const key = `events/${id}/${crypto.randomUUID()}.${ext}`;
		const putRes = await tryCatch(
			c.env.UPLOADS.put(key, await file.arrayBuffer(), {
				httpMetadata: { contentType: file.type },
			}),
		);
		if (!putRes.ok) {
			return c.json({ error: 'Échec du téléversement de l’affiche' }, 500);
		}
		uploadedKeys.push(key);
	}

	const existingKeys = parsePosterKeys(event.poster_key);
	const allKeys = [...existingKeys, ...uploadedKeys];

	await db
		.updateTable('events')
		.set({ poster_key: JSON.stringify(allKeys), updated_at: nowIso() })
		.where('id', '=', id)
		.execute();

	return c.json({ ok: true, poster_key: allKeys[0] ?? null, poster_keys: allKeys });
});

adminRoutes.delete('/events/:id/poster', async (c) => {
	const id = c.req.param('id');
	const bodyRes = await tryCatch(c.req.json<{ key?: string }>());
	const keyToDelete = bodyRes.ok ? bodyRes.data.key : undefined;
	if (!keyToDelete) {
		return c.json({ error: 'Clé média requise' }, 400);
	}

	const db = getDB(c.env.DB);
	const event = await db
		.selectFrom('events')
		.select(['id', 'poster_key'])
		.where('id', '=', id)
		.executeTakeFirst();
	if (!event) return c.json({ error: 'Événement introuvable' }, 404);

	const remaining = parsePosterKeys(event.poster_key).filter((k) => k !== keyToDelete);
	await tryCatch(c.env.UPLOADS.delete(keyToDelete));

	await db
		.updateTable('events')
		.set({
			poster_key: remaining.length > 0 ? JSON.stringify(remaining) : null,
			updated_at: nowIso(),
		})
		.where('id', '=', id)
		.execute();

	return c.json({ ok: true, poster_keys: remaining });
});

adminRoutes.post('/events/:id/categories', async (c) => {
	const eventId = c.req.param('id');
	const body = await c.req.json<{
		name?: string;
		description?: string | null;
		price_xof?: number;
		capacity?: number;
		sort_order?: number;
	}>();

	if (!body.name || !Number.isInteger(body.price_xof) || !Number.isInteger(body.capacity)) {
		return c.json({ error: 'Champs requis : name, price_xof, capacity' }, 400);
	}

	const id = crypto.randomUUID();
	const now = nowIso();
	const db = getDB(c.env.DB);

	await db
		.insertInto('ticket_categories')
		.values({
			id,
			event_id: eventId,
			name: body.name.trim(),
			description: body.description ?? null,
			price_xof: body.price_xof!,
			capacity: body.capacity!,
			reserved_count: 0,
			sort_order: body.sort_order ?? 0,
			created_at: now,
			updated_at: now,
		})
		.execute();

	const category = await db
		.selectFrom('ticket_categories')
		.selectAll()
		.where('id', '=', id)
		.executeTakeFirst();
	return c.json({ category }, 201);
});

adminRoutes.post('/events/:id/convoys', async (c) => {
	const eventId = c.req.param('id');
	const body = await c.req
		.json<{
			name?: string;
			commune?: string;
			departure_at?: string;
			meeting_point?: string;
			destination?: string;
			trip_type?: 'one_way' | 'round_trip';
			price_xof?: number;
			capacity?: number;
			extra_info?: string | null;
		}>()
		.catch(
			(): {
				name?: string;
				commune?: string;
				departure_at?: string;
				meeting_point?: string;
				destination?: string;
				trip_type?: 'one_way' | 'round_trip';
				price_xof?: number;
				capacity?: number;
				extra_info?: string | null;
			} => ({}),
		);

	const tripType = body.trip_type ?? 'round_trip';
	const capacity =
		Number.isInteger(body.capacity) && (body.capacity as number) > 0 ? body.capacity! : 55;
	const priceXof = Number.isInteger(body.price_xof) && (body.price_xof as number) >= 0 ? body.price_xof! : 0;
	const commune = (body.commune || body.meeting_point || body.name || '').trim();

	if (
		!body.name ||
		!commune ||
		!body.departure_at ||
		!body.meeting_point ||
		!body.destination ||
		(tripType !== 'one_way' && tripType !== 'round_trip')
	) {
		return c.json({ error: 'Paramètres de convoi invalides' }, 400);
	}

	const admin = c.get('user');
	const id = crypto.randomUUID();
	const revId = `cvrev-${id}-v1`;
	const now = nowIso();
	const db = getDB(c.env.DB);

	const snap = buildConvoySnapshot({
		name: body.name.trim(),
		commune,
		departure_at: body.departure_at,
		meeting_point: body.meeting_point.trim(),
		destination: body.destination.trim(),
		trip_type: tripType,
		price_xof: priceXof,
		capacity,
		extra_info: body.extra_info ?? null,
		status: 'published',
	});

	await c.env.DB.batch([
		c.env.DB.prepare(
			`INSERT INTO convoys (id, event_id, name, commune, departure_at, meeting_point, destination, trip_type, price_xof, capacity, reserved_count, extra_info, status, revision_number, current_revision_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'published', 1, ?, ?, ?)`,
		).bind(
			id,
			eventId,
			body.name.trim(),
			commune,
			body.departure_at,
			body.meeting_point.trim(),
			body.destination.trim(),
			tripType,
			priceXof,
			capacity,
			body.extra_info ?? null,
			revId,
			now,
			now,
		),
		c.env.DB.prepare(
			`INSERT INTO convoy_revisions (id, convoy_id, version_number, snapshot_json, severity, change_summary, changes_json, changed_by, created_at)
       VALUES (?, ?, 1, ?, 'minor', 'Version initiale', NULL, ?, ?)`,
		).bind(revId, id, snap, admin.id, now),
	]);

	const convoy = await db.selectFrom('convoys').selectAll().where('id', '=', id).executeTakeFirst();
	return c.json({ convoy }, 201);
});

adminRoutes.patch('/convoys/:id', async (c) => {
	const admin = c.get('user');
	const id = c.req.param('id');
	const bodyRes = await tryCatch(c.req.json<Record<string, unknown>>());
	const body = bodyRes.ok ? bodyRes.data : {};
	const db = getDB(c.env.DB);

	const existing = await db.selectFrom('convoys').selectAll().where('id', '=', id).executeTakeFirst();
	if (!existing) return c.json({ error: 'Convoi introuvable' }, 404);

	const parentEvent = await db
		.selectFrom('events')
		.select(['id', 'title'])
		.where('id', '=', existing.event_id)
		.executeTakeFirst();

	const allowedFields = [
		'name',
		'commune',
		'departure_at',
		'meeting_point',
		'destination',
		'capacity',
		'extra_info',
		'status',
	] as const;

	const incoming: Record<string, unknown> = {};
	for (const field of allowedFields) {
		if (field in body) {
			incoming[field] = body[field];
		}
	}

	if ('commune' in incoming && typeof incoming.commune === 'string') {
		incoming.commune = incoming.commune.trim();
		if (!('name' in incoming)) {
			incoming.name = `Départ ${incoming.commune}`;
		}
	}
	if ('meeting_point' in incoming && typeof incoming.meeting_point === 'string') {
		incoming.meeting_point = incoming.meeting_point.trim();
	}

	if ('capacity' in incoming) {
		const nextCap = Number(incoming.capacity);
		if (!Number.isInteger(nextCap) || nextCap < 1) {
			return c.json({ error: 'La capacité doit être un entier >= 1' }, 400);
		}
		if (nextCap < existing.reserved_count) {
			return c.json(
				{
					error: `Impossible de réduire la capacité sous le nombre de places déjà réservées (${existing.reserved_count})`,
					code: 'CAPACITY_BELOW_RESERVED',
				},
				409,
			);
		}
		incoming.capacity = nextCap;
	}

	const { diffs, minSeverity } = computeConvoyDiff(existing as unknown as Record<string, unknown>, incoming);
	if (diffs.length === 0) {
		return c.json({ convoy: existing, unchanged: true, notified_users_count: 0 });
	}

	const severity = resolveSeverity(
		minSeverity,
		typeof body.severity === 'string' ? body.severity : null,
	);
	const customSummary =
		typeof body.change_summary === 'string' && body.change_summary.trim()
			? body.change_summary.trim()
			: null;
	const changeSummary = customSummary || formatDiffSummary(diffs);

	const now = nowIso();
	const nextVersion = (existing.revision_number ?? 1) + 1;
	const revisionId = `cvrev-${id}-v${nextVersion}-${crypto.randomUUID().slice(0, 6)}`;

	const merged = {
		...existing,
		...incoming,
		revision_number: nextVersion,
		current_revision_id: revisionId,
		updated_at: now,
	};

	const snapshotJson = buildConvoySnapshot({
		name: String(merged.name),
		commune: String(merged.commune),
		departure_at: String(merged.departure_at),
		meeting_point: String(merged.meeting_point),
		destination: String(merged.destination),
		trip_type: String(merged.trip_type),
		price_xof: Number(merged.price_xof),
		capacity: Number(merged.capacity),
		extra_info: merged.extra_info ? String(merged.extra_info) : null,
		status: String(merged.status),
	});

	const setCols: string[] = [];
	const setVals: unknown[] = [];
	for (const [k, v] of Object.entries(incoming)) {
		setCols.push(`"${k}" = ?`);
		setVals.push(v);
	}
	setCols.push('"revision_number" = ?', '"current_revision_id" = ?', '"updated_at" = ?');
	setVals.push(nextVersion, revisionId, now, id);

	const batch: D1PreparedStatement[] = [
		c.env.DB.prepare(`UPDATE convoys SET ${setCols.join(', ')} WHERE id = ?`).bind(...setVals),
		c.env.DB.prepare(
			`INSERT INTO convoy_revisions (id, convoy_id, version_number, snapshot_json, severity, change_summary, changes_json, changed_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			revisionId,
			id,
			nextVersion,
			snapshotJson,
			severity,
			changeSummary,
			JSON.stringify(diffs),
			admin.id,
			now,
		),
		c.env.DB.prepare(
			`INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, old_state, new_state, metadata, created_at)
       VALUES (?, ?, 'convoy.revision', 'convoy', ?, ?, ?, ?, ?)`,
		).bind(
			crypto.randomUUID(),
			admin.id,
			id,
			JSON.stringify(Object.fromEntries(diffs.map((d) => [d.field, d.before]))),
			JSON.stringify(Object.fromEntries(diffs.map((d) => [d.field, d.after]))),
			JSON.stringify({
				event_id: existing.event_id,
				revision_id: revisionId,
				version_number: nextVersion,
				severity,
				change_summary: changeSummary,
			}),
			now,
		),
	];

	const shouldNotify =
		severity === 'important' || severity === 'critical' || body.notify_customers === true;
	const outboxIds: string[] = [];
	let notifiedUsersCount = 0;

	if (shouldNotify) {
		const affectedUserIds = await getAffectedUserIdsForConvoy(db, id);
		notifiedUsersCount = affectedUserIds.length;
		const eventTitle = parentEvent?.title || 'Votre événement';
		const notifTitle =
			severity === 'critical'
				? `Alerte convoi (${merged.commune}) — ${eventTitle}`
				: `Départ mis à jour (${merged.commune}) — ${eventTitle}`;
		const notifBody = `${changeSummary} (Révision v${nextVersion} · Votre QR code reste valide).`;

		for (const uid of affectedUserIds) {
			const built = buildNotificationStatements(c.env.DB, {
				userId: uid,
				type: 'convoy_updated',
				title: notifTitle,
				body: notifBody,
				link: '/tickets',
				tag: `convoy-rev-${id}-v${nextVersion}`,
				push: true,
				now,
			});
			batch.push(...built.statements);
			outboxIds.push(built.outboxId);
		}
	}

	await c.env.DB.batch(batch);
	if (outboxIds.length > 0) {
		scheduleOutboxFlush(c.env, c.executionCtx, outboxIds);
	}

	const [convoy, revision] = await Promise.all([
		db.selectFrom('convoys').selectAll().where('id', '=', id).executeTakeFirst(),
		db.selectFrom('convoy_revisions').selectAll().where('id', '=', revisionId).executeTakeFirst(),
	]);

	return c.json({ convoy, revision, notified_users_count: notifiedUsersCount });
});

adminRoutes.get('/convoys/:id/passengers', async (c) => {
	const convoyId = c.req.param('id');
	const db = getDB(c.env.DB);

	const passengers = await db
		.selectFrom('tickets as t')
		.innerJoin('user as u', 'u.id', 't.user_id')
		.innerJoin('orders as o', 'o.id', 't.order_id')
		.select([
			't.id as ticket_id',
			't.code as ticket_code',
			't.status as ticket_status',
			't.used_at',
			'o.reference as order_reference',
			'u.id as user_id',
			'u.name as passenger_name',
			'u.phone as passenger_phone',
			'u.email as passenger_email',
		])
		.where('t.convoy_id', '=', convoyId)
		.orderBy('o.created_at', 'desc')
		.execute();

	return c.json({ passengers });
});

adminRoutes.get('/payments', async (c) => {
	const db = getDB(c.env.DB);
	const statusFilter = c.req.query('status');

	let query = db
		.selectFrom('payments as p')
		.innerJoin('orders as o', 'o.id', 'p.order_id')
		.innerJoin('user as u', 'u.id', 'p.user_id')
		.select([
			'p.id',
			'p.order_id',
			'p.expected_amount_xof',
			'p.payer_phone',
			'p.proof_image_key',
			'p.wave_transaction_ref',
			'p.status',
			'p.submitted_at',
			'p.reviewed_by',
			'p.reviewed_at',
			'p.rejection_reason',
			'p.created_at',
			'o.reference as order_reference',
			'o.status as order_status',
			'u.name as client_name',
			'u.email as client_email',
			'u.phone as client_phone',
		])
		.orderBy('p.created_at', 'desc');

	if (statusFilter) {
		query = query.where('p.status', '=', statusFilter);
	}

	const payments = await query.execute();
	return c.json({ payments });
});

adminRoutes.get('/payments/:id/proof', async (c) => {
	const paymentId = c.req.param('id');
	const db = getDB(c.env.DB);

	const payment = await db
		.selectFrom('payments')
		.select(['proof_image_key'])
		.where('id', '=', paymentId)
		.executeTakeFirst();

	if (!payment || !payment.proof_image_key) {
		return c.json({ error: 'Justificatif introuvable' }, 404);
	}

	const object = await c.env.UPLOADS.get(payment.proof_image_key);
	if (!object) {
		return c.json({ error: 'Fichier justificatif introuvable dans R2' }, 404);
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('Cache-Control', 'private, max-age=300');
	return new Response(object.body, { headers });
});

adminRoutes.post('/payments/:id/confirm', requirePermission('payments:verify'), async (c) => {
	const admin = c.get('user');
	const paymentId = c.req.param('id');
	const body = await c.req
		.json<{ wave_transaction_ref?: string }>()
		.catch((): { wave_transaction_ref?: string } => ({}));

	const db = getDB(c.env.DB);
	const payment = await db
		.selectFrom('payments')
		.selectAll()
		.where('id', '=', paymentId)
		.executeTakeFirst();

	if (!payment) {
		return c.json({ error: 'Paiement introuvable' }, 404);
	}
	if (payment.status !== 'pending') {
		return c.json({ error: `Paiement déjà traité (${payment.status})` }, 409);
	}

	const waveRef = body.wave_transaction_ref?.trim() || payment.wave_transaction_ref?.trim() || null;

	if (waveRef) {
		const existingRef = await db
			.selectFrom('payments')
			.select(['id'])
			.where('wave_transaction_ref', '=', waveRef)
			.where('status', '=', 'confirmed')
			.executeTakeFirst();

		if (existingRef) {
			return c.json({ error: 'Cette référence Wave a déjà été utilisée pour un autre paiement' }, 409);
		}
	}

	const now = nowIso();
	const updateRes = await tryCatch(
		c.env.DB.prepare(
			"UPDATE payments SET status = 'confirmed', wave_transaction_ref = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
		)
			.bind(waveRef, admin.id, now, now, paymentId)
			.run(),
	);

	if (!updateRes.ok) {
		if (isUniqueConstraintError(updateRes.error)) {
			return c.json({ error: 'Cette référence Wave a déjà été utilisée' }, 409);
		}
		return c.json({ error: 'Erreur lors de la confirmation du paiement' }, 500);
	}

	if ((updateRes.data.meta?.changes ?? 0) !== 1) {
		return c.json({ error: 'Paiement déjà traité' }, 409);
	}

	const confirmNotif = buildNotificationStatements(c.env.DB, {
		userId: payment.user_id,
		type: 'payment_confirmed',
		title: 'Paiement confirmé !',
		body: 'Vos tickets et QR codes sont désormais valides et disponibles dans votre espace.',
		link: `/orders/${payment.order_id}`,
		orderId: payment.order_id,
		push: true,
		now,
	});

	await c.env.DB.batch([
		c.env.DB.prepare("UPDATE orders SET status = 'confirmed', updated_at = ? WHERE id = ?").bind(
			now,
			payment.order_id,
		),
		c.env.DB.prepare(
			"UPDATE tickets SET status = 'valid', updated_at = ? WHERE order_id = ? AND status = 'pending'",
		).bind(now, payment.order_id),
		...confirmNotif.statements,
	]);

	await writeAuditLog(db, {
		actorId: admin.id,
		action: 'payment.confirm',
		entityType: 'payment',
		entityId: paymentId,
		oldState: { status: 'pending' },
		newState: { status: 'confirmed', wave_transaction_ref: waveRef },
		metadata: { order_id: payment.order_id },
	});

	scheduleOutboxFlush(c.env, c.executionCtx, [confirmNotif.outboxId]);

	return c.json({ ok: true, status: 'confirmed', wave_transaction_ref: waveRef });
});

adminRoutes.post('/payments/:id/reject', requirePermission('payments:verify'), async (c) => {
	const admin = c.get('user');
	const paymentId = c.req.param('id');
	const body = await c.req
		.json<{ rejection_reason?: string }>()
		.catch((): { rejection_reason?: string } => ({}));
	const reason = body.rejection_reason?.trim();

	if (!reason) {
		return c.json({ error: 'Le motif du rejet est obligatoire' }, 400);
	}

	const db = getDB(c.env.DB);
	const payment = await db
		.selectFrom('payments')
		.selectAll()
		.where('id', '=', paymentId)
		.executeTakeFirst();

	if (!payment) {
		return c.json({ error: 'Paiement introuvable' }, 404);
	}
	if (payment.status !== 'pending') {
		return c.json({ error: `Paiement déjà traité (${payment.status})` }, 409);
	}

	const now = nowIso();
	const res = await c.env.DB.prepare(
		"UPDATE payments SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
	)
		.bind(reason, admin.id, now, now, paymentId)
		.run();

	if ((res.meta?.changes ?? 0) !== 1) {
		return c.json({ error: 'Paiement déjà traité' }, 409);
	}

	const rejectNotif = buildNotificationStatements(c.env.DB, {
		userId: payment.user_id,
		type: 'payment_rejected',
		title: 'Paiement rejeté',
		body: `Motif : ${reason}`,
		link: `/orders/${payment.order_id}`,
		orderId: payment.order_id,
		push: true,
		now,
	});

	await c.env.DB.batch([
		c.env.DB.prepare("UPDATE orders SET status = 'rejected', updated_at = ? WHERE id = ?").bind(
			now,
			payment.order_id,
		),
		c.env.DB.prepare(
			"UPDATE tickets SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'pending'",
		).bind(now, payment.order_id),
		...rejectNotif.statements,
	]);

	await releaseOrderReservations(c.env.DB, payment.order_id);

	await writeAuditLog(db, {
		actorId: admin.id,
		action: 'payment.reject',
		entityType: 'payment',
		entityId: paymentId,
		oldState: { status: 'pending' },
		newState: { status: 'rejected', rejection_reason: reason },
		metadata: { order_id: payment.order_id },
	});

	scheduleOutboxFlush(c.env, c.executionCtx, [rejectNotif.outboxId]);

	return c.json({ ok: true, status: 'rejected' });
});

adminRoutes.post('/tickets/scan', async (c) => {
	const admin = c.get('user');
	const body = await c.req
		.json<{ qr_token?: string; direction?: 'outbound' | 'return' }>()
		.catch((): { qr_token?: string; direction?: 'outbound' | 'return' } => ({}));
	const qrToken = body.qr_token?.trim();
	const direction = body.direction === 'return' ? 'return' : 'outbound';

	if (!qrToken) {
		return c.json({ error: 'qr_token requis' }, 400);
	}

	const now = nowIso();
	type ScannedTicket = {
		id: string;
		code: string;
		event_id: string;
		item_type: string;
		ticket_category_id: string | null;
		convoy_id: string | null;
		user_id: string;
		status: string;
		used_at: string | null;
		outbound_used_at: string | null;
		return_used_at: string | null;
	};

	const updated =
		direction === 'outbound'
			? await c.env.DB.prepare(
					`UPDATE tickets
           SET outbound_used_at = ?,
               outbound_scanned_by = ?,
               used_at = COALESCE(used_at, ?),
               scanned_by = COALESCE(scanned_by, ?),
               status = CASE WHEN item_type = 'event_ticket' OR return_used_at IS NOT NULL THEN 'used' ELSE 'valid' END,
               updated_at = ?
           WHERE qr_token = ? AND status = 'valid' AND outbound_used_at IS NULL
           RETURNING id, code, event_id, item_type, ticket_category_id, convoy_id, user_id, status, used_at, outbound_used_at, return_used_at`,
				)
					.bind(now, admin.id, now, admin.id, now, qrToken)
					.first<ScannedTicket>()
			: await c.env.DB.prepare(
					`UPDATE tickets
           SET return_used_at = ?,
               return_scanned_by = ?,
               used_at = ?,
               scanned_by = ?,
               status = CASE WHEN outbound_used_at IS NOT NULL THEN 'used' ELSE 'valid' END,
               updated_at = ?
           WHERE qr_token = ? AND item_type = 'convoy_ticket' AND status = 'valid' AND return_used_at IS NULL
           RETURNING id, code, event_id, item_type, ticket_category_id, convoy_id, user_id, status, used_at, outbound_used_at, return_used_at`,
				)
					.bind(now, admin.id, now, admin.id, now, qrToken)
					.first<ScannedTicket>();

	const db = getDB(c.env.DB);

	if (updated) {
		await writeAuditLog(db, {
			actorId: admin.id,
			action: `ticket.scan.${direction}`,
			entityType: 'ticket',
			entityId: updated.id,
			oldState: { status: 'valid' },
			newState: {
				status: updated.status,
				outbound_used_at: updated.outbound_used_at,
				return_used_at: updated.return_used_at,
			},
		});

		const message =
			updated.item_type === 'event_ticket'
				? 'Ticket valide — accès autorisé'
				: direction === 'outbound'
					? 'Aller validé (1/2)'
					: 'Retour validé (2/2)';

		const scanSignal = buildRealtimeSignalStatement(c.env.DB, {
			userId: updated.user_id,
			type: 'ticket_scanned',
			title: message,
			body: `Billet ${updated.code}`,
			link: '/tickets',
			ticketId: updated.id,
			now,
		});
		await tryCatch(scanSignal.statement.run());
		scheduleOutboxFlush(c.env, c.executionCtx, [scanSignal.outboxId]);

		return c.json({
			result: 'valid',
			direction,
			message,
			ticket: updated,
		});
	}

	const existing = await db
		.selectFrom('tickets')
		.select(['id', 'code', 'item_type', 'status', 'used_at', 'outbound_used_at', 'return_used_at'])
		.where('qr_token', '=', qrToken)
		.executeTakeFirst();

	if (!existing || existing.status === 'cancelled') {
		return c.json({ result: 'invalid', message: 'Ticket inexistant ou annulé' }, 404);
	}
	if (existing.status === 'pending') {
		return c.json({ result: 'pending', message: 'Paiement non confirmé', ticket: existing }, 409);
	}
	if (direction === 'return' && existing.item_type !== 'convoy_ticket') {
		return c.json(
			{
				result: 'invalid',
				message: 'Ce billet est un ticket événement (scan unique en mode Aller)',
				ticket: existing,
			},
			409,
		);
	}
	return c.json(
		{
			result: 'already_used',
			message:
				existing.item_type === 'convoy_ticket'
					? direction === 'outbound'
						? 'Trajet Aller déjà scanné'
						: 'Trajet Retour déjà scanné'
					: 'Ticket déjà utilisé',
			ticket: existing,
		},
		409,
	);
});
