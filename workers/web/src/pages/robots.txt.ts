import type { APIRoute } from 'astro';
import { getSiteOrigin } from '../lib/ssr';

export const GET: APIRoute = ({ url }) => {
	const siteOrigin = getSiteOrigin(url);
	const body = [
		'User-agent: *',
		'Allow: /',
		'Allow: /api/media/posters/',
		'Disallow: /api/',
		'Disallow: /admin/',
		'Disallow: /orders/',
		'Disallow: /tickets',
		'Disallow: /wishlist',
		'Disallow: /settings',
		'Disallow: /auth',
		'Disallow: /forgot-password',
		'Disallow: /reset-password',
		'',
		`Sitemap: ${siteOrigin}/sitemap.xml`,
		'',
	].join('\n');

	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'public, max-age=3600, s-maxage=3600',
		},
	});
};
