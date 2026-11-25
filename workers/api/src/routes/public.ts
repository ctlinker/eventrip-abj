import { Hono } from 'hono';
import { getDB } from 'db';
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

publicRoutes.get('/events', async (c) => {
	const db = getDB(c.env.DB);
	const [events, eventCategories] = await Promise.all([
		db
			.selectFrom('events as e')
			.leftJoin('event_categories as ec', 'ec.id', 'e.category_id')
			.selectAll('e')
			.select(['ec.name as category_name', 'ec.slug as category_slug'])
			.where('e.status', '=', 'published')
			.orderBy('e.starts_at', 'asc')
			.execute(),
		db.selectFrom('event_categories').selectAll().orderBy('name', 'asc').execute(),
	]);

	if (events.length === 0) {
		return c.json({ events: [], event_categories: eventCategories });
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

	return c.json({ events: result, event_categories: eventCategories });
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

	return c.json({
		event: {
			...event,
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
