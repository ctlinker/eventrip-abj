import { tryCatch, tryCatchSync } from 'utils';
import { apiFetch } from './api';

export interface RealtimeEvent {
	notificationId?: string | null;
	type: string;
	title: string;
	body: string;
	url: string;
	tag?: string;
	orderId?: string | null;
	ticketId?: string | null;
	createdAt?: string;
}

type RealtimeListener = (event: RealtimeEvent) => void;

const listeners = new Set<RealtimeListener>();
const seenEventKeys = new Set<string>();
let activeSocket: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let stableTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let closedManually = false;
let broadcastInitialized = false;
let broadcastChannel: BroadcastChannel | null = null;

function emitUnique(event: RealtimeEvent) {
	const dedupKey =
		event.notificationId || `${event.type}:${event.orderId || ''}:${event.createdAt || ''}:${event.title}`;
	if (seenEventKeys.has(dedupKey)) return;
	seenEventKeys.add(dedupKey);
	if (seenEventKeys.size > 200) {
		const first = seenEventKeys.values().next().value;
		if (first) seenEventKeys.delete(first);
	}
	for (const listener of listeners) {
		tryCatchSync(() => listener(event));
	}
}

function initSwBridges() {
	if (broadcastInitialized || typeof window === 'undefined') return;
	broadcastInitialized = true;

	if ('BroadcastChannel' in window) {
		const bcRes = tryCatchSync(() => new BroadcastChannel('eventrip-realtime'));
		if (bcRes.ok) {
			broadcastChannel = bcRes.data;
			broadcastChannel.onmessage = (ev) => {
				if (ev?.data && typeof ev.data === 'object' && ev.data.type) {
					emitUnique(ev.data as RealtimeEvent);
				}
			};
		}
	}

	if ('serviceWorker' in navigator) {
		navigator.serviceWorker.addEventListener('message', (ev) => {
			const msg = ev.data;
			if (msg?.source === 'eventrip-sw' && msg.payload?.type) {
				emitUnique(msg.payload as RealtimeEvent);
			}
		});
		navigator.serviceWorker.register('/sw.js').catch(() => {});
	}
}

function clearTimers() {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
	if (stableTimer) {
		clearTimeout(stableTimer);
		stableTimer = null;
	}
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
}

function connectSocket() {
	if (typeof window === 'undefined' || closedManually || listeners.size === 0) return;
	if (
		activeSocket &&
		(activeSocket.readyState === WebSocket.OPEN || activeSocket.readyState === WebSocket.CONNECTING)
	) {
		return;
	}

	const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const wsUrl = `${proto}//${window.location.host}/api/realtime/ws`;
	const wsRes = tryCatchSync(() => new WebSocket(wsUrl));
	if (!wsRes.ok) return;

	const ws = wsRes.data;
	activeSocket = ws;

	ws.onopen = () => {
		if (stableTimer) clearTimeout(stableTimer);
		stableTimer = setTimeout(() => {
			reconnectAttempt = 0;
		}, 5_000);
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		heartbeatTimer = setInterval(() => {
			if (ws.readyState === WebSocket.OPEN) {
				tryCatchSync(() => ws.send('ping'));
			}
		}, 25_000);
	};

	ws.onmessage = (ev) => {
		if (typeof ev.data !== 'string' || ev.data === 'pong') return;
		const parsed = tryCatchSync(() => JSON.parse(ev.data) as RealtimeEvent);
		if (parsed.ok && parsed.data?.type) {
			emitUnique(parsed.data);
		}
	};

	ws.onclose = () => {
		if (activeSocket === ws) activeSocket = null;
		if (stableTimer) {
			clearTimeout(stableTimer);
			stableTimer = null;
		}
		if (heartbeatTimer) {
			clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
		if (!closedManually && listeners.size > 0) {
			const delay = Math.min(30_000, 1_500 * 2 ** reconnectAttempt);
			reconnectAttempt += 1;
			reconnectTimer = setTimeout(connectSocket, delay);
		}
	};

	ws.onerror = () => {
		tryCatchSync(() => ws.close());
	};
}

export function subscribeRealtime(listener: RealtimeListener): () => void {
	closedManually = false;
	listeners.add(listener);
	initSwBridges();
	connectSocket();

	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			clearTimers();
			if (activeSocket) {
				const ws = activeSocket;
				activeSocket = null;
				tryCatchSync(() => ws.close(1000, 'idle'));
			}
		}
	};
}

export function disconnectRealtime(): void {
	closedManually = true;
	clearTimers();
	if (activeSocket) {
		const ws = activeSocket;
		activeSocket = null;
		tryCatchSync(() => ws.close(1000, 'logout'));
	}
	if (broadcastChannel) {
		tryCatchSync(() => broadcastChannel?.close());
		broadcastChannel = null;
		broadcastInitialized = false;
	}
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; i++) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

export function isIosStandaloneRequired(): boolean {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent || '';
	const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const standalone =
		window.matchMedia?.('(display-mode: standalone)')?.matches ||
		Boolean((navigator as unknown as { standalone?: boolean }).standalone);
	return isIos && !standalone;
}

export function isWebPushSupported(): boolean {
	if (typeof window === 'undefined') return false;
	return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function getActivePushSubscription(): Promise<PushSubscription | null> {
	if (!isWebPushSupported()) return null;
	const regRes = await tryCatch(navigator.serviceWorker.ready);
	if (!regRes.ok) return null;
	const subRes = await tryCatch(regRes.data.pushManager.getSubscription());
	return subRes.ok ? subRes.data : null;
}

export async function enableWebPush(): Promise<{ ok: boolean; error?: string }> {
	if (isIosStandaloneRequired()) {
		return {
			ok: false,
			error: 'Sur iPhone/iPad, ajoutez d’abord EVENTRIP à l’écran d’accueil pour activer les notifications.',
		};
	}
	if (!isWebPushSupported()) {
		return { ok: false, error: 'Les notifications Web Push ne sont pas supportées par ce navigateur.' };
	}

	const regRes = await tryCatch(navigator.serviceWorker.register('/sw.js'));
	if (!regRes.ok) {
		return { ok: false, error: 'Impossible d’initialiser le Service Worker.' };
	}
	await tryCatch(navigator.serviceWorker.ready);

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') {
		return { ok: false, error: 'Permission de notification refusée dans le navigateur.' };
	}

	const keyRes = await tryCatch(
		apiFetch<{ publicKey: string | null; enabled: boolean }>('/api/push/vapid-key'),
	);
	if (!keyRes.ok || !keyRes.data.publicKey) {
		return { ok: false, error: 'Clé VAPID serveur non configurée.' };
	}

	let sub = await getActivePushSubscription();
	if (!sub) {
		const subRes = await tryCatch(
			regRes.data.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(keyRes.data.publicKey) as BufferSource,
			}),
		);
		if (!subRes.ok) {
			return { ok: false, error: 'Échec de l’abonnement auprès du service Push navigateur.' };
		}
		sub = subRes.data;
	}

	const saveRes = await tryCatch(
		apiFetch('/api/push/subscribe', {
			method: 'POST',
			body: JSON.stringify(sub.toJSON()),
		}),
	);
	if (!saveRes.ok) {
		return { ok: false, error: 'Impossible d’enregistrer l’abonnement sur le serveur.' };
	}

	return { ok: true };
}

export async function disableWebPush(unsubscribeBrowser = false): Promise<void> {
	if (!isWebPushSupported()) return;
	const sub = await getActivePushSubscription();
	if (!sub) return;

	await tryCatch(
		apiFetch('/api/push/subscribe', {
			method: 'DELETE',
			body: JSON.stringify({ endpoint: sub.endpoint }),
		}),
	);

	if (unsubscribeBrowser) {
		await tryCatch(sub.unsubscribe());
	}
}
