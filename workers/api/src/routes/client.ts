import { Hono } from 'hono';
import { getDB } from 'db';
import { requireAuth } from '../middleware/auth';
import {
	addHoursIso,
	createNotification,
	generateOrderReference,
	generateTicketCode,
	nowIso,
} from '../lib/utils';
import type { AppEnv } from '../types';

export const clientRoutes = new Hono<AppEnv>();

clientRoutes.use('*', requireAuth);

clientRoutes.patch('/me', async (c) => {
	const user = c.get('user');
	const body = await c.req
		.json<{ name?: string; phone?: string | null }>()
		.catch((): { name?: string; phone?: string | null } => ({}));
	const db = getDB(c.env.DB);

	const updates: { name?: string; phone?: string | null; updatedAt: string } = {
		updatedAt: nowIso(),
	};

	if (typeof body.name === 'string' && body.name.trim().length > 0) {
		updates.name = body.name.trim();
	}
	if (body.phone !== undefined) {
		const trimmed = typeof body.phone === 'string' ? body.phone.trim() : null;
		updates.phone = trimmed && trimmed.length > 0 ? trimmed : null;
	}

	try {
		await db.updateTable('user').set(updates).where('id', '=', user.id).execute();
		const updated = await db
			.selectFrom('user')
			.select(['id', 'name', 'email', 'phone', 'role', 'permissions', 'is_active'])
			.where('id', '=', user.id)
			.executeTakeFirst();
		return c.json({ user: updated });
	} catch (err: any) {
		if (String(err?.message ?? err).includes('UNIQUE')) {
			return c.json({ error: 'Ce numéro de téléphone est déjà utilisé' }, 409);
		}
		throw err;
	}
});

interface CreateOrderItemInput {
	type: 'ticket_category' | 'convoy';
	id: string;
	quantity: number;
}

clientRoutes.post('/orders', async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{ items?: CreateOrderItemInput[] }>().catch(() => ({ items: [] }));

	if (!Array.isArray(body.items) || body.items.length === 0) {
		return c.json({ error: 'La commande doit contenir au moins un article' }, 400);
	}

	// Agréger les doublons d'articles dans la requête
	const mergedMap = new Map<string, CreateOrderItemInput>();
	for (const raw of body.items) {
		if (
			(raw?.type !== 'ticket_category' && raw?.type !== 'convoy') ||
			typeof raw.id !== 'string' ||
			!Number.isInteger(raw.quantity) ||
			raw.quantity < 1 ||
			raw.quantity > 50
		) {
			return c.json({ error: 'Article ou quantité invalide' }, 400);
		}
		const key = `${raw.type}:${raw.id}`;
		const existing = mergedMap.get(key);
		if (existing) {
			existing.quantity += raw.quantity;
		} else {
			mergedMap.set(key, { ...raw });
		}
	}

	const items = Array.from(mergedMap.values());
	const db = getDB(c.env.DB);
	const now = nowIso();

	// Charger et valider les articles & événements associés
	type ResolvedItem = {
		type: 'ticket_category' | 'convoy';
		id: string;
		eventId: string;
		quantity: number;
		unitPriceXof: number;
		wavePaymentUrl: string | null;
	};
	const resolved: ResolvedItem[] = [];

	for (const item of items) {
		if (item.type === 'ticket_category') {
			const row = await db
				.selectFrom('ticket_categories as tc')
				.innerJoin('events as e', 'e.id', 'tc.event_id')
				.select([
					'tc.id',
					'tc.event_id',
					'tc.price_xof',
					'tc.capacity',
					'tc.reserved_count',
					'e.status as event_status',
					'e.sales_start_at',
					'e.sales_end_at',
					'e.wave_payment_url',
				])
				.where('tc.id', '=', item.id)
				.executeTakeFirst();

			if (!row || row.event_status !== 'published') {
				return c.json({ error: 'Catégorie de ticket indisponible' }, 404);
			}
			if (row.sales_start_at && now < row.sales_start_at) {
				return c.json({ error: 'La vente pour cet événement n’a pas encore commencé' }, 400);
			}
			if (row.sales_end_at && now > row.sales_end_at) {
				return c.json({ error: 'La période de vente pour cet événement est terminée' }, 400);
			}
			resolved.push({
				type: 'ticket_category',
				id: row.id,
				eventId: row.event_id,
				quantity: item.quantity,
				unitPriceXof: row.price_xof,
				wavePaymentUrl: row.wave_payment_url,
			});
		} else {
			const row = await db
				.selectFrom('convoys as cv')
				.innerJoin('events as e', 'e.id', 'cv.event_id')
				.select([
					'cv.id',
					'cv.event_id',
					'cv.price_xof',
					'cv.status as convoy_status',
					'e.status as event_status',
					'e.wave_payment_url',
				])
				.where('cv.id', '=', item.id)
				.executeTakeFirst();

			if (!row || row.convoy_status !== 'published' || row.event_status !== 'published') {
				return c.json({ error: 'Convoi indisponible' }, 404);
			}
			resolved.push({
				type: 'convoy',
				id: row.id,
				eventId: row.event_id,
				quantity: item.quantity,
				unitPriceXof: row.price_xof,
				wavePaymentUrl: row.wave_payment_url,
			});
		}
	}

	// Réservation atomique des places
	const reserveStatements = resolved.map((item) => {
		if (item.type === 'ticket_category') {
			return c.env.DB.prepare(
				'UPDATE ticket_categories SET reserved_count = reserved_count + ?, updated_at = ? WHERE id = ? AND reserved_count + ? <= capacity',
			).bind(item.quantity, now, item.id, item.quantity);
		}
		return c.env.DB.prepare(
			'UPDATE convoys SET reserved_count = reserved_count + ?, updated_at = ? WHERE id = ? AND reserved_count + ? <= capacity',
		).bind(item.quantity, now, item.id, item.quantity);
	});

	const reserveResults = await c.env.DB.batch(reserveStatements);
	const failedIdx = reserveResults.findIndex((r) => (r.meta?.changes ?? 0) !== 1);

	if (failedIdx !== -1) {
		// Compensation des réservations qui avaient réussi dans ce batch
		const rollbackStatements: D1PreparedStatement[] = [];
		reserveResults.forEach((r, idx) => {
			if ((r.meta?.changes ?? 0) === 1) {
				const item = resolved[idx];
				if (item.type === 'ticket_category') {
					rollbackStatements.push(
						c.env.DB.prepare(
							'UPDATE ticket_categories SET reserved_count = MAX(0, reserved_count - ?) WHERE id = ?',
						).bind(item.quantity, item.id),
					);
				} else {
					rollbackStatements.push(
						c.env.DB.prepare(
							'UPDATE convoys SET reserved_count = MAX(0, reserved_count - ?) WHERE id = ?',
						).bind(item.quantity, item.id),
					);
				}
			}
		});
		if (rollbackStatements.length > 0) {
			await c.env.DB.batch(rollbackStatements);
		}
		return c.json({ error: 'Stock insuffisant pour un ou plusieurs articles' }, 409);
	}

	const orderId = crypto.randomUUID();
	const reference = generateOrderReference();
	const expiresAt = addHoursIso(now, 2);
	const totalAmountXof = resolved.reduce((acc, i) => acc + i.unitPriceXof * i.quantity, 0);
	const paymentId = crypto.randomUUID();

	const insertStatements: D1PreparedStatement[] = [
		c.env.DB.prepare(
			`INSERT INTO orders (id, reference, user_id, total_amount_xof, status, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending_payment', ?, ?, ?)`,
		).bind(orderId, reference, user.id, totalAmountXof, expiresAt, now, now),
		c.env.DB.prepare(
			`INSERT INTO payments (id, order_id, user_id, expected_amount_xof, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
		).bind(paymentId, orderId, user.id, totalAmountXof, now, now),
	];

	for (const item of resolved) {
		const orderItemId = crypto.randomUUID();
		const subtotal = item.unitPriceXof * item.quantity;

		insertStatements.push(
			c.env.DB.prepare(
				`INSERT INTO order_items (id, order_id, item_type, ticket_category_id, convoy_id, quantity, unit_price_xof, subtotal_xof)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			).bind(
				orderItemId,
				orderId,
				item.type,
				item.type === 'ticket_category' ? item.id : null,
				item.type === 'convoy' ? item.id : null,
				item.quantity,
				item.unitPriceXof,
				subtotal,
			),
		);

		for (let i = 0; i < item.quantity; i++) {
			insertStatements.push(
				c.env.DB.prepare(
					`INSERT INTO tickets (id, code, qr_token, order_id, order_item_id, user_id, event_id, item_type, ticket_category_id, convoy_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
				).bind(
					crypto.randomUUID(),
					generateTicketCode(),
					crypto.randomUUID(),
					orderId,
					orderItemId,
					user.id,
					item.eventId,
					item.type === 'ticket_category' ? 'event_ticket' : 'convoy_ticket',
					item.type === 'ticket_category' ? item.id : null,
					item.type === 'convoy' ? item.id : null,
					now,
					now,
				),
			);
		}
	}

	await c.env.DB.batch(insertStatements);

	await createNotification(db, {
		userId: user.id,
		type: 'order_created',
		title: `Commande ${reference} créée`,
		body: `Montant à régler : ${totalAmountXof} FCFA avant le ${expiresAt}.`,
		link: `/orders/${orderId}`,
	});

	const waveLinks = Array.from(
		new Set(resolved.map((r) => r.wavePaymentUrl).filter((u): u is string => Boolean(u))),
	);

	return c.json(
		{
			order: {
				id: orderId,
				reference,
				total_amount_xof: totalAmountXof,
				status: 'pending_payment',
				expires_at: expiresAt,
				created_at: now,
			},
			payment: {
				id: paymentId,
				expected_amount_xof: totalAmountXof,
				status: 'pending',
				wave_payment_urls: waveLinks,
			},
		},
		201,
	);
});

clientRoutes.get('/orders', async (c) => {
	const user = c.get('user');
	const db = getDB(c.env.DB);

	const orders = await db
		.selectFrom('orders')
		.selectAll()
		.where('user_id', '=', user.id)
		.orderBy('created_at', 'desc')
		.execute();

	return c.json({ orders });
});

clientRoutes.get('/orders/:id', async (c) => {
	const user = c.get('user');
	const orderId = c.req.param('id');
	const db = getDB(c.env.DB);

	const order = await db
		.selectFrom('orders')
		.selectAll()
		.where('id', '=', orderId)
		.where('user_id', '=', user.id)
		.executeTakeFirst();

	if (!order) {
		return c.json({ error: 'Commande introuvable' }, 404);
	}

	const [items, payment, tickets] = await Promise.all([
		db.selectFrom('order_items').selectAll().where('order_id', '=', orderId).execute(),
		db.selectFrom('payments').selectAll().where('order_id', '=', orderId).executeTakeFirst(),
		db
			.selectFrom('tickets')
			.select([
				'id',
				'code',
				'qr_token',
				'event_id',
				'item_type',
				'ticket_category_id',
				'convoy_id',
				'status',
				'used_at',
			])
			.where('order_id', '=', orderId)
			.execute(),
	]);

	return c.json({
		order,
		items,
		payment: payment ?? null,
		tickets: tickets.map((t) => ({
			...t,
			qr_token: t.status === 'valid' ? t.qr_token : null,
		})),
	});
});

const ALLOWED_PROOF_MIME: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
};
const MAX_PROOF_BYTES = 5 * 1024 * 1024;

clientRoutes.post('/orders/:id/proof', async (c) => {
	const user = c.get('user');
	const orderId = c.req.param('id');
	const db = getDB(c.env.DB);

	const order = await db
		.selectFrom('orders')
		.selectAll()
		.where('id', '=', orderId)
		.where('user_id', '=', user.id)
		.executeTakeFirst();

	if (!order) {
		return c.json({ error: 'Commande introuvable' }, 404);
	}

	const now = nowIso();
	if (order.status !== 'pending_payment') {
		return c.json(
			{ error: `Impossible d'envoyer un justificatif pour une commande au statut ${order.status}` },
			409,
		);
	}
	if (order.expires_at <= now) {
		return c.json({ error: 'Cette commande a expiré' }, 410);
	}

	const formData = await c.req.formData().catch(() => null);
	if (!formData) {
		return c.json({ error: 'Requête multipart invalide' }, 400);
	}

	const file = formData.get('file');
	if (!file || !(file instanceof File)) {
		return c.json({ error: 'Le fichier justificatif (champ "file") est requis' }, 400);
	}

	const ext = ALLOWED_PROOF_MIME[file.type];
	if (!ext) {
		return c.json({ error: 'Format non supporté (JPEG, PNG ou WebP uniquement)' }, 400);
	}
	if (file.size <= 0 || file.size > MAX_PROOF_BYTES) {
		return c.json({ error: 'Taille du fichier invalide (max 5 Mo)' }, 400);
	}

	const rawPhone = formData.get('payer_phone');
	const payerPhone = typeof rawPhone === 'string' && rawPhone.trim() ? rawPhone.trim() : user.phone ?? null;

	const key = `proofs/${orderId}/${crypto.randomUUID()}.${ext}`;
	await c.env.UPLOADS.put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type },
	});

	// Transition atomique vers under_review pour geler l'expiration
	const res = await c.env.DB.prepare(
		"UPDATE orders SET status = 'under_review', updated_at = ? WHERE id = ? AND status = 'pending_payment' AND expires_at > ?",
	)
		.bind(now, orderId, now)
		.run();

	if ((res.meta?.changes ?? 0) !== 1) {
		await c.env.UPLOADS.delete(key);
		return c.json({ error: 'La commande a expiré ou a déjà été traitée' }, 409);
	}

	await db
		.updateTable('payments')
		.set({
			proof_image_key: key,
			payer_phone: payerPhone,
			submitted_at: now,
			updated_at: now,
		})
		.where('order_id', '=', orderId)
		.execute();

	await createNotification(db, {
		userId: user.id,
		type: 'proof_submitted',
		title: `Justificatif reçu (${order.reference})`,
		body: 'Votre justificatif Wave est en cours de vérification par un administrateur.',
		link: `/orders/${orderId}`,
	});

	return c.json({ ok: true, status: 'under_review', proof_image_key: key });
});

clientRoutes.get('/tickets', async (c) => {
	const user = c.get('user');
	const db = getDB(c.env.DB);

	const tickets = await db
		.selectFrom('tickets as t')
		.innerJoin('events as e', 'e.id', 't.event_id')
		.leftJoin('ticket_categories as tc', 'tc.id', 't.ticket_category_id')
		.leftJoin('convoys as cv', 'cv.id', 't.convoy_id')
		.select([
			't.id',
			't.code',
			't.qr_token',
			't.order_id',
			't.item_type',
			't.status',
			't.used_at',
			't.created_at',
			'e.title as event_title',
			'e.starts_at as event_starts_at',
			'e.venue as event_venue',
			'tc.name as category_name',
			'cv.name as convoy_name',
			'cv.departure_at as convoy_departure_at',
			'cv.meeting_point as convoy_meeting_point',
		])
		.where('t.user_id', '=', user.id)
		.orderBy('t.created_at', 'desc')
		.execute();

	return c.json({
		tickets: tickets.map((t) => ({
			...t,
			qr_token: t.status === 'valid' ? t.qr_token : null,
		})),
	});
});

clientRoutes.get('/notifications', async (c) => {
	const user = c.get('user');
	const db = getDB(c.env.DB);

	const notifications = await db
		.selectFrom('notifications')
		.selectAll()
		.where('user_id', '=', user.id)
		.orderBy('created_at', 'desc')
		.limit(50)
		.execute();

	return c.json({ notifications });
});

clientRoutes.patch('/notifications/:id/read', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const db = getDB(c.env.DB);

	await db
		.updateTable('notifications')
		.set({ is_read: 1 })
		.where('id', '=', id)
		.where('user_id', '=', user.id)
		.execute();

	return c.json({ ok: true });
});
