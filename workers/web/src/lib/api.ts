import { getErrorMessage, tryCatch } from 'utils';

export const API_BASE = '';

export const ABIDJAN_COMMUNES = [
	'Abobo',
	'Adjamé',
	'Anyama',
	'Attécoubé',
	'Bingerville',
	'Cocody',
	'Koumassi',
	'Marcory',
	'Plateau',
	'Port-Bouët',
	'Songon',
	'Treichville',
	'Yopougon',
] as const;

export interface ApiUser {
	id: string;
	name: string;
	email: string;
	phone?: string | null;
	commune?: string | null;
	role: 'client' | 'admin' | 'super_admin';
	permissions: string;
	is_active: number;
}

export interface TicketCategory {
	id: string;
	event_id: string;
	name: string;
	description: string | null;
	price_xof: number;
	capacity: number;
	reserved_count: number;
	remaining: number;
}

export interface Convoy {
	id: string;
	event_id: string;
	name: string;
	commune: string;
	departure_at: string;
	meeting_point: string;
	destination: string;
	trip_type: 'one_way' | 'round_trip';
	price_xof: number;
	capacity: number;
	reserved_count: number;
	remaining: number;
	extra_info: string | null;
}

export function sortConvoysByCommune(
	convoys: Convoy[],
	preferredCommune?: string | null,
): Convoy[] {
	const pref = preferredCommune?.trim().toLowerCase() || '';
	return [...convoys].sort((a, b) => {
		const aMatch = pref && (a.commune || '').toLowerCase() === pref ? 1 : 0;
		const bMatch = pref && (b.commune || '').toLowerCase() === pref ? 1 : 0;
		if (aMatch !== bMatch) return bMatch - aMatch;
		if (b.remaining !== a.remaining) return b.remaining - a.remaining;
		return (a.commune || a.name).localeCompare(b.commune || b.name, 'fr');
	});
}

export interface PublicEvent {
	id: string;
	slug: string;
	title: string;
	description: string;
	poster_key: string | null;
	poster_keys?: string[];
	starts_at: string;
	ends_at: string | null;
	venue: string;
	price_xof: number;
	extra_info: string | null;
	wave_payment_url: string | null;
	categories: TicketCategory[];
	convoys: Convoy[];
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const resResult = await tryCatch(
		fetch(`${API_BASE}${path}`, {
			...init,
			credentials: 'include',
			headers: {
				...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
				...(init.headers || {}),
			},
		}),
	);

	if (!resResult.ok) {
		throw new Error(getErrorMessage(resResult.error, 'Erreur réseau'));
	}

	const res = resResult.data;
	const jsonResult = await tryCatch(res.json());
	const data = jsonResult.ok ? (jsonResult.data as Record<string, unknown>) : {};

	if (!res.ok) {
		throw new Error(
			(data.error as string) || (data.message as string) || `Erreur ${res.status}`,
		);
	}
	return data as T;
}

export function formatXof(amount: number): string {
	return `${new Intl.NumberFormat('fr-FR').format(amount)} FCFA`;
}

export function formatDate(iso: string): string {
	return new Intl.DateTimeFormat('fr-FR', {
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(new Date(iso));
}

export function posterUrl(key: string | null): string | null {
	if (!key) return null;
	return `${API_BASE}/api/media/posters/${key}`;
}

export function getEventPosterUrls(ev: {
	poster_key?: string | null;
	poster_keys?: string[];
}): string[] {
	if (Array.isArray(ev.poster_keys) && ev.poster_keys.length > 0) {
		return ev.poster_keys.map((k) => `${API_BASE}/api/media/posters/${k}`);
	}
	if (ev.poster_key && !ev.poster_key.startsWith('[')) {
		return [`${API_BASE}/api/media/posters/${ev.poster_key}`];
	}
	return [];
}
