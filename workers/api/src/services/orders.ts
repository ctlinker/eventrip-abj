import { getDB } from 'db';
import { nowIso, writeAuditLog } from '../lib/utils';

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

export async function expirePendingOrders(d1: D1Database): Promise<number> {
	const db = getDB(d1);
	const now = nowIso();

	const expiredOrders = await db
		.selectFrom('orders')
		.select(['id', 'user_id', 'reference'])
		.where('status', '=', 'pending_payment')
		.where('expires_at', '<=', now)
		.execute();

	let expiredCount = 0;

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

		await d1
			.prepare(
				"UPDATE tickets SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'pending'",
			)
			.bind(now, order.id)
			.run();

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

	return expiredCount;
}
