import { hasPermission } from 'db';
import { getErrorMessage, tryCatch, tryCatchSync } from 'utils';
import { nowIso } from '../lib/utils';

export interface PushSubscriptionKeys {
	p256dh: string;
	auth: string;
}

export interface RealtimeNotificationPayload {
	notificationId: string | null;
	type: string;
	title: string;
	body: string;
	url: string;
	tag: string;
	orderId?: string | null;
	ticketId?: string | null;
	createdAt: string;
}

export interface PushQueueJob {
	outboxId: string;
	userId: string;
	subscription: {
		endpoint: string;
		keys: PushSubscriptionKeys;
	};
	payload: RealtimeNotificationPayload;
}

export function buildNotificationStatements(
	d1: D1Database,
	params: {
		userId: string;
		type: string;
		title: string;
		body: string;
		link?: string | null;
		orderId?: string | null;
		ticketId?: string | null;
		push?: boolean;
		tag?: string;
		now?: string;
	},
): {
	notificationId: string;
	outboxId: string;
	statements: [D1PreparedStatement, D1PreparedStatement];
} {
	const ts = params.now || nowIso();
	const notificationId = crypto.randomUUID();
	const outboxId = crypto.randomUUID();
	const url = params.link ?? '/';
	const payload: RealtimeNotificationPayload = {
		notificationId,
		type: params.type,
		title: params.title,
		body: params.body,
		url,
		tag: params.tag || `${params.type}-${params.orderId || notificationId}`,
		orderId: params.orderId ?? null,
		ticketId: params.ticketId ?? null,
		createdAt: ts,
	};

	const notifStmt = d1
		.prepare(
			`INSERT INTO notifications (id, user_id, type, title, body, link, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
		)
		.bind(
			notificationId,
			params.userId,
			params.type,
			params.title,
			params.body,
			params.link ?? null,
			ts,
		);

	const outboxStmt = d1
		.prepare(
			`INSERT INTO notification_outbox (
         id, user_id, notification_id, event_type, payload, push_enabled,
         status, attempts, next_attempt_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
		)
		.bind(
			outboxId,
			params.userId,
			notificationId,
			params.type,
			JSON.stringify(payload),
			params.push === false ? 0 : 1,
			ts,
			ts,
		);

	return {
		notificationId,
		outboxId,
		statements: [notifStmt, outboxStmt],
	};
}

export function buildRealtimeSignalStatement(
	d1: D1Database,
	params: {
		userId: string;
		type: string;
		title: string;
		body: string;
		link?: string | null;
		orderId?: string | null;
		ticketId?: string | null;
		now?: string;
	},
): { outboxId: string; statement: D1PreparedStatement } {
	const ts = params.now || nowIso();
	const outboxId = crypto.randomUUID();
	const payload: RealtimeNotificationPayload = {
		notificationId: null,
		type: params.type,
		title: params.title,
		body: params.body,
		url: params.link ?? '/',
		tag: `${params.type}-${params.ticketId || params.orderId || outboxId}`,
		orderId: params.orderId ?? null,
		ticketId: params.ticketId ?? null,
		createdAt: ts,
	};

	const statement = d1
		.prepare(
			`INSERT INTO notification_outbox (
         id, user_id, notification_id, event_type, payload, push_enabled,
         status, attempts, next_attempt_at, created_at
       ) VALUES (?, ?, NULL, ?, ?, 0, 'pending', 0, ?, ?)`,
		)
		.bind(outboxId, params.userId, params.type, JSON.stringify(payload), ts, ts);

	return { outboxId, statement };
}

export async function listPaymentVerifierIds(d1: D1Database): Promise<string[]> {
	const rowsRes = await tryCatch(
		d1
			.prepare(
				`SELECT id, role, permissions FROM "user"
         WHERE is_active = 1 AND role IN ('admin', 'super_admin')`,
			)
			.all<{ id: string; role: string; permissions: string | null }>(),
	);
	if (!rowsRes.ok || !rowsRes.data.results) return [];

	return rowsRes.data.results
		.filter((u) => hasPermission(u, 'payments:verify'))
		.map((u) => u.id);
}

interface OutboxRow {
	id: string;
	user_id: string;
	notification_id: string | null;
	event_type: string;
	payload: string;
	push_enabled: number;
	attempts: number;
}

export async function flushNotificationOutbox(
	env: Partial<Env> & { DB: D1Database },
	outboxIds?: string[],
): Promise<number> {
	const now = nowIso();
	let rows: OutboxRow[] = [];

	if (outboxIds && outboxIds.length > 0) {
		const placeholders = outboxIds.map(() => '?').join(', ');
		const res = await tryCatch(
			env.DB.prepare(
				`SELECT id, user_id, notification_id, event_type, payload, push_enabled, attempts
         FROM notification_outbox
         WHERE status = 'pending' AND id IN (${placeholders})`,
			)
				.bind(...outboxIds)
				.all<OutboxRow>(),
		);
		if (res.ok && res.data.results) {
			rows = res.data.results;
		}
	} else {
		const res = await tryCatch(
			env.DB.prepare(
				`SELECT id, user_id, notification_id, event_type, payload, push_enabled, attempts
         FROM notification_outbox
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY created_at ASC
         LIMIT 50`,
			)
				.bind(now)
				.all<OutboxRow>(),
		);
		if (res.ok && res.data.results) {
			rows = res.data.results;
		}
	}

	if (rows.length === 0) return 0;

	let dispatched = 0;

	for (const row of rows) {
		const parsed = tryCatchSync(() => JSON.parse(row.payload) as RealtimeNotificationPayload);
		if (!parsed.ok) {
			await tryCatch(
				env.DB.prepare(
					"UPDATE notification_outbox SET status = 'failed', last_error = 'Invalid JSON payload' WHERE id = ?",
				)
					.bind(row.id)
					.run(),
			);
			continue;
		}

		// 1. Diffusion temps réel WebSocket via Service Binding WEB_PUSH (best-effort)
		if (env.WEB_PUSH) {
			await tryCatch(
				env.WEB_PUSH.fetch(
					new Request('http://internal/publish', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							userId: row.user_id,
							event: parsed.data,
						}),
					}),
				),
			);
		}

		// 2. Fan-out Web Push asynchrone via Cloudflare Queue PUSH_QUEUE -> worker web-push
		if (row.push_enabled === 1 && env.PUSH_QUEUE) {
			const subsRes = await tryCatch(
				env.DB.prepare(
					'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?',
				)
					.bind(row.user_id)
					.all<{ endpoint: string; p256dh: string; auth: string }>(),
			);

			if (!subsRes.ok) {
				await markOutboxRetry(env.DB, row, getErrorMessage(subsRes.error, 'D1 subs read failed'));
				continue;
			}

			const subs = subsRes.data.results || [];
			let enqueueFailed: string | null = null;

			for (let i = 0; i < subs.length; i += 100) {
				const chunk = subs.slice(i, i + 100);
				const batchSendRes = await tryCatch(
					env.PUSH_QUEUE.sendBatch(
						chunk.map((s) => ({
							body: {
								outboxId: row.id,
								userId: row.user_id,
								subscription: {
									endpoint: s.endpoint,
									keys: { p256dh: s.p256dh, auth: s.auth },
								},
								payload: parsed.data,
							} satisfies PushQueueJob,
						})),
					),
				);
				if (!batchSendRes.ok) {
					enqueueFailed = getErrorMessage(batchSendRes.error, 'Queue sendBatch failed');
					break;
				}
			}

			if (enqueueFailed) {
				await markOutboxRetry(env.DB, row, enqueueFailed);
				continue;
			}
		}

		await tryCatch(
			env.DB.prepare(
				"UPDATE notification_outbox SET status = 'dispatched', dispatched_at = ?, last_error = NULL WHERE id = ?",
			)
				.bind(nowIso(), row.id)
				.run(),
		);
		dispatched += 1;
	}

	return dispatched;
}

async function markOutboxRetry(d1: D1Database, row: OutboxRow, errorMsg: string): Promise<void> {
	const nextAttempts = row.attempts + 1;
	if (nextAttempts >= 5) {
		await tryCatch(
			d1
				.prepare(
					"UPDATE notification_outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?",
				)
				.bind(nextAttempts, errorMsg.slice(0, 500), row.id)
				.run(),
		);
		return;
	}
	const delayMs = Math.min(30 * 60_000, 60_000 * 2 ** (nextAttempts - 1));
	const nextAt = new Date(Date.now() + delayMs).toISOString();
	await tryCatch(
		d1
			.prepare(
				'UPDATE notification_outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?',
			)
			.bind(nextAttempts, nextAt, errorMsg.slice(0, 500), row.id)
			.run(),
	);
}

export function scheduleOutboxFlush(
	env: Partial<Env> & { DB: D1Database },
	executionCtx?: { waitUntil?: (promise: Promise<unknown>) => void },
	outboxIds?: string[],
): Promise<number> {
	const promise = flushNotificationOutbox(env, outboxIds);
	if (executionCtx && typeof executionCtx.waitUntil === 'function') {
		tryCatchSync(() => executionCtx.waitUntil!(promise));
	}
	return promise;
}
