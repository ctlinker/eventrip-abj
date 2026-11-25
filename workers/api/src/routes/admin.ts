import { Hono } from 'hono';
import { getDB } from 'db';
import { isUniqueConstraintError, tryCatch } from 'utils';
import { requireAdmin, requireAuth, requirePermission } from '../middleware/auth';
import { createNotification, nowIso, slugify, writeAuditLog } from '../lib/utils';
import { releaseOrderReservations } from '../services/orders';
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

adminRoutes.get('/events', async (c) => {
	const db = getDB(c.env.DB);
	const events = await db.selectFrom('events').selectAll().orderBy('created_at', 'desc').execute();
	const categories = events.length
		? await db.selectFrom('ticket_categories').selectAll().execute()
		: [];
	const convoys = events.length ? await db.selectFrom('convoys').selectAll().execute() : [];

	return c.json({
		default_wave_merchant_id: c.env.WAVE_MERCHANT_ID,
		events: events.map((ev) => ({
			...ev,
			categories: categories.filter((cat) => cat.event_id === ev.id),
			convoys: convoys.filter((cv) => cv.event_id === ev.id),
		})),
	});
});

adminRoutes.post('/events', async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{
		title?: string;
		slug?: string;
		description?: string;
		starts_at?: string;
		ends_at?: string | null;
		venue?: string;
		extra_info?: string | null;
		wave_payment_url?: string | null;
		sales_start_at?: string | null;
		sales_end_at?: string | null;
		status?: 'draft' | 'published' | 'archived';
	}>();

	if (!body.title || !body.description || !body.starts_at || !body.venue) {
		return c.json({ error: 'Champs requis : title, description, starts_at, venue' }, 400);
	}

	const id = crypto.randomUUID();
	const now = nowIso();
	const baseSlug = slugify(body.slug || body.title) || id.slice(0, 8);
	const slug = `${baseSlug}-${id.slice(0, 4)}`;
	const db = getDB(c.env.DB);

	await db
		.insertInto('events')
		.values({
			id,
			slug,
			title: body.title.trim(),
			description: body.description,
			poster_key: null,
			starts_at: body.starts_at,
			ends_at: body.ends_at ?? null,
			venue: body.venue.trim(),
			extra_info: body.extra_info ?? null,
			wave_payment_url: body.wave_payment_url ?? null,
			sales_start_at: body.sales_start_at ?? null,
			sales_end_at: body.sales_end_at ?? null,
			status: body.status ?? 'draft',
			created_by: user.id,
			created_at: now,
			updated_at: now,
		})
		.execute();

	const event = await db.selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst();
	return c.json({ event }, 201);
});

adminRoutes.patch('/events/:id', async (c) => {
	const id = c.req.param('id');
	const body = await c.req
		.json<Record<string, unknown>>()
		.catch((): Record<string, unknown> => ({}));
	const db = getDB(c.env.DB);

	const allowedFields = [
		'title',
		'description',
		'starts_at',
		'ends_at',
		'venue',
		'extra_info',
		'wave_payment_url',
		'sales_start_at',
		'sales_end_at',
		'status',
	] as const;

	const updates: Record<string, unknown> = { updated_at: nowIso() };
	for (const field of allowedFields) {
		if (field in body) {
			updates[field] = body[field];
		}
	}

	await db.updateTable('events').set(updates).where('id', '=', id).execute();
	const event = await db.selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst();
	if (!event) return c.json({ error: 'Événement introuvable' }, 404);
	return c.json({ event });
});

adminRoutes.post('/events/:id/poster', async (c) => {
	const id = c.req.param('id');
	const db = getDB(c.env.DB);
	const event = await db.selectFrom('events').select(['id']).where('id', '=', id).executeTakeFirst();
	if (!event) return c.json({ error: 'Événement introuvable' }, 404);

	const formRes = await tryCatch(c.req.formData());
	const formData = formRes.ok ? formRes.data : null;
	const file = formData?.get('file');
	if (!file || !(file instanceof File)) {
		return c.json({ error: 'Champ "file" requis' }, 400);
	}

	const mimeMap: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
	};
	const ext = mimeMap[file.type];
	if (!ext || file.size > 5 * 1024 * 1024) {
		return c.json({ error: 'Image JPEG/PNG/WebP <= 5 Mo requise' }, 400);
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

	await db
		.updateTable('events')
		.set({ poster_key: key, updated_at: nowIso() })
		.where('id', '=', id)
		.execute();

	return c.json({ ok: true, poster_key: key });
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
	const body = await c.req.json<{
		name?: string;
		departure_at?: string;
		meeting_point?: string;
		destination?: string;
		trip_type?: 'one_way' | 'round_trip';
		price_xof?: number;
		capacity?: number;
		extra_info?: string | null;
	}>();

	if (
		!body.name ||
		!body.departure_at ||
		!body.meeting_point ||
		!body.destination ||
		(body.trip_type !== 'one_way' && body.trip_type !== 'round_trip') ||
		!Number.isInteger(body.price_xof) ||
		!Number.isInteger(body.capacity)
	) {
		return c.json({ error: 'Paramètres de convoi invalides' }, 400);
	}

	const id = crypto.randomUUID();
	const now = nowIso();
	const db = getDB(c.env.DB);

	await db
		.insertInto('convoys')
		.values({
			id,
			event_id: eventId,
			name: body.name.trim(),
			departure_at: body.departure_at,
			meeting_point: body.meeting_point.trim(),
			destination: body.destination.trim(),
			trip_type: body.trip_type,
			price_xof: body.price_xof!,
			capacity: body.capacity!,
			reserved_count: 0,
			extra_info: body.extra_info ?? null,
			status: 'published',
			created_at: now,
			updated_at: now,
		})
		.execute();

	const convoy = await db.selectFrom('convoys').selectAll().where('id', '=', id).executeTakeFirst();
	return c.json({ convoy }, 201);
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
	const waveRef = body.wave_transaction_ref?.trim();

	if (!waveRef) {
		return c.json({ error: 'La référence de transaction Wave est obligatoire' }, 400);
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

	const existingRef = await db
		.selectFrom('payments')
		.select(['id'])
		.where('wave_transaction_ref', '=', waveRef)
		.where('status', '=', 'confirmed')
		.executeTakeFirst();

	if (existingRef) {
		return c.json({ error: 'Cette référence Wave a déjà été utilisée pour un autre paiement' }, 409);
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

	await c.env.DB.batch([
		c.env.DB.prepare("UPDATE orders SET status = 'confirmed', updated_at = ? WHERE id = ?").bind(
			now,
			payment.order_id,
		),
		c.env.DB.prepare(
			"UPDATE tickets SET status = 'valid', updated_at = ? WHERE order_id = ? AND status = 'pending'",
		).bind(now, payment.order_id),
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

	await createNotification(db, {
		userId: payment.user_id,
		type: 'payment_confirmed',
		title: 'Paiement confirmé !',
		body: 'Vos tickets et QR codes sont désormais valides et disponibles dans votre espace.',
		link: `/orders/${payment.order_id}`,
	});

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

	await c.env.DB.batch([
		c.env.DB.prepare("UPDATE orders SET status = 'rejected', updated_at = ? WHERE id = ?").bind(
			now,
			payment.order_id,
		),
		c.env.DB.prepare(
			"UPDATE tickets SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'pending'",
		).bind(now, payment.order_id),
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

	await createNotification(db, {
		userId: payment.user_id,
		type: 'payment_rejected',
		title: 'Paiement rejeté',
		body: `Motif : ${reason}`,
		link: `/orders/${payment.order_id}`,
	});

	return c.json({ ok: true, status: 'rejected' });
});

adminRoutes.post('/tickets/scan', async (c) => {
	const admin = c.get('user');
	const body = await c.req
		.json<{ qr_token?: string }>()
		.catch((): { qr_token?: string } => ({}));
	const qrToken = body.qr_token?.trim();

	if (!qrToken) {
		return c.json({ error: 'qr_token requis' }, 400);
	}

	const now = nowIso();
	const updated = await c.env.DB.prepare(
		"UPDATE tickets SET status = 'used', used_at = ?, scanned_by = ?, updated_at = ? WHERE qr_token = ? AND status = 'valid' RETURNING id, code, event_id, item_type, ticket_category_id, convoy_id, user_id, used_at",
	)
		.bind(now, admin.id, now, qrToken)
		.first<{
			id: string;
			code: string;
			event_id: string;
			item_type: string;
			ticket_category_id: string | null;
			convoy_id: string | null;
			user_id: string;
			used_at: string;
		}>();

	const db = getDB(c.env.DB);

	if (updated) {
		await writeAuditLog(db, {
			actorId: admin.id,
			action: 'ticket.scan',
			entityType: 'ticket',
			entityId: updated.id,
			oldState: { status: 'valid' },
			newState: { status: 'used', used_at: updated.used_at },
		});

		return c.json({
			result: 'valid',
			message: 'Ticket valide — accès autorisé',
			ticket: updated,
		});
	}

	const existing = await db
		.selectFrom('tickets')
		.select(['id', 'code', 'status', 'used_at'])
		.where('qr_token', '=', qrToken)
		.executeTakeFirst();

	if (!existing || existing.status === 'cancelled') {
		return c.json({ result: 'invalid', message: 'Ticket inexistant ou annulé' }, 404);
	}
	if (existing.status === 'pending') {
		return c.json({ result: 'pending', message: 'Paiement non confirmé', ticket: existing }, 409);
	}
	return c.json(
		{
			result: 'already_used',
			message: 'Ticket déjà utilisé',
			ticket: existing,
		},
		409,
	);
});
