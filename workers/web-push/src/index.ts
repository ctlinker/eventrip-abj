import { DurableObject } from 'cloudflare:workers';
import webpush from 'web-push';
import { tryCatch, tryCatchSync } from 'utils';

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

type WebPushEnv = Env & {
	VAPID_PUBLIC_KEY?: string;
	VAPID_PRIVATE_KEY?: string;
	VAPID_SUBJECT?: string;
};

export class UserRealtimeHub extends DurableObject<WebPushEnv> {
	constructor(ctx: DurableObjectState, env: WebPushEnv) {
		super(ctx, env);
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
			return new Response('Expected Upgrade: websocket', { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	async publish(event: Record<string, unknown>): Promise<number> {
		const sockets = this.ctx.getWebSockets();
		if (sockets.length === 0) return 0;

		const serialized = JSON.stringify(event);
		let delivered = 0;

		for (const ws of sockets) {
			const res = tryCatchSync(() => ws.send(serialized));
			if (res.ok) {
				delivered += 1;
			} else {
				tryCatchSync(() => ws.close(1011, 'Send failed'));
			}
		}

		return delivered;
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		tryCatchSync(() => ws.close(code || 1000, reason));
	}

	async webSocketError(ws: WebSocket): Promise<void> {
		tryCatchSync(() => ws.close(1011, 'WebSocket error'));
	}
}

export default {
	async fetch(request: Request, env: WebPushEnv): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/health' && request.method === 'GET') {
			return Response.json({ ok: true, service: 'eventrip-web-push' });
		}

		if (url.pathname === '/vapid-key' && request.method === 'GET') {
			const publicKey = env.VAPID_PUBLIC_KEY?.trim() || null;
			return Response.json({
				publicKey,
				enabled: Boolean(publicKey && env.VAPID_PRIVATE_KEY?.trim()),
			});
		}

		if (url.pathname === '/ws' && request.method === 'GET') {
			const userId = url.searchParams.get('userId')?.trim();
			if (!userId) {
				return Response.json({ error: 'userId requis' }, { status: 400 });
			}
			if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
				return Response.json({ error: 'Upgrade WebSocket requis' }, { status: 426 });
			}
			const hub = env.USER_REALTIME_HUB.get(env.USER_REALTIME_HUB.idFromName(userId));
			return hub.fetch(request);
		}

		if (url.pathname === '/publish' && request.method === 'POST') {
			const bodyRes = await tryCatch(
				request.json() as Promise<{ userId?: string; event?: Record<string, unknown> }>,
			);
			const userId = bodyRes.ok ? bodyRes.data.userId?.trim() : '';
			const event = bodyRes.ok ? bodyRes.data.event : undefined;
			if (!userId || !event) {
				return Response.json({ error: 'userId et event requis' }, { status: 400 });
			}
			const hub = env.USER_REALTIME_HUB.get(env.USER_REALTIME_HUB.idFromName(userId));
			const deliveredRes = await tryCatch(hub.publish(event));
			return Response.json({
				ok: deliveredRes.ok,
				delivered: deliveredRes.ok ? deliveredRes.data : 0,
			});
		}

		return Response.json({ error: 'Not found' }, { status: 404 });
	},

	async queue(batch: MessageBatch<PushQueueJob>, env: WebPushEnv): Promise<void> {
		const publicKey = env.VAPID_PUBLIC_KEY?.trim();
		const privateKey = env.VAPID_PRIVATE_KEY?.trim();
		const subject = env.VAPID_SUBJECT?.trim() || 'mailto:contact@eventrip.ci';

		if (!publicKey || !privateKey) {
			for (const msg of batch.messages) {
				msg.ack();
			}
			return;
		}

		const vapidInit = tryCatchSync(() => webpush.setVapidDetails(subject, publicKey, privateKey));
		if (!vapidInit.ok) {
			for (const msg of batch.messages) {
				msg.ack();
			}
			return;
		}

		for (const msg of batch.messages) {
			const job = msg.body;
			const sendRes = await tryCatch(
				webpush.sendNotification(job.subscription, JSON.stringify(job.payload), { TTL: 3600 }),
			);

			if (sendRes.ok) {
				msg.ack();
				continue;
			}

			const status = (sendRes.error as { statusCode?: number })?.statusCode ?? 0;
			if (status === 404 || status === 410) {
				// Abonnement révoqué ou expiré : suppression dans D1
				await tryCatch(
					env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
						.bind(job.subscription.endpoint)
						.run(),
				);
				msg.ack();
			} else if (status === 429 || status >= 500) {
				const delaySeconds = Math.min(3600, 60 * Math.max(1, msg.attempts));
				msg.retry({ delaySeconds });
			} else {
				msg.ack();
			}
		}
	},
} satisfies ExportedHandler<WebPushEnv, PushQueueJob>;
