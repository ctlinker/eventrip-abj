self.addEventListener('install', () => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
	if (!event.data) return;

	let payload;
	try {
		payload = event.data.json();
	} catch {
		payload = {
			title: 'EVENTRIP-ABJ',
			body: event.data.text() || 'Nouvelle notification',
			url: '/',
		};
	}

	const title = payload.title || 'EVENTRIP-ABJ';
	const targetUrl = payload.url || '/';

	try {
		if ('BroadcastChannel' in self) {
			const bc = new BroadcastChannel('eventrip-realtime');
			bc.postMessage(payload);
			bc.close();
		}
	} catch {}

	event.waitUntil(
		(async () => {
			const windowClients = await self.clients.matchAll({
				type: 'window',
				includeUncontrolled: true,
			});

			for (const client of windowClients) {
				try {
					client.postMessage({ source: 'eventrip-sw', payload });
				} catch {}
			}

			await self.registration.showNotification(title, {
				body: payload.body || '',
				icon: '/icon-192.png',
				badge: '/icon-192.png',
				tag: payload.tag || payload.notificationId || 'eventrip-notif',
				data: {
					url: targetUrl,
					orderId: payload.orderId || null,
					type: payload.type || null,
				},
			});
		})(),
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const rawTarget = (event.notification.data && event.notification.data.url) || '/';
	const resolvedUrl = new URL(rawTarget, self.location.origin).href;

	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
			for (const client of windowClients) {
				if (client.url.startsWith(self.location.origin) && 'focus' in client) {
					if ('navigate' in client && client.url !== resolvedUrl) {
						client.navigate(resolvedUrl).catch(() => {});
					}
					return client.focus();
				}
			}
			return self.clients.openWindow(resolvedUrl);
		}),
	);
});
