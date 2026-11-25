import { env, SELF } from 'cloudflare:test';
import { beforeAll, describe, it, expect } from 'vitest';
import migration001 from '../../../packages/db/migrations/001_better-auth.sql?raw';
import migration002 from '../../../packages/db/migrations/002_domain.sql?raw';
import migration003 from '../../../packages/db/migrations/003_communes_roundtrip.sql?raw';
import migration004 from '../../../packages/db/migrations/004_event_single_price.sql?raw';
import migration005 from '../../../packages/db/migrations/005_event_categories.sql?raw';
import migration006 from '../../../packages/db/migrations/006_wishlists.sql?raw';
import { expirePendingOrders } from '../src/services/orders';
import { maybeBootstrapSuperAdmin } from '../src/lib/bootstrap';

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
		await applySql(migration003);
		await applySql(migration004);
		await applySql(migration005);
		await applySql(migration006);

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

		// Ajouter une catégorie d'événement personnalisée
		const newCatRes = await SELF.fetch('https://example.com/api/admin/event-categories', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({ name: 'Afterwork' }),
		});
		expect(newCatRes.status).toBe(201);
		const newCatData = (await newCatRes.json()) as { category: { id: string; name: string } };

		// Créer un événement publié avec prix unique + catégorie + départ initial (55 pl. par défaut)
		const evRes = await SELF.fetch('https://example.com/api/admin/events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({
				title: 'Abidjan Sunset Fest',
				description: 'Festival électro à Assinie',
				starts_at: '2026-12-20T18:00:00Z',
				venue: 'Assinie-Mafia',
				price_xof: 15000,
				category_id: newCatData.category.id,
				wave_payment_url: 'https://pay.wave.com/m/M_ci_test',
				status: 'published',
				initial_departure: {
					commune: 'Plateau',
					meeting_point: 'Gare Lagunaire',
					departure_at: '2026-12-20T13:00:00Z',
				},
			}),
		});
		expect(evRes.status).toBe(201);
		const evData = (await evRes.json()) as {
			event: { id: string; slug: string; price_xof: number; convoys: Array<{ id: string; capacity: number }> };
		};
		expect(evData.event.price_xof).toBe(15000);
		expect(evData.event.convoys[0].capacity).toBe(55);
		eventId = evData.event.id;
		eventSlug = evData.event.slug;

		// Ajouter un 2e départ (Cocody, 55 pl. par défaut, prix 0 car déterminé par l'événement)
		const convRes = await SELF.fetch(`https://example.com/api/admin/events/${eventId}/convoys`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({
				name: 'Départ Cocody',
				commune: 'Cocody',
				departure_at: '2026-12-20T14:00:00Z',
				meeting_point: 'Angré 8e Tranche',
				destination: 'Assinie-Mafia',
			}),
		});
		expect(convRes.status).toBe(201);
		const createdConvoy = (await convRes.json()) as {
			convoy: { id: string; capacity: number; commune: string; price_xof: number };
		};
		expect(createdConvoy.convoy.capacity).toBe(55);
		expect(createdConvoy.convoy.commune).toBe('Cocody');
		expect(createdConvoy.convoy.price_xof).toBe(0);
		convoyId = createdConvoy.convoy.id;

		// Réduire capacité d'une catégorie legacy pour tests mixtes si besoin
		const catRes = await SELF.fetch(`https://example.com/api/admin/events/${eventId}/categories`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({ name: 'VIP', price_xof: 15000, capacity: 3 }),
		});
		expect(catRes.status).toBe(201);
		categoryId = ((await catRes.json()) as { category: { id: string } }).category.id;
	});

	it('responds on /api/health and lists published events', async () => {
		const health = await SELF.fetch('https://example.com/api/health');
		expect(health.status).toBe(200);

		const list = await SELF.fetch('https://example.com/api/events');
		expect(list.status).toBe(200);
		const data = (await list.json()) as {
			events: Array<{
				slug: string;
				category_name?: string | null;
				categories: unknown[];
				convoys: unknown[];
			}>;
			event_categories: unknown[];
		};
		expect(data.events.length).toBe(1);
		expect(data.events[0].slug).toBe(eventSlug);
		expect(data.events[0].category_name).toBe('Afterwork');
		expect(data.event_categories.length).toBeGreaterThanOrEqual(6);
		expect(data.events[0].categories.length).toBe(1);
		expect(data.events[0].convoys.length).toBe(2);
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
		expect(orderData.order.total_amount_xof).toBe(45000);
		expect(orderData.order.status).toBe('pending_payment');

		// Vérifier que GET /api/orders/:id génère wave_payment_url avec ?amount=45000
		const orderDetailRes = await SELF.fetch(`https://example.com/api/orders/${orderData.order.id}`, {
			headers: { Cookie: clientCookie },
		});
		expect(orderDetailRes.status).toBe(200);
		const detailData = (await orderDetailRes.json()) as {
			payment: { wave_payment_url: string | null };
		};
		expect(detailData.payment.wave_payment_url).toBe('https://pay.wave.com/m/M_ci_test?amount=45000');

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
			tickets: Array<{ item_type: string; status: string; qr_token: string | null }>;
		};
		expect(validTickets.tickets.every((t) => t.status === 'valid' && Boolean(t.qr_token))).toBe(true);

		const eventTicketToken = validTickets.tickets.find((t) => t.item_type === 'event_ticket')!.qr_token!;
		const firstScan = await SELF.fetch('https://example.com/api/admin/tickets/scan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminNoPermCookie },
			body: JSON.stringify({ qr_token: eventTicketToken }),
		});
		expect(firstScan.status).toBe(200);
		expect(((await firstScan.json()) as { result: string }).result).toBe('valid');

		const secondScan = await SELF.fetch('https://example.com/api/admin/tickets/scan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminNoPermCookie },
			body: JSON.stringify({ qr_token: eventTicketToken }),
		});
		expect(secondScan.status).toBe(409);
		expect(((await secondScan.json()) as { result: string }).result).toBe('already_used');

		// Double scan Aller + Retour sur billet de convoi
		const convoyToken = validTickets.tickets.find((t) => t.item_type === 'convoy_ticket')!.qr_token!;
		const outboundScan = await SELF.fetch('https://example.com/api/admin/tickets/scan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminNoPermCookie },
			body: JSON.stringify({ qr_token: convoyToken, direction: 'outbound' }),
		});
		expect(outboundScan.status).toBe(200);

		const dupOutbound = await SELF.fetch('https://example.com/api/admin/tickets/scan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminNoPermCookie },
			body: JSON.stringify({ qr_token: convoyToken, direction: 'outbound' }),
		});
		expect(dupOutbound.status).toBe(409);

		const returnScan = await SELF.fetch('https://example.com/api/admin/tickets/scan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminNoPermCookie },
			body: JSON.stringify({ qr_token: convoyToken, direction: 'return' }),
		});
		expect(returnScan.status).toBe(200);

		const dupReturn = await SELF.fetch('https://example.com/api/admin/tickets/scan', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminNoPermCookie },
			body: JSON.stringify({ qr_token: convoyToken, direction: 'return' }),
		});
		expect(dupReturn.status).toBe(409);

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

		// 9. Soumission de justificatif uniquement via ID de transaction Wave (sans capture)
		const refOnlyOrderRes = await SELF.fetch('https://example.com/api/orders', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
			body: JSON.stringify({
				items: [{ type: 'ticket_category', id: categoryId, quantity: 1 }],
			}),
		});
		expect(refOnlyOrderRes.status).toBe(201);
		const refOnlyOrder = (await refOnlyOrderRes.json()) as { order: { id: string } };
		const refProofRes = await SELF.fetch(`https://example.com/api/orders/${refOnlyOrder.order.id}/proof`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: clientCookie },
			body: JSON.stringify({ wave_transaction_ref: 'WAVE-TX-ONLY-999' }),
		});
		expect(refProofRes.status).toBe(200);
		const refProofData = (await refProofRes.json()) as {
			status: string;
			wave_transaction_ref: string;
		};
		expect(refProofData.status).toBe('under_review');
		expect(refProofData.wave_transaction_ref).toBe('WAVE-TX-ONLY-999');

		// 10. Bootstrap super_admin uniquement s'il n'en existe aucun en base
		const promotedFirst = await maybeBootstrapSuperAdmin(env.DB, 'client@eventrip.ci');
		expect(promotedFirst).toBe(true);
		const promotedSecond = await maybeBootstrapSuperAdmin(env.DB, 'admin1@eventrip.ci');
		expect(promotedSecond).toBe(false);

		// 11. Liste de souhaits (wishlist) client
		const addWish = await SELF.fetch(`https://example.com/api/wishlists/${eventId}`, {
			method: 'POST',
			headers: { Cookie: clientCookie },
		});
		expect(addWish.status).toBe(200);
		const getWish = await SELF.fetch('https://example.com/api/wishlists', {
			headers: { Cookie: clientCookie },
		});
		expect(getWish.status).toBe(200);
		const wishData = (await getWish.json()) as { event_ids: string[] };
		expect(wishData.event_ids).toContain(eventId);

		const delWish = await SELF.fetch(`https://example.com/api/wishlists/${eventId}`, {
			method: 'DELETE',
			headers: { Cookie: clientCookie },
		});
		expect(delWish.status).toBe(200);

		// 12. Suppression refusée si événement réservé (409), mais autorisée sans réservation + archivage
		const blockedDelete = await SELF.fetch(`https://example.com/api/admin/events/${eventId}`, {
			method: 'DELETE',
			headers: { Cookie: adminVerifierCookie },
		});
		expect(blockedDelete.status).toBe(409);

		const emptyEvRes = await SELF.fetch('https://example.com/api/admin/events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({
				title: 'Événement temporaire',
				description: 'Test suppression & archivage',
				starts_at: '2026-12-28T18:00:00Z',
				venue: 'Plateau',
				price_xof: 5000,
				status: 'published',
				initial_departure: {
					commune: 'Plateau',
					meeting_point: 'Place République',
					departure_at: '2026-12-28T15:00:00Z',
				},
			}),
		});
		expect(emptyEvRes.status).toBe(201);
		const emptyEvId = ((await emptyEvRes.json()) as { event: { id: string } }).event.id;

		// Double-publish immédiat bloqué (409)
		const dupPublishRes = await SELF.fetch('https://example.com/api/admin/events', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({
				title: 'Événement temporaire',
				description: 'Test suppression & archivage',
				starts_at: '2026-12-28T18:00:00Z',
				venue: 'Plateau',
				price_xof: 5000,
				status: 'published',
				initial_departure: {
					commune: 'Plateau',
					meeting_point: 'Place République',
					departure_at: '2026-12-28T15:00:00Z',
				},
			}),
		});
		expect(dupPublishRes.status).toBe(409);

		const archiveRes = await SELF.fetch(`https://example.com/api/admin/events/${emptyEvId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Cookie: adminVerifierCookie },
			body: JSON.stringify({ status: 'archived' }),
		});
		expect(archiveRes.status).toBe(200);

		const okDelete = await SELF.fetch(`https://example.com/api/admin/events/${emptyEvId}`, {
			method: 'DELETE',
			headers: { Cookie: adminVerifierCookie },
		});
		expect(okDelete.status).toBe(200);

		expect(clientUserId).toBeTruthy();
	});
});
