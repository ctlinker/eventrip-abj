import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, it, expect } from 'vitest';
import migration001 from '../../../packages/db/migrations/001_better-auth.sql?raw';
import migration002 from '../../../packages/db/migrations/002_domain.sql?raw';
import { expirePendingOrders } from '../src/services/orders';

async function applySql(sql: string) {
	const cleaned = sql
		.split('\n')
		.filter((line) => !line.trim().startsWith('--'))
		.join('\n');
	const statements = cleaned
		.split(';')
		.map((s) => s.trim())
		.filter(Boolean);
	for (const stmt of statements) {
		await env.DB.prepare(stmt).run();
	}
}

async function signUpAndGetCookie(name: string, email: string, phone?: string) {
	const res = await SELF.fetch('https://example.com/api/auth/sign-up/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			name,
			email,
			password: 'Password123!',
			phone,
		}),
	});
	expect(res.status).toBe(200);
	const setCookie = res.headers.get('set-cookie') || '';
	const cookie = setCookie.split(';')[0];
	const data = (await res.json()) as { user: { id: string } };
	return { cookie, userId: data.user.id };
}

describe('Eventrip API Core', () => {
	let clientCookie = '';
	let clientUserId = '';
	let adminNoPermCookie = '';
	let adminVerifierCookie = '';
	let eventId = '';
	let eventSlug = '';
	let categoryId = '';
	let convoyId = '';

	beforeAll(async () => {
		await applySql(migration001);
		await applySql(migration002);

		const client = await signUpAndGetCookie('Kouame Client', 'client@eventrip.ci', '+2250700000001');
		clientCookie = client.cookie;
		clientUserId = client.userId;

		const admin1 = await signUpAndGetCookie('Admin Sans Perm', 'admin1@eventrip.ci');
		adminNoPermCookie = admin1.cookie;
		await env.DB.prepare("UPDATE user SET role = 'admin', permissions = '[]' WHERE id = ?")
			.bind(admin1.userId)
			.run();

		const admin2 = await signUpAndGetCookie('Admin Verifier', 'admin2@eventrip.ci');
		adminVerifierCookie = admin2.cookie;
		await env.DB.prepare(
			"UPDATE user SET role = 'admin', permissions = '[\"payments:verify\"]' WHERE id = ?",
		)
			.bind(admin2.userId)
			.run();

		// Créer un événement publié + catégorie + convoi
		const evRes = await SELF.fetch('https://example.com/api/admin/events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({
				title: 'Abidjan Sunset Fest',
				description: 'Festival électro à Assinie',
				starts_at: '2026-12-20T18:00:00Z',
				venue: 'Assinie-Mafia',
				wave_payment_url: 'https://pay.wave.com/m/M_ci_test',
				status: 'published',
			}),
		});
		expect(evRes.status).toBe(201);
		const evData = (await evRes.json()) as { event: { id: string; slug: string } };
		eventId = evData.event.id;
		eventSlug = evData.event.slug;

		const catRes = await SELF.fetch(`https://example.com/api/admin/events/${eventId}/categories`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({ name: 'VIP', price_xof: 15000, capacity: 3 }),
		});
		expect(catRes.status).toBe(201);
		categoryId = ((await catRes.json()) as { category: { id: string } }).category.id;

		const convRes = await SELF.fetch(`https://example.com/api/admin/events/${eventId}/convoys`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({
				name: 'Car Plateau -> Assinie',
				departure_at: '2026-12-20T14:00:00Z',
				meeting_point: 'Plateau Gare Lagunaire',
				destination: 'Assinie-Mafia',
				trip_type: 'round_trip',
				price_xof: 5000,
				capacity: 2,
			}),
		});
		expect(convRes.status).toBe(201);
		convoyId = ((await convRes.json()) as { convoy: { id: string } }).convoy.id;
	});

	it('responds on /api/health and lists published events', async () => {
		const health = await SELF.fetch('https://example.com/api/health');
		expect(health.status).toBe(200);

		const list = await SELF.fetch('https://example.com/api/events');
		expect(list.status).toBe(200);
		const data = (await list.json()) as { events: Array<{ slug: string; categories: unknown[]; convoys: unknown[] }> };
		expect(data.events.length).toBe(1);
		expect(data.events[0].slug).toBe(eventSlug);
		expect(data.events[0].categories.length).toBe(1);
		expect(data.events[0].convoys.length).toBe(1);
	});

	it('handles mixed order, proof upload, permission check, Wave confirmation, QR scan, and expiration', async () => {
		// 1. Création commande mixte (2 VIP + 1 Convoi = 35000 XOF)
		const orderRes = await SELF.fetch('https://example.com/api/orders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
			body: JSON.stringify({
				items: [
					{ type: 'ticket_category', id: categoryId, quantity: 2 },
					{ type: 'convoy', id: convoyId, quantity: 1 },
				],
			}),
		});
		expect(orderRes.status).toBe(201);
		const orderData = (await orderRes.json()) as {
			order: { id: string; total_amount_xof: number; status: string };
			payment: { id: string };
		};
		expect(orderData.order.total_amount_xof).toBe(35000);
		expect(orderData.order.status).toBe('pending_payment');

		// 2. Dépassement de capacité refusé (409) et places non corrompues
		const overRes = await SELF.fetch('https://example.com/api/orders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
			body: JSON.stringify({
				items: [{ type: 'ticket_category', id: categoryId, quantity: 2 }],
			}),
		});
		expect(overRes.status).toBe(409);

		// 3. Les tickets existent en base (pending) mais qr_token est masqué côté client tant que non confirmé
		const pendingTicketsRes = await SELF.fetch('https://example.com/api/tickets', {
			headers: { Cookie: clientCookie },
		});
		const pendingTickets = (await pendingTicketsRes.json()) as {
			tickets: Array<{ status: string; qr_token: string | null }>;
		};
		expect(pendingTickets.tickets.length).toBe(3);
		expect(pendingTickets.tickets.every((t) => t.status === 'pending' && t.qr_token === null)).toBe(true);

		// Scan d'un ticket encore pending doit échouer (409)
		const rawPendingToken = await env.DB.prepare('SELECT qr_token FROM tickets WHERE order_id = ? LIMIT 1')
			.bind(orderData.order.id)
			.first<{ qr_token: string }>();
		const scanPendingRes = await SELF.fetch('https://example.com/api/admin/tickets/scan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({ qr_token: rawPendingToken!.qr_token }),
		});
		expect(scanPendingRes.status).toBe(409);

		// 4. Upload justificatif Wave -> passe la commande en under_review (gel expiration)
		const form = new FormData();
		form.append('file', new File([new Uint8Array([137, 80, 78, 71])], 'wave.png', { type: 'image/png' }));
		form.append('payer_phone', '+2250700000001');
		const proofRes = await SELF.fetch(`https://example.com/api/orders/${orderData.order.id}/proof`, {
			method: 'POST',
			headers: { Cookie: clientCookie },
			body: form,
		});
		expect(proofRes.status).toBe(200);
		expect(((await proofRes.json()) as { status: string }).status).toBe('under_review');

		// 5. Admin sans permission payments:verify bloqué (403)
		const forbiddenConfirm = await SELF.fetch(
			`https://example.com/api/admin/payments/${orderData.payment.id}/confirm`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: adminNoPermCookie },
				body: JSON.stringify({ wave_transaction_ref: 'WAVE-TX-001' }),
			},
		);
		expect(forbiddenConfirm.status).toBe(403);

		// 6. Admin habilité confirme le paiement avec référence Wave unique
		const confirmRes = await SELF.fetch(
			`https://example.com/api/admin/payments/${orderData.payment.id}/confirm`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
				body: JSON.stringify({ wave_transaction_ref: 'WAVE-TX-001' }),
			},
		);
		expect(confirmRes.status).toBe(200);

		// 7. Tickets désormais valides avec qr_token accessible + scan QR atomique
		const validTicketsRes = await SELF.fetch('https://example.com/api/tickets', {
			headers: { Cookie: clientCookie },
		});
		const validTickets = (await validTicketsRes.json()) as {
			tickets: Array<{ status: string; qr_token: string | null }>;
		};
		expect(validTickets.tickets.every((t) => t.status === 'valid' && Boolean(t.qr_token))).toBe(true);

		const qrToken = validTickets.tickets[0].qr_token!;
		const firstScan = await SELF.fetch('https://example.com/api/admin/tickets/scan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminNoPermCookie },
			body: JSON.stringify({ qr_token: qrToken }),
		});
		expect(firstScan.status).toBe(200);
		expect(((await firstScan.json()) as { result: string }).result).toBe('valid');

		const secondScan = await SELF.fetch('https://example.com/api/admin/tickets/scan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminNoPermCookie },
			body: JSON.stringify({ qr_token: qrToken }),
		});
		expect(secondScan.status).toBe(409);
		expect(((await secondScan.json()) as { result: string }).result).toBe('already_used');

		// 8. Expiration automatique (2h) + restitution de place + unicité wave_transaction_ref
		const expOrderRes = await SELF.fetch('https://example.com/api/orders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
			body: JSON.stringify({
				items: [{ type: 'ticket_category', id: categoryId, quantity: 1 }],
			}),
		});
		expect(expOrderRes.status).toBe(201);
		const expOrder = (await expOrderRes.json()) as { order: { id: string }; payment: { id: string } };

		// Vérifier que réutiliser WAVE-TX-001 sur un autre paiement échoue (409)
		const dupWaveRes = await SELF.fetch(
			`https://example.com/api/admin/payments/${expOrder.payment.id}/confirm`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
				body: JSON.stringify({ wave_transaction_ref: 'WAVE-TX-001' }),
			},
		);
		expect(dupWaveRes.status).toBe(409);

		// Simuler expiration passée et exécuter le cron
		await env.DB.prepare("UPDATE orders SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
			.bind(expOrder.order.id)
			.run();
		const expiredCount = await expirePendingOrders(env.DB);
		expect(expiredCount).toBe(1);

		const catAfter = await env.DB.prepare('SELECT reserved_count FROM ticket_categories WHERE id = ?')
			.bind(categoryId)
			.first<{ reserved_count: number }>();
		expect(catAfter?.reserved_count).toBe(2); // 2 de la 1ère commande, 1 restitué
		expect(clientUserId).toBeTruthy();
	});
});
