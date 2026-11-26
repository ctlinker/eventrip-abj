import { Hono } from 'hono';
import { getAuth, getDB } from 'db';
import { tryCatch } from 'utils';
import { parsePosterKeys } from '../lib/utils';
import type { AppEnv } from '../types';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/event-categories', async (c) => {
	const db = getDB(c.env.DB);
	const eventCategories = await db
		.selectFrom('event_categories')
		.selectAll()
		.orderBy('name', 'asc')
		.execute();
	return c.json({ event_categories: eventCategories });
});

publicRoutes.get('/communes', async (c) => {
	const db = getDB(c.env.DB);
	const communes = await db
		.selectFrom('communes')
		.selectAll()
		.orderBy('name', 'asc')
		.execute();
	return c.json({ communes });
});

publicRoutes.get('/events', async (c) => {
	const db = getDB(c.env.DB);
	const [events, eventCategories, communes] = await Promise.all([
		db
			.selectFrom('events as e')
			.leftJoin('event_categories as ec', 'ec.id', 'e.category_id')
			.selectAll('e')
			.select(['ec.name as category_name', 'ec.slug as category_slug'])
			.where('e.status', '=', 'published')
			.orderBy('e.starts_at', 'asc')
			.execute(),
		db.selectFrom('event_categories').selectAll().orderBy('name', 'asc').execute(),
		db.selectFrom('communes').selectAll().orderBy('name', 'asc').execute(),
	]);

	if (events.length === 0) {
		return c.json({ events: [], event_categories: eventCategories, communes, wishlist_ids: [] });
	}

	let wishlistIds: string[] = [];
	if (c.req.header('cookie')) {
		const sessionRes = await tryCatch(
			getAuth(c.env.DB).api.getSession({ headers: c.req.raw.headers }),
		);
		const userId = sessionRes.ok ? sessionRes.data?.user?.id : undefined;
		if (userId) {
			const wRows = await db
				.selectFrom('wishlists')
				.select(['event_id'])
				.where('user_id', '=', userId)
				.execute();
			wishlistIds = wRows.map((r) => r.event_id);
		}
	}

	const eventIds = events.map((e) => e.id);
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

	const result = events.map((event) => ({
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

	return c.json({
		events: result,
		event_categories: eventCategories,
		communes,
		wishlist_ids: wishlistIds,
	});
});

publicRoutes.get('/events/:slug', async (c) => {
	const db = getDB(c.env.DB);
	const slug = c.req.param('slug');

	const event = await db
		.selectFrom('events as e')
		.leftJoin('event_categories as ec', 'ec.id', 'e.category_id')
		.selectAll('e')
		.select(['ec.name as category_name', 'ec.slug as category_slug'])
		.where('e.slug', '=', slug)
		.where('e.status', '=', 'published')
		.executeTakeFirst();

	if (!event) {
		return c.json({ error: 'Événement introuvable' }, 404);
	}

	const [categories, convoys] = await Promise.all([
		db
			.selectFrom('ticket_categories')
			.selectAll()
			.where('event_id', '=', event.id)
			.orderBy('sort_order', 'asc')
			.execute(),
		db
			.selectFrom('convoys')
			.selectAll()
			.where('event_id', '=', event.id)
			.where('status', '=', 'published')
			.orderBy('departure_at', 'asc')
			.execute(),
	]);

	let wishlisted = false;
	if (c.req.header('cookie')) {
		const sessionRes = await tryCatch(
			getAuth(c.env.DB).api.getSession({ headers: c.req.raw.headers }),
		);
		const userId = sessionRes.ok ? sessionRes.data?.user?.id : undefined;
		if (userId) {
			const wRow = await db
				.selectFrom('wishlists')
				.select(['id'])
				.where('user_id', '=', userId)
				.where('event_id', '=', event.id)
				.executeTakeFirst();
			wishlisted = Boolean(wRow);
		}
	}

	return c.json({
		event: {
			...event,
			wishlisted,
			poster_keys: parsePosterKeys(event.poster_key),
			categories: categories.map((cat) => ({
				...cat,
				remaining: Math.max(0, cat.capacity - cat.reserved_count),
			})),
			convoys: convoys.map((conv) => ({
				...conv,
				remaining: Math.max(0, conv.capacity - conv.reserved_count),
			})),
		},
	});
});

publicRoutes.get('/media/posters/:key{.+}', async (c) => {
	const key = c.req.param('key');
	if (!key || !key.startsWith('events/')) {
		return c.json({ error: 'Clé média invalide' }, 400);
	}

	const object = await c.env.UPLOADS.get(key);
	if (!object) {
		return c.json({ error: 'Image introuvable' }, 404);
	}

	const ifNoneMatch = c.req.header('if-none-match');
	if (ifNoneMatch && object.httpEtag && ifNoneMatch === object.httpEtag) {
		return new Response(null, { status: 304 });
	}

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	if (object.httpEtag) headers.set('ETag', object.httpEtag);
	headers.set('Cache-Control', 'public, max-age=86400');

	return new Response(object.body, { headers });
});
