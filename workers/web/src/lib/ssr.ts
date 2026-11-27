import { env } from 'cloudflare:workers';
import { tryCatch, tryCatchSync } from 'utils';
import type { ApiUser, CommuneItem, EventCategory, PublicEvent } from './api';

type WebEnv = Partial<Env> & {
	CONTACT_NUM?: string;
	SITE_URL?: string;
};

function getWebEnv(): WebEnv {
	return (env as WebEnv) || {};
}

export function getContactNumber(): string {
	return getWebEnv().CONTACT_NUM || '+2250545990099';
}

/**
 * Détermine l'origine canonique publique (toujours en https:// hors localhost, sans www. ni slash final).
 */
export function getSiteOrigin(astroUrl: URL): string {
	const configured = getWebEnv().SITE_URL?.trim();
	if (configured) {
		return configured.replace(/\/+$/, '');
	}

	if (astroUrl.hostname === 'localhost' || astroUrl.hostname === '127.0.0.1') {
		return astroUrl.origin;
	}

	const normalizedHost = astroUrl.host.replace(/^www\./i, '');
	return `https://${normalizedHost}`;
}

export function toAbsoluteUrl(pathOrUrl: string, siteOrigin: string): string {
	if (/^https?:\/\//i.test(pathOrUrl)) {
		return pathOrUrl;
	}
	const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
	return `${siteOrigin}${cleanPath}`;
}

async function fetchFromApiSSR(path: string, request?: Request): Promise<Response | null> {
	const headers = new Headers();
	const cookie = request?.headers.get('cookie');
	if (cookie) {
		headers.set('cookie', cookie);
	}

	const api = getWebEnv().API;
	if (api) {
		const res = await tryCatch(
			api.fetch(
				new Request(`http://internal${path}`, {
					headers,
				}),
			),
		);
		if (res.ok && res.data.status < 502) {
			return res.data;
		}
	}

	// Repli local uniquement en développement (astro dev + wrangler dev séparé sur 127.0.0.1:8787)
	if (request) {
		const reqUrlResult = tryCatchSync(() => new URL(request.url));
		const isLocal =
			reqUrlResult.ok &&
			(reqUrlResult.data.hostname === 'localhost' ||
				reqUrlResult.data.hostname === '127.0.0.1');
		if (isLocal) {
			const fallback = await tryCatch(
				fetch(`http://127.0.0.1:8787${path}`, {
					headers,
				}),
			);
			if (fallback.ok) {
				return fallback.data;
			}
		}
	}

	return null;
}

export async function fetchSessionUserSSR(request: Request): Promise<{
	user: ApiUser | null;
	ssrResolved: boolean;
}> {
	const cookie = request.headers.get('cookie');
	if (!cookie) {
		return { user: null, ssrResolved: true };
	}

	const res = await fetchFromApiSSR('/api/auth/get-session', request);
	if (!res || !res.ok) {
		return { user: null, ssrResolved: false };
	}

	const json = await tryCatch(res.json() as Promise<{ user?: ApiUser } | null>);
	if (!json.ok) {
		return { user: null, ssrResolved: false };
	}

	return {
		user: json.data?.user ?? null,
		ssrResolved: true,
	};
}

export interface CatalogSSRData {
	ok: boolean;
	events: PublicEvent[];
	eventCategories: EventCategory[];
	communes: CommuneItem[];
	wishlistIds: string[];
}

export async function fetchCatalogSSR(request: Request): Promise<CatalogSSRData> {
	const res = await fetchFromApiSSR('/api/events', request);
	if (!res || !res.ok) {
		return {
			ok: false,
			events: [],
			eventCategories: [],
			communes: [],
			wishlistIds: [],
		};
	}

	const json = await tryCatch(
		res.json() as Promise<{
			events?: PublicEvent[];
			event_categories?: EventCategory[];
			communes?: CommuneItem[];
			wishlist_ids?: string[];
		}>,
	);
	if (!json.ok || !json.data) {
		return {
			ok: false,
			events: [],
			eventCategories: [],
			communes: [],
			wishlistIds: [],
		};
	}

	return {
		ok: true,
		events: json.data.events ?? [],
		eventCategories: json.data.event_categories ?? [],
		communes: json.data.communes ?? [],
		wishlistIds: json.data.wishlist_ids ?? [],
	};
}

export interface EventDetailSSRData {
	ok: boolean;
	notFound: boolean;
	event: PublicEvent | null;
}

export async function fetchEventBySlugSSR(
	slug: string,
	request: Request,
): Promise<EventDetailSSRData> {
	if (!slug) {
		return { ok: false, notFound: true, event: null };
	}

	const res = await fetchFromApiSSR(`/api/events/${encodeURIComponent(slug)}`, request);
	if (!res) {
		return { ok: false, notFound: false, event: null };
	}

	if (res.status === 404) {
		return { ok: false, notFound: true, event: null };
	}

	if (!res.ok) {
		return { ok: false, notFound: false, event: null };
	}

	const json = await tryCatch(res.json() as Promise<{ event?: PublicEvent }>);
	if (!json.ok || !json.data?.event) {
		return { ok: false, notFound: false, event: null };
	}

	return {
		ok: true,
		notFound: false,
		event: json.data.event,
	};
}
