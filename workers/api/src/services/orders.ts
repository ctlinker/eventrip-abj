import { getDB } from 'db';
import { tryCatch } from 'utils';
import { nowIso, writeAuditLog } from '../lib/utils';
import { buildNotificationStatements, flushNotificationOutbox } from './notifications';

export async function releaseOrderReservations(d1: D1Database, orderId: string): Promise<void> {
	const db = getDB(d1);
	const items = await db
		.selectFrom('order_items')
		.select(['item_type', 'ticket_category_id', 'convoy_id', 'quantity'])
		.where('order_id', '=', orderId)
		.execute();

	if (items.length === 0) return;

	const statements: D1PreparedStatement[] = [];
	for (const item of items) {
		if (item.item_type === 'ticket_category' && item.ticket_category_id) {
			statements.push(
				d1
					.prepare(
						'UPDATE ticket_categories SET reserved_count = MAX(0, reserved_count - ?) WHERE id = ?',
					)
					.bind(item.quantity, item.ticket_category_id),
			);
		} else if (item.item_type === 'convoy' && item.convoy_id) {
			statements.push(
				d1
					.prepare('UPDATE convoys SET reserved_count = MAX(0, reserved_count - ?) WHERE id = ?')
					.bind(item.quantity, item.convoy_id),
			);
		}
	}

	if (statements.length > 0) {
		await d1.batch(statements);
	}
}

export async function sendExpiringOrderReminders(
	env: Partial<Env> & { DB: D1Database },
): Promise<number> {
	const now = nowIso();
	const inThirtyMinutes = new Date(Date.now() + 30 * 60_000).toISOString();

	const candidatesRes = await tryCatch(
		env.DB.prepare(
			`SELECT id, user_id, reference, total_amount_xof
       FROM orders
       WHERE status = 'pending_payment'
         AND expiry_reminder_sent_at IS NULL
         AND expires_at > ?
         AND expires_at <= ?`,
		)
			.bind(now, inThirtyMinutes)
			.all<{ id: string; user_id: string; reference: string; total_amount_xof: number }>(),
	);

	if (!candidatesRes.ok || !candidatesRes.data.results?.length) {
		return 0;
	}

	const outboxIds: string[] = [];
	let remindedCount = 0;

	for (const order of candidatesRes.data.results) {
		const claimRes = await tryCatch(
			env.DB.prepare(
				`UPDATE orders
         SET expiry_reminder_sent_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending_payment' AND expiry_reminder_sent_at IS NULL`,
			)
				.bind(now, now, order.id)
				.run(),
		);

		if (!claimRes.ok || (claimRes.data.meta?.changes ?? 0) !== 1) {
			continue;
		}

		const notif = buildNotificationStatements(env.DB, {
			userId: order.user_id,
			type: 'order_expiring_soon',
			title: 'Votre réservation expire bientôt',
			body: `Il reste moins de 30 minutes pour envoyer votre preuve Wave (${order.reference}).`,
			link: `/orders/${order.id}`,
			orderId: order.id,
			push: true,
			now,
		});

		const batchRes = await tryCatch(env.DB.batch(notif.statements));
		if (batchRes.ok) {
			outboxIds.push(notif.outboxId);
			remindedCount += 1;
		}
	}

	if (outboxIds.length > 0) {
		await flushNotificationOutbox(env, outboxIds);
	}

	return remindedCount;
}

export async function expirePendingOrders(
	d1: D1Database,
	env?: Partial<Env> & { DB: D1Database },
): Promise<number> {
	const db = getDB(d1);
	const now = nowIso();

	const expiredOrders = await db
		.selectFrom('orders')
		.select(['id', 'user_id', 'reference'])
		.where('status', '=', 'pending_payment')
		.where('expires_at', '<=', now)
		.execute();

	let expiredCount = 0;
	const outboxIds: string[] = [];

	for (const order of expiredOrders) {
		const res = await d1
			.prepare(
				"UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending_payment'",
			)
			.bind(now, order.id)
			.run();

		if ((res.meta?.changes ?? 0) !== 1) {
			continue;
		}

		const notif = buildNotificationStatements(d1, {
			userId: order.user_id,
			type: 'order_expired',
			title: `Commande ${order.reference} expirée`,
			body: 'Le délai de 2 heures est dépassé. Vos places réservées ont été remises en vente.',
			link: `/orders/${order.id}`,
			orderId: order.id,
			push: true,
			now,
		});

		await d1.batch([
			d1
				.prepare(
					"UPDATE tickets SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'pending'",
				)
				.bind(now, order.id),
			...notif.statements,
		]);

		outboxIds.push(notif.outboxId);

		await releaseOrderReservations(d1, order.id);

		await writeAuditLog(db, {
			actorId: null,
			action: 'order.expire',
			entityType: 'order',
			entityId: order.id,
			oldState: { status: 'pending_payment' },
			newState: { status: 'expired' },
			metadata: { reference: order.reference },
		});

		expiredCount++;
	}

	if (env && outboxIds.length > 0) {
		await flushNotificationOutbox(env, outboxIds);
	}

	return expiredCount;
}
