import { Hono } from 'hono';
import { getDB } from 'db';
import { isUniqueConstraintError, tryCatch } from 'utils';
import { requireAuth } from '../middleware/auth';
import {
	addHoursIso,
	buildWavePaymentUrl,
	createNotification,
	generateOrderReference,
	generateTicketCode,
	nowIso,
	parsePosterKeys,
} from '../lib/utils';
import {
	buildNotificationStatements,
	listPaymentVerifierIds,
	scheduleOutboxFlush,
} from '../services/notifications';
import type { AppEnv } from '../types';

export const clientRoutes = new Hono<AppEnv>();

clientRoutes.use('*', requireAuth);

clientRoutes.patch('/me', async (c) => {
	const user = c.get('user');
	const parsed = await tryCatch(
		c.req.json<{ name?: string; phone?: string | null; commune?: string | null }>(),
	);
	const body = parsed.ok ? parsed.data : {};
	const db = getDB(c.env.DB);

	const updates: { name?: string; phone?: string | null; commune?: string | null; updatedAt: string } = {
		updatedAt: nowIso(),
	};

	if (typeof body.name === 'string' && body.name.trim().length > 0) {
		updates.name = body.name.trim();
	}
	if (body.phone !== undefined) {
		const trimmed = typeof body.phone === 'string' ? body.phone.trim() : null;
		updates.phone = trimmed && trimmed.length > 0 ? trimmed : null;
	}
	if (body.commune !== undefined) {
		const trimmed = typeof body.commune === 'string' ? body.commune.trim() : null;
		updates.commune = trimmed && trimmed.length > 0 ? trimmed : null;
	}

	const updateRes = await tryCatch(
		db.updateTable('user').set(updates).where('id', '=', user.id).execute(),
	);
	if (!updateRes.ok) {
		if (isUniqueConstraintError(updateRes.error)) {
			return c.json({ error: 'Ce numéro de téléphone est déjà utilisé' }, 409);
		}
		return c.json({ error: 'Impossible de mettre à jour le profil' }, 500);
	}

	const updated = await db
		.selectFrom('user')
		.select(['id', 'name', 'email', 'phone', 'commune', 'role', 'permissions', 'is_active'])
		.where('id', '=', user.id)
		.executeTakeFirst();
	return c.json({ user: updated });
});

interface CreateOrderItemInput {
	type: 'ticket_category' | 'convoy';
	id: string;
	quantity: number;
}

clientRoutes.post('/orders', async (c) => {
	const user = c.get('user');
	const bodyRes = await tryCatch(
		c.req.json<{
			items?: CreateOrderItemInput[];
			convoy_id?: string;
			quantity?: number;
		}>(),
	);
	const body = bodyRes.ok ? bodyRes.data : {};

	const rawItems: CreateOrderItemInput[] = Array.isArray(body.items) && body.items.length > 0
		? body.items
		: typeof body.convoy_id === 'string' && Number.isInteger(body.quantity)
			? [{ type: 'convoy', id: body.convoy_id, quantity: body.quantity! }]
			: [];

	if (rawItems.length === 0) {
		return c.json({ error: 'La commande doit contenir un départ et une quantité' }, 400);
	}

	// Agréger les doublons d'articles dans la requête
	const mergedMap = new Map<string, CreateOrderItemInput>();
	for (const raw of rawItems) {
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
					'cv.price_xof as convoy_price_xof',
					'cv.status as convoy_status',
					'e.price_xof as event_price_xof',
					'e.status as event_status',
					'e.sales_start_at',
					'e.sales_end_at',
					'e.wave_payment_url',
				])
				.where('cv.id', '=', item.id)
				.executeTakeFirst();

			if (!row || row.convoy_status !== 'published' || row.event_status !== 'published') {
				return c.json({ error: 'Départ indisponible' }, 404);
			}
			if (row.sales_start_at && now < row.sales_start_at) {
				return c.json({ error: 'La vente pour cet événement n’a pas encore commencé' }, 400);
			}
			if (row.sales_end_at && now > row.sales_end_at) {
				return c.json({ error: 'La période de vente pour cet événement est terminée' }, 400);
			}
			resolved.push({
				type: 'convoy',
				id: row.id,
				eventId: row.event_id,
				quantity: item.quantity,
				unitPriceXof: row.event_price_xof > 0 ? row.event_price_xof : row.convoy_price_xof,
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

	const orderNotif = buildNotificationStatements(c.env.DB, {
		userId: user.id,
		type: 'order_created',
		title: `Commande ${reference} créée`,
		body: `Montant à régler : ${totalAmountXof} FCFA avant le ${expiresAt}.`,
		link: `/orders/${orderId}`,
		orderId,
		push: false,
		now,
	});
	insertStatements.push(...orderNotif.statements);

	await c.env.DB.batch(insertStatements);
	scheduleOutboxFlush(c.env, c.executionCtx, [orderNotif.outboxId]);

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

	if (orders.length === 0) {
		return c.json({ orders: [] });
	}

	const orderIds = orders.map((o) => o.id);
	const ticketMeta = await db
		.selectFrom('tickets as t')
		.innerJoin('events as e', 'e.id', 't.event_id')
		.leftJoin('convoys as cv', 'cv.id', 't.convoy_id')
		.select([
			't.order_id',
			'e.title as event_title',
			'e.slug as event_slug',
			'cv.commune as convoy_commune',
			'cv.meeting_point as convoy_meeting_point',
		])
		.where('t.order_id', 'in', orderIds)
		.execute();

	const metaByOrder = new Map<
		string,
		{
			event_title: string;
			event_slug: string;
			convoy_commune: string | null;
			convoy_meeting_point: string | null;
			ticket_count: number;
		}
	>();
	for (const row of ticketMeta) {
		const existing = metaByOrder.get(row.order_id);
		if (!existing) {
			metaByOrder.set(row.order_id, {
				event_title: row.event_title,
				event_slug: row.event_slug,
				convoy_commune: row.convoy_commune ?? null,
				convoy_meeting_point: row.convoy_meeting_point ?? null,
				ticket_count: 1,
			});
		} else {
			existing.ticket_count += 1;
		}
	}

	return c.json({
		orders: orders.map((o) => {
			const meta = metaByOrder.get(o.id);
			return {
				...o,
				event_title: meta?.event_title ?? null,
				event_slug: meta?.event_slug ?? null,
				convoy_commune: meta?.convoy_commune ?? null,
				convoy_meeting_point: meta?.convoy_meeting_point ?? null,
				ticket_count: meta?.ticket_count ?? 0,
			};
		}),
	});
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

	let eventInfo: {
		id: string;
		title: string;
		slug: string;
		venue: string;
		starts_at: string;
		wave_payment_url: string | null;
	} | null = null;
	if (tickets.length > 0) {
		const ev = await db
			.selectFrom('events')
			.select(['id', 'title', 'slug', 'venue', 'starts_at', 'wave_payment_url'])
			.where('id', '=', tickets[0].event_id)
			.executeTakeFirst();
		if (ev) eventInfo = ev;
	}

	const convoyIds = items
		.map((i) => i.convoy_id)
		.filter((id): id is string => Boolean(id));
	const convoysList = convoyIds.length
		? await db
				.selectFrom('convoys')
				.select(['id', 'commune', 'meeting_point', 'name'])
				.where('id', 'in', convoyIds)
				.execute()
		: [];
	const convoyMap = new Map(convoysList.map((cv) => [cv.id, cv]));

	const wavePaymentUrl = buildWavePaymentUrl(
		eventInfo?.wave_payment_url ?? null,
		order.total_amount_xof,
		c.env.WAVE_MERCHANT_ID,
	);

	return c.json({
		order,
		event: eventInfo
			? {
					id: eventInfo.id,
					title: eventInfo.title,
					slug: eventInfo.slug,
					venue: eventInfo.venue,
					starts_at: eventInfo.starts_at,
				}
			: null,
		items: items.map((item) => {
			const cv = item.convoy_id ? convoyMap.get(item.convoy_id) : undefined;
			return {
				...item,
				convoy_commune: cv?.commune || cv?.name || null,
				convoy_meeting_point: cv?.meeting_point ?? null,
			};
		}),
		payment: payment ? { ...payment, wave_payment_url: wavePaymentUrl } : null,
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

	const contentType = c.req.header('content-type') || '';
	let file: File | null = null;
	let payerPhone: string | null = user.phone ?? null;
	let waveRef: string | null = null;

	if (contentType.includes('application/json')) {
		const jsonRes = await tryCatch(
			c.req.json<{ payer_phone?: string; wave_transaction_ref?: string }>(),
		);
		if (!jsonRes.ok) {
			return c.json({ error: 'Corps JSON invalide' }, 400);
		}
		if (jsonRes.data.payer_phone?.trim()) payerPhone = jsonRes.data.payer_phone.trim();
		if (jsonRes.data.wave_transaction_ref?.trim()) {
			waveRef = jsonRes.data.wave_transaction_ref.trim();
		}
	} else {
		const formRes = await tryCatch(c.req.formData());
		const formData = formRes.ok ? formRes.data : null;
		if (!formData) {
			return c.json({ error: 'Requête multipart ou JSON invalide' }, 400);
		}
		const rawFile = formData.get('file');
		if (rawFile && rawFile instanceof File && rawFile.size > 0) {
			file = rawFile;
		}
		const rawPhone = formData.get('payer_phone');
		if (typeof rawPhone === 'string' && rawPhone.trim()) {
			payerPhone = rawPhone.trim();
		}
		const rawRef = formData.get('wave_transaction_ref');
		if (typeof rawRef === 'string' && rawRef.trim()) {
			waveRef = rawRef.trim();
		}
	}

	if (!file && !waveRef) {
		return c.json(
			{ error: 'Veuillez fournir une capture d’écran ou un ID de transaction Wave' },
			400,
		);
	}

	if (waveRef) {
		const alreadyConfirmed = await db
			.selectFrom('payments')
			.select(['id'])
			.where('wave_transaction_ref', '=', waveRef)
			.where('status', '=', 'confirmed')
			.executeTakeFirst();
		if (alreadyConfirmed) {
			return c.json(
				{ error: 'Cet ID de transaction Wave a déjà été utilisé pour un autre paiement' },
				409,
			);
		}
	}

	let key: string | null = null;
	if (file) {
		const ext = ALLOWED_PROOF_MIME[file.type];
		if (!ext) {
			return c.json({ error: 'Format non supporté (JPEG, PNG ou WebP uniquement)' }, 400);
		}
		if (file.size > MAX_PROOF_BYTES) {
			return c.json({ error: 'Taille du fichier invalide (max 5 Mo)' }, 400);
		}

		key = `proofs/${orderId}/${crypto.randomUUID()}.${ext}`;
		const putRes = await tryCatch(
			c.env.UPLOADS.put(key, await file.arrayBuffer(), {
				httpMetadata: { contentType: file.type },
			}),
		);
		if (!putRes.ok) {
			return c.json({ error: 'Échec du téléversement du justificatif' }, 500);
		}
	}

	// Transition atomique vers under_review pour geler l'expiration
	const res = await c.env.DB.prepare(
		"UPDATE orders SET status = 'under_review', updated_at = ? WHERE id = ? AND status = 'pending_payment' AND expires_at > ?",
	)
		.bind(now, orderId, now)
		.run();

	if ((res.meta?.changes ?? 0) !== 1) {
		if (key) await c.env.UPLOADS.delete(key);
		return c.json({ error: 'La commande a expiré ou a déjà été traitée' }, 409);
	}

	const clientProofNotif = buildNotificationStatements(c.env.DB, {
		userId: user.id,
		type: 'proof_submitted',
		title: `Justificatif reçu (${order.reference})`,
		body: 'Votre justificatif Wave est en cours de vérification par un administrateur.',
		link: `/orders/${orderId}`,
		orderId,
		push: false,
		now,
	});

	const verifierIds = await listPaymentVerifierIds(c.env.DB);
	const adminProofNotifs = verifierIds.map((verifierId) =>
		buildNotificationStatements(c.env.DB, {
			userId: verifierId,
			type: 'admin_proof_submitted',
			title: `Justificatif Wave reçu (${order.reference})`,
			body: `${order.total_amount_xof} FCFA à vérifier${waveRef ? ` • Réf ${waveRef}` : ''}.`,
			link: '/admin/payments',
			orderId,
			push: true,
			now,
		}),
	);

	await c.env.DB.batch([
		c.env.DB.prepare(
			`UPDATE payments
       SET proof_image_key = ?, wave_transaction_ref = ?, payer_phone = ?, submitted_at = ?, updated_at = ?
       WHERE order_id = ?`,
		).bind(key, waveRef, payerPhone, now, now, orderId),
		...clientProofNotif.statements,
		...adminProofNotifs.flatMap((n) => n.statements),
	]);

	scheduleOutboxFlush(c.env, c.executionCtx, [
		clientProofNotif.outboxId,
		...adminProofNotifs.map((n) => n.outboxId),
	]);

	return c.json({
		ok: true,
		status: 'under_review',
		proof_image_key: key,
		wave_transaction_ref: waveRef,
	});
});

clientRoutes.get('/tickets', async (c) => {
	const user = c.get('user');
	const db = getDB(c.env.DB);

	const tickets = await db
		.selectFrom('tickets as t')
		.innerJoin('events as e', 'e.id', 't.event_id')
		.innerJoin('orders as o', 'o.id', 't.order_id')
		.innerJoin('order_items as oi', 'oi.id', 't.order_item_id')
		.innerJoin('user as u', 'u.id', 't.user_id')
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
			't.outbound_used_at',
			't.return_used_at',
			't.created_at',
			'o.reference as order_reference',
			'oi.unit_price_xof as price_xof',
			'u.name as holder_name',
			'e.title as event_title',
			'e.starts_at as event_starts_at',
			'e.venue as event_venue',
			'tc.name as category_name',
			'cv.name as convoy_name',
			'cv.commune as convoy_commune',
			'cv.trip_type as convoy_trip_type',
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

clientRoutes.post('/notifications/read-all', async (c) => {
	const user = c.get('user');
	const db = getDB(c.env.DB);

	await db
		.updateTable('notifications')
		.set({ is_read: 1 })
		.where('user_id', '=', user.id)
		.where('is_read', '=', 0)
		.execute();

	return c.json({ ok: true });
});

clientRoutes.get('/push/vapid-key', async (c) => {
	const envVars = c.env as Env & { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string };
	if (envVars.VAPID_PUBLIC_KEY?.trim()) {
		return c.json({
			publicKey: envVars.VAPID_PUBLIC_KEY.trim(),
			enabled: true,
		});
	}

	if (c.env.WEB_PUSH) {
		const res = await tryCatch(c.env.WEB_PUSH.fetch('http://internal/vapid-key'));
		if (res.ok && res.data.ok) {
			const json = await tryCatch(
				res.data.json() as Promise<{ publicKey: string | null; enabled: boolean }>,
			);
			if (json.ok) {
				return c.json(json.data);
			}
		}
	}

	return c.json({ publicKey: null, enabled: false });
});

clientRoutes.post('/push/subscribe', async (c) => {
	const user = c.get('user');
	const bodyRes = await tryCatch(
		c.req.json<{
			endpoint?: string;
			keys?: { p256dh?: string; auth?: string };
		}>(),
	);
	const body = bodyRes.ok ? bodyRes.data : {};
	const endpoint = body.endpoint?.trim() || '';
	const p256dh = body.keys?.p256dh?.trim() || '';
	const auth = body.keys?.auth?.trim() || '';

	if (
		!endpoint ||
		(!endpoint.startsWith('https://') &&
			!endpoint.startsWith('http://localhost') &&
			!endpoint.startsWith('http://127.0.0.1')) ||
		!p256dh ||
		!auth
	) {
		return c.json({ error: 'Abonnement Web Push invalide' }, 400);
	}

	const now = nowIso();
	const userAgent = c.req.header('user-agent')?.slice(0, 255) || null;
	const upsertRes = await tryCatch(
		c.env.DB.prepare(
			`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = excluded.user_agent,
         updated_at = excluded.updated_at`,
		)
			.bind(crypto.randomUUID(), user.id, endpoint, p256dh, auth, userAgent, now, now)
			.run(),
	);

	if (!upsertRes.ok) {
		return c.json({ error: 'Impossible d’enregistrer les notifications push' }, 500);
	}

	return c.json({ ok: true });
});

clientRoutes.delete('/push/subscribe', async (c) => {
	const user = c.get('user');
	const bodyRes = await tryCatch(c.req.json<{ endpoint?: string }>());
	const endpoint = bodyRes.ok ? bodyRes.data.endpoint?.trim() : '';

	if (endpoint) {
		await tryCatch(
			c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
				.bind(endpoint, user.id)
				.run(),
		);
	}

	return c.json({ ok: true });
});

clientRoutes.get('/wishlists', async (c) => {
	const user = c.get('user');
	const db = getDB(c.env.DB);

	const rows = await db
		.selectFrom('wishlists as w')
		.innerJoin('events as e', 'e.id', 'w.event_id')
		.leftJoin('event_categories as ec', 'ec.id', 'e.category_id')
		.selectAll('e')
		.select(['ec.name as category_name', 'ec.slug as category_slug', 'w.created_at as saved_at'])
		.where('w.user_id', '=', user.id)
		.where('e.status', '=', 'published')
		.orderBy('w.created_at', 'desc')
		.execute();

	if (rows.length === 0) {
		return c.json({ event_ids: [], events: [] });
	}

	const eventIds = rows.map((e) => e.id);
	const [categories, convoys] = await Promise.all([
		db
			.selectFrom('ticket_categories')
			.selectAll()
			.where('event_id', 'in', eventIds)
			.orderBy('sort_order', 'asc')
			.execute(),
		db
			.selectFrom('convoys')
			.selectAll()
			.where('event_id', 'in', eventIds)
			.where('status', '=', 'published')
			.orderBy('departure_at', 'asc')
			.execute(),
	]);

	const events = rows.map((event) => ({
		...event,
		poster_keys: parsePosterKeys(event.poster_key),
		categories: categories
			.filter((cat) => cat.event_id === event.id)
			.map((cat) => ({
				...cat,
				remaining: Math.max(0, cat.capacity - cat.reserved_count),
			})),
		convoys: convoys
			.filter((conv) => conv.event_id === event.id)
			.map((conv) => ({
				...conv,
				remaining: Math.max(0, conv.capacity - conv.reserved_count),
			})),
	}));

	return c.json({ event_ids: eventIds, events });
});

clientRoutes.post('/wishlists/:eventId', async (c) => {
	const user = c.get('user');
	const eventId = c.req.param('eventId');
	const db = getDB(c.env.DB);

	const event = await db
		.selectFrom('events')
		.select(['id'])
		.where('id', '=', eventId)
		.where('status', '=', 'published')
		.executeTakeFirst();
	if (!event) {
		return c.json({ error: 'Événement introuvable' }, 404);
	}

	const insertRes = await tryCatch(
		db
			.insertInto('wishlists')
			.values({
				id: crypto.randomUUID(),
				user_id: user.id,
				event_id: eventId,
				created_at: nowIso(),
			})
			.execute(),
	);
	if (!insertRes.ok && !isUniqueConstraintError(insertRes.error)) {
		return c.json({ error: 'Impossible d’ajouter aux favoris' }, 500);
	}

	return c.json({ saved: true, event_id: eventId });
});

clientRoutes.delete('/wishlists/:eventId', async (c) => {
	const user = c.get('user');
	const eventId = c.req.param('eventId');
	const db = getDB(c.env.DB);

	await db
		.deleteFrom('wishlists')
		.where('user_id', '=', user.id)
		.where('event_id', '=', eventId)
		.execute();

	return c.json({ saved: false, event_id: eventId });
});
