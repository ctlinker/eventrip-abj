import { useEffect, useState } from 'preact/hooks';
import { Heart, MapPin, Compass } from 'lucide-preact';
import {
	ApiError,
	apiFetch,
	formatDate,
	formatXof,
	getEventPosterUrls,
	sortConvoysByCommune,
	type PublicEvent,
} from '../lib/api';
import EventImageCarousel from './EventImageCarousel';

export default function WishlistPage() {
	const [events, setEvents] = useState<PublicEvent[]>([]);
	const [commune, setCommune] = useState('');
	const [loading, setLoading] = useState(true);
	const [unauthorized, setUnauthorized] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [removingId, setRemovingId] = useState<string | null>(null);

	useEffect(() => {
		setCommune(localStorage.getItem('eventrip_commune') || '');
		apiFetch<{ event_ids: string[]; events: PublicEvent[] }>('/api/wishlists')
			.then((data) => {
				setEvents(data.events || []);
			})
			.catch((err) => {
				if (err instanceof ApiError && err.status === 401) {
					setUnauthorized(true);
					return;
				}
				setError(err instanceof Error ? err.message : 'Erreur de chargement');
			})
			.finally(() => setLoading(false));
	}, []);

	async function handleRemove(eventId: string) {
		if (removingId === eventId) return;
		setRemovingId(eventId);
		try {
			await apiFetch(`/api/wishlists/${eventId}`, { method: 'DELETE' });
			setEvents((prev) => prev.filter((ev) => ev.id !== eventId));
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Impossible de retirer ce favori');
		} finally {
			setRemovingId(null);
		}
	}

	if (loading) {
		return (
			<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{[1, 2, 3].map((n) => (
					<div
						key={n}
						class="h-80 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse"
					/>
				))}
			</div>
		);
	}

	if (unauthorized) {
		return (
			<div class="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-4">
				<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
					<Heart class="h-6 w-6" />
				</div>
				<h2 class="text-lg font-bold text-slate-950">Connectez-vous pour voir vos favoris</h2>
				<p class="text-sm text-slate-600 max-w-md mx-auto">
					Retrouvez ici les concerts, festivals et sorties que vous avez sauvegardés.
				</p>
				<a
					href="/auth?next=/wishlist"
					class="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition-colors"
				>
					Se connecter
				</a>
			</div>
		);
	}

	return (
		<div class="space-y-6">
			{error && (
				<div class="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
					{error}
				</div>
			)}

			{events.length === 0 ? (
				<div class="rounded-2xl border border-slate-200 bg-white p-10 text-center space-y-4">
					<div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
						<Heart class="h-6 w-6" />
					</div>
					<h2 class="text-lg font-bold text-slate-950">Votre liste de souhaits est vide</h2>
					<p class="text-sm text-slate-500 max-w-md mx-auto">
						Cliquez sur le cœur d’un événement pour le retrouver facilement ici avant de réserver votre place.
					</p>
					<a
						href="/"
						class="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 transition-colors"
					>
						<Compass class="h-4 w-4" />
						Explorer les événements
					</a>
				</div>
			) : (
				<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{events.map((event) => {
						const posterUrls = getEventPosterUrls(event);
						const prioritizedConvoys = sortConvoysByCommune(event.convoys, commune);
						const displayPrice =
							event.price_xof > 0 ? event.price_xof : event.categories?.[0]?.price_xof ?? null;

						const eventHref = `/events/${event.slug}`;

						return (
							<div key={event.id} class="relative pt-3.5 flex flex-col min-w-0 max-w-full">
								{event.category_name && (
									<span class="pointer-events-none absolute top-0 left-4 z-20 inline-flex items-center rounded-full border border-slate-200 bg-white px-3.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-800 shadow-xs">
										{event.category_name}
									</span>
								)}

								<button
									type="button"
									onClick={() => handleRemove(event.id)}
									disabled={removingId === event.id}
									title="Retirer des favoris"
									aria-label="Retirer des favoris"
									class="absolute top-6 right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-red-200 bg-white text-red-500 shadow-sm hover:bg-red-50 transition-colors cursor-pointer"
								>
									<Heart class="h-4 w-4 fill-red-500 text-red-500" />
								</button>

								<div class="group flex flex-1 flex-col min-w-0 w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs hover:border-slate-300 hover:shadow-md transition-all">
									<EventImageCarousel
										urls={posterUrls}
										alt={event.title}
										aspectClass="aspect-[16/10]"
										href={eventHref}
									/>

									<a href={eventHref} class="flex flex-1 flex-col min-w-0 w-full">
										{prioritizedConvoys.length > 0 && (
											<div class="flex flex-wrap items-center gap-1.5 border-y border-slate-100 bg-slate-50/90 px-3 py-2">
												{prioritizedConvoys.slice(0, 3).map((cv) => (
													<span
														key={cv.id}
														class="inline-flex items-center gap-1 rounded-lg border border-slate-200/90 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700"
													>
														<MapPin class="h-3 w-3 text-emerald-600" />
														{cv.commune || cv.name} • {cv.remaining}/{cv.capacity} dispo
													</span>
												))}
											</div>
										)}

										<div class="flex flex-1 flex-col p-5">
											<h3 class="text-lg font-bold text-slate-950 group-hover:text-emerald-700 transition-colors leading-snug">
												{event.title}
											</h3>
											<p class="mt-1.5 text-xs font-medium text-slate-500 truncate">
												{formatDate(event.starts_at)} • {event.venue}
											</p>
											<div class="mt-auto pt-5 flex items-center justify-between gap-3">
												<div>
													{displayPrice !== null ? (
														<p class="text-xl font-black tracking-tight text-slate-950">
															{formatXof(displayPrice)}
														</p>
													) : (
														<p class="text-sm font-medium text-slate-500">Tarif à venir</p>
													)}
												</div>
												<span class="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow-xs group-hover:bg-emerald-700 transition-colors">
													Réserver
												</span>
											</div>
										</div>
									</a>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
