import { formatDate, formatXof, getEventPosterUrls, type PublicEvent } from './api';
import { toAbsoluteUrl } from './ssr';

export const SITE_NAME = 'EVENTRIP-ABJ';

export const DEFAULT_SITE_DESCRIPTION =
	"Billetterie événementielle et convois aller-retour en Côte d'Ivoire. Réservez votre ticket et votre départ depuis Cocody, Yopougon, Marcory, Plateau ou Abobo avec paiement Wave sécurisé.";

export function truncateMetaDescription(text: string, maxLen = 158): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (clean.length <= maxLen) return clean;
	const sliced = clean.slice(0, maxLen - 1);
	const lastSpace = sliced.lastIndexOf(' ');
	return `${(lastSpace > 90 ? sliced.slice(0, lastSpace) : sliced).trim()}…`;
}

export function getEventStartingPrice(event: PublicEvent): number | null {
	if (event.price_xof > 0) return event.price_xof;
	if (event.categories.length > 0) {
		return Math.min(...event.categories.map((c) => c.price_xof));
	}
	return null;
}

export function getEventCommuneNames(event: PublicEvent): string[] {
	const seen = new Set<string>();
	const names: string[] = [];
	for (const cv of event.convoys) {
		const raw = (cv.commune || cv.name || '').trim();
		if (!raw) continue;
		const key = raw.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			names.push(raw);
		}
	}
	return names;
}

export function buildEventMetaDescription(event: PublicEvent): string {
	const dateLabel = formatDate(event.starts_at);
	const price = getEventStartingPrice(event);
	const pricePart = price !== null ? ` dès ${formatXof(price)}` : '';
	const communes = getEventCommuneNames(event);
	const communePart =
		communes.length > 0 ? ` Départs A/R : ${communes.slice(0, 3).join(', ')}.` : '';
	const descSnippet = event.description ? ` ${event.description}` : '';

	return truncateMetaDescription(
		`${event.title} le ${dateLabel} à ${event.venue}${pricePart}.${communePart}${descSnippet}`,
	);
}

/**
 * Sérialise du JSON-LD en échappant `<` pour empêcher toute injection `</script>` depuis un contenu libre.
 */
export function serializeJsonLd(data: unknown): string {
	return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function buildBreadcrumbJsonLd(
	items: Array<{ name: string; path: string }>,
	siteOrigin: string,
): Record<string, unknown> {
	return {
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: items.map((item, idx) => ({
			'@type': 'ListItem',
			position: idx + 1,
			name: item.name,
			item: toAbsoluteUrl(item.path, siteOrigin),
		})),
	};
}

export function buildHomeJsonLd(params: {
	siteOrigin: string;
	contactNum: string;
	events: PublicEvent[];
}): Record<string, unknown>[] {
	const { siteOrigin, contactNum, events } = params;
	const orgId = `${siteOrigin}/#organization`;
	const websiteId = `${siteOrigin}/#website`;

	const schemas: Record<string, unknown>[] = [
		{
			'@context': 'https://schema.org',
			'@type': 'Organization',
			'@id': orgId,
			name: SITE_NAME,
			url: siteOrigin,
			logo: toAbsoluteUrl('/icon-512.png', siteOrigin),
			areaServed: {
				'@type': 'Country',
				name: "Côte d'Ivoire",
				identifier: 'CI',
			},
			contactPoint: [
				{
					'@type': 'ContactPoint',
					telephone: contactNum,
					contactType: 'customer support',
					areaServed: 'CI',
					availableLanguage: ['fr'],
				},
			],
		},
		{
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			'@id': websiteId,
			name: SITE_NAME,
			url: siteOrigin,
			inLanguage: 'fr-CI',
			publisher: { '@id': orgId },
			potentialAction: {
				'@type': 'SearchAction',
				target: {
					'@type': 'EntryPoint',
					urlTemplate: `${siteOrigin}/?q={search_term_string}`,
				},
				'query-input': 'required name=search_term_string',
			},
		},
	];

	if (events.length > 0) {
		schemas.push({
			'@context': 'https://schema.org',
			'@type': 'ItemList',
			name: "Événements & Convois à l'affiche en Côte d'Ivoire",
			itemListElement: events.slice(0, 24).map((ev, idx) => ({
				'@type': 'ListItem',
				position: idx + 1,
				name: ev.title,
				url: toAbsoluteUrl(`/events/${ev.slug}`, siteOrigin),
			})),
		});
	}

	return schemas;
}

export function buildEventJsonLd(params: {
	event: PublicEvent;
	siteOrigin: string;
}): Record<string, unknown> {
	const { event, siteOrigin } = params;
	const eventUrl = toAbsoluteUrl(`/events/${event.slug}`, siteOrigin);
	const posterUrls = getEventPosterUrls(event).map((u) => toAbsoluteUrl(u, siteOrigin));
	const images =
		posterUrls.length > 0 ? posterUrls : [toAbsoluteUrl('/icon-512.png', siteOrigin)];

	const startingPrice = getEventStartingPrice(event);
	const hasAvailableStock =
		event.convoys.length > 0
			? event.convoys.some((cv) => cv.remaining > 0)
			: event.categories.length > 0
				? event.categories.some((cat) => cat.remaining > 0)
				: true;

	const offer: Record<string, unknown> = {
		'@type': 'Offer',
		url: eventUrl,
		priceCurrency: 'XOF',
		price: startingPrice ?? 0,
		availability: hasAvailableStock
			? 'https://schema.org/InStock'
			: 'https://schema.org/SoldOut',
		validFrom: event.sales_start_at || event.created_at || event.starts_at,
	};

	const schema: Record<string, unknown> = {
		'@context': 'https://schema.org',
		'@type': 'Event',
		name: event.title,
		description: event.description,
		startDate: event.starts_at,
		...(event.ends_at ? { endDate: event.ends_at } : {}),
		eventStatus: 'https://schema.org/EventScheduled',
		eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
		image: images,
		url: eventUrl,
		location: {
			'@type': 'Place',
			name: event.venue,
			address: {
				'@type': 'PostalAddress',
				addressLocality: 'Abidjan',
				addressCountry: 'CI',
			},
		},
		organizer: {
			'@type': 'Organization',
			name: SITE_NAME,
			url: siteOrigin,
		},
		offers: offer,
	};

	return schema;
}
