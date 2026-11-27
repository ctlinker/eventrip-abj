import type { APIRoute } from 'astro';
import { fetchCatalogSSR, getSiteOrigin, toAbsoluteUrl } from '../lib/ssr';

const FALLBACK_COMMUNE_SLUGS = [
	'abobo',
	'adjame',
	'anyama',
	'attecoube',
	'bingerville',
	'cocody',
	'koumassi',
	'marcory',
	'plateau',
	'port-bouet',
	'songon',
	'treichville',
	'yopougon',
];

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function toIsoDate(value?: string | null): string | null {
	if (!value) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface SitemapEntry {
	loc: string;
	lastmod?: string | null;
	changefreq: 'daily' | 'weekly';
	priority: string;
}

export const GET: APIRoute = async ({ request, url }) => {
	const siteOrigin = getSiteOrigin(url);
	const catalog = await fetchCatalogSSR(request);

	const entries: SitemapEntry[] = [
		{
			loc: toAbsoluteUrl('/', siteOrigin),
			changefreq: 'daily',
			priority: '1.0',
		},
	];

	for (const ev of catalog.events) {
		entries.push({
			loc: toAbsoluteUrl(`/events/${encodeURIComponent(ev.slug)}`, siteOrigin),
			lastmod: toIsoDate(ev.updated_at || ev.created_at),
			changefreq: 'daily',
			priority: '0.9',
		});
	}

	const communeSlugs =
		catalog.communes.length > 0
			? catalog.communes.map((c) => c.slug)
			: FALLBACK_COMMUNE_SLUGS;

	for (const slug of communeSlugs) {
		entries.push({
			loc: toAbsoluteUrl(`/convois/${encodeURIComponent(slug)}`, siteOrigin),
			changefreq: 'weekly',
			priority: '0.7',
		});
	}

	for (const cat of catalog.eventCategories) {
		entries.push({
			loc: toAbsoluteUrl(`/categories/${encodeURIComponent(cat.slug)}`, siteOrigin),
			changefreq: 'weekly',
			priority: '0.7',
		});
	}

	const xmlLines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...entries.map((entry) => {
			const parts = [
				'  <url>',
				`    <loc>${escapeXml(entry.loc)}</loc>`,
				...(entry.lastmod ? [`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`] : []),
				`    <changefreq>${entry.changefreq}</changefreq>`,
				`    <priority>${entry.priority}</priority>`,
				'  </url>',
			];
			return parts.join('\n');
		}),
		'</urlset>',
	];

	return new Response(xmlLines.join('\n'), {
		status: 200,
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': 'public, max-age=900, s-maxage=900',
		},
	});
};
