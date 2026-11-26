import { useEffect, useState } from 'preact/hooks';
import { Calendar, MapPin, Search, Tag, Heart } from 'lucide-preact';
import {
	ABIDJAN_COMMUNES,
	ApiError,
	apiFetch,
	formatDate,
	formatXof,
	getEventPosterUrls,
	sortConvoysByCommune,
	type CommuneItem,
	type EventCategory,
	type PublicEvent,
} from '../lib/api';
import EventImageCarousel from './EventImageCarousel';
import CartoonShuttle from './CartoonShuttle';

export default function EventsCatalog() {
	const [events, setEvents] = useState<PublicEvent[]>([]);
	const [eventCategories, setEventCategories] = useState<EventCategory[]>([]);
	const [communeOptions, setCommuneOptions] = useState<string[]>([...ABIDJAN_COMMUNES]);
	const [searchQuery, setSearchQuery] = useState('');
	const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
	const [commune, setCommune] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
	const [togglingWishlistId, setTogglingWishlistId] = useState<string | null>(null);

	useEffect(() => {
		const saved = localStorage.getItem('eventrip_commune') || '';
		setCommune(saved);
		apiFetch<{
			events: PublicEvent[];
			event_categories?: EventCategory[];
			communes?: CommuneItem[];
			wishlist_ids?: string[];
		}>('/api/events')
			.then((data) => {
				setEvents(data.events);
				setEventCategories(data.event_categories || []);
				if (data.communes && data.communes.length > 0) {
					setCommuneOptions(data.communes.map((c) => c.name));
				}
				setWishlistIds(new Set(data.wishlist_ids || []));
			})
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, []);

	async function handleToggleWishlist(e: Event, eventId: string) {
		e.preventDefault();
		e.stopPropagation();
		if (togglingWishlistId === eventId) return;
		const isSaved = wishlistIds.has(eventId);
		setTogglingWishlistId(eventId);
		try {
			await apiFetch(`/api/wishlists/${eventId}`, {
				method: isSaved ? 'DELETE' : 'POST',
			});
			setWishlistIds((prev) => {
				const next = new Set(prev);
				if (isSaved) next.delete(eventId);
				else next.add(eventId);
				return next;
			});
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				window.location.href = '/auth?next=/';
				return;
			}
			setError(err instanceof Error ? err.message : 'Impossible de mettre à jour vos favoris');
		} finally {
			setTogglingWishlistId(null);
		}
	}

	function handleCommuneChange(value: string) {
		setCommune(value);
		if (value) {
			localStorage.setItem('eventrip_commune', value);
		} else {
			localStorage.removeItem('eventrip_commune');
		}
	}

	const q = searchQuery.trim().toLowerCase();
	const matchedEvents = events.filter((ev) => {
		if (selectedCategoryId && ev.category_id !== selectedCategoryId) return false;
		if (q) {
			const hay = `${ev.title} ${ev.venue} ${ev.description || ''} ${ev.category_name || ''}`.toLowerCase();
			if (!hay.includes(q)) return false;
		}
		return true;
	});

	const normalizedCommune = commune.trim().toLowerCase();
	const filteredEvents = normalizedCommune
		? [...matchedEvents].sort((a, b) => {
				const score = (ev: PublicEvent) => {
					const matching = ev.convoys.filter(
						(cv) => (cv.commune || '').trim().toLowerCase() === normalizedCommune,
					);
					if (matching.some((cv) => cv.remaining > 0)) return 0;
					if (matching.length > 0) return 1;
					return 2;
				};
				return score(a) - score(b);
			})
		: matchedEvents;

	function scrollToGrid(e: Event) {
		e.preventDefault();
		document.getElementById('events-grid')?.scrollIntoView({ behavior: 'smooth' });
	}

	return (
		<div>
			{/* Hero 2 colonnes (style 1.jpg) avec sphères hachurées (style 2.jpg / guide.md) */}
			<section class="relative overflow-hidden bg-white">
				{/* Sphères hachurées décoratives */}
				<div
					class="pointer-events-none absolute -top-24 -right-20 h-72 w-72 rounded-full bg-hatched-gold opacity-80"
					aria-hidden="true"
				/>
				<div
					class="pointer-events-none absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-hatched-gold opacity-70"
					aria-hidden="true"
				/>
				<div
					class="pointer-events-none absolute top-12 left-[46%] hidden lg:block h-24 w-24 rounded-full bg-hatched-slate opacity-60"
					aria-hidden="true"
				/>

				<div class="relative mx-auto max-w-6xl px-4 pt-10 pb-12 sm:px-6 lg:pt-14 lg:pb-16">
					<div class="grid grid-cols-1 items-center gap-8 lg:grid-cols-12">
						<div class="min-w-0 lg:col-span-7 space-y-5">
							<h1 class="text-3xl sm:text-5xl font-black tracking-tight text-slate-950 leading-[1.08]">
								Votre billet pour la{' '}
								<span class="text-brand-600">prochaine grande sortie</span>.
							</h1>
							<p class="max-w-xl text-base sm:text-lg text-slate-600">
								Réservez l’accès à l’événement et votre convoi aller-retour depuis votre commune, au même endroit.
							</p>

							{/* Barre de recherche segmentée flottante (1.jpg & 2.jpg) */}
							<form
								onSubmit={scrollToGrid}
								class="mt-6 flex flex-col gap-2 rounded-2xl border border-slate-200/90 bg-white p-2 shadow-lg shadow-slate-200/50 sm:flex-row sm:items-center"
							>
								<div class="flex flex-1 min-w-[185px] items-center gap-2 px-3 py-2">
									<Search class="h-4 w-4 text-slate-400 shrink-0" />
									<input
										id="catalog-search"
										name="q"
										type="text"
										aria-label="Rechercher un événement"
										placeholder="Rechercher un événement, lieu..."
										value={searchQuery}
										onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
										class="w-full min-w-0 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
									/>
								</div>

								<div class="hidden sm:block h-6 w-px bg-slate-200 shrink-0" aria-hidden="true" />

								<div class="flex items-center gap-1.5 px-2.5 py-2 sm:w-36 shrink-0">
									<MapPin class="h-4 w-4 text-brand-600 shrink-0" />
									<select
										id="catalog-commune"
										name="commune"
										aria-label="Commune de départ"
										value={commune}
										onChange={(e) => handleCommuneChange((e.target as HTMLSelectElement).value)}
										class="w-full min-w-0 bg-transparent text-sm font-medium text-slate-700 focus:outline-none cursor-pointer"
									>
										<option value="">Départ (tous)</option>
										{communeOptions.map((c) => (
											<option key={c} value={c}>
												{c}
											</option>
										))}
									</select>
								</div>

								<div class="hidden sm:block h-6 w-px bg-slate-200 shrink-0" aria-hidden="true" />

								<div class="flex items-center gap-1.5 px-2.5 py-2 sm:w-36 shrink-0">
									<Tag class="h-4 w-4 text-slate-400 shrink-0" />
									<select
										id="catalog-category"
										name="category_id"
										aria-label="Catégorie d'événement"
										value={selectedCategoryId}
										onChange={(e) =>
											setSelectedCategoryId((e.target as HTMLSelectElement).value)
										}
										class="w-full min-w-0 bg-transparent text-sm font-medium text-slate-700 focus:outline-none cursor-pointer"
									>
										<option value="">Catégorie</option>
										{eventCategories.map((cat) => (
											<option key={cat.id} value={cat.id}>
												{cat.name}
											</option>
										))}
									</select>
								</div>

								<button
									type="submit"
									class="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 transition-colors cursor-pointer shrink-0"
								>
									Explorer
								</button>
							</form>
						</div>

						<div class="lg:col-span-5">
							<CartoonShuttle />
						</div>
					</div>
				</div>

				{/* Séparateur bande hachurée diagonale (guide.md §1) */}
				<div class="h-3 w-full border-y border-slate-200/70 bg-hatched-slate" aria-hidden="true" />
			</section>

			{/* Section Catalogue d'événements */}
			<section id="events-grid" class="mx-auto max-w-6xl px-4 pt-12 pb-6 sm:px-6">
				<div class="mb-8 flex flex-wrap items-center justify-between gap-4">
					<div>
						<h2 class="text-2xl font-extrabold tracking-tight text-slate-950">
							Événements à l’affiche
						</h2>
						<p class="mt-0.5 text-sm text-slate-500">
							{commune
								? `Départs priorisés depuis ${commune}`
								: 'Sélectionnez votre commune pour prioriser les départs les plus proches'}
						</p>
					</div>

					{/* Filtres rapides par puces de catégorie */}
					{eventCategories.length > 0 && (
						<div class="flex flex-wrap items-center gap-1.5">
							<button
								type="button"
								aria-pressed={selectedCategoryId === ''}
								onClick={() => setSelectedCategoryId('')}
								class={`rounded-full px-3.5 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${
									selectedCategoryId === ''
										? 'bg-slate-900 text-white border-slate-900'
										: 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'
								}`}
							>
								Tous
							</button>
							{eventCategories.map((cat) => (
								<button
									key={cat.id}
									type="button"
									aria-pressed={selectedCategoryId === cat.id}
									onClick={() => setSelectedCategoryId(cat.id)}
									class={`rounded-full px-3.5 py-1.5 text-xs font-bold border transition-colors cursor-pointer ${
										selectedCategoryId === cat.id
											? 'bg-brand-600 text-white border-brand-600'
											: 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'
									}`}
								>
									{cat.name}
								</button>
							))}
						</div>
					)}
				</div>

				{loading ? (
					<div class="grid grid-cols-1 gap-7 sm:grid-cols-2 lg:grid-cols-3">
						{[1, 2, 3].map((n) => (
							<div
								key={n}
								class="h-88 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse"
							/>
						))}
					</div>
				) : error ? (
					<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
						Impossible de charger les événements : {error}
					</div>
				) : filteredEvents.length === 0 ? (
					<div class="rounded-2xl border border-slate-200 bg-slate-50/60 p-12 text-center">
						<Calendar class="mx-auto h-10 w-10 text-brand-600 mb-3" />
						<h3 class="text-lg font-bold text-slate-900">Aucun événement trouvé</h3>
						<p class="mt-1 text-sm text-slate-500">
							Essayez de modifier votre recherche ou de réinitialiser les filtres.
						</p>
						{(searchQuery || selectedCategoryId) && (
							<button
								type="button"
								onClick={() => {
									setSearchQuery('');
									setSelectedCategoryId('');
								}}
								class="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
							>
								Réinitialiser les filtres
							</button>
						)}
					</div>
				) : (
					<div class="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
						{filteredEvents.map((event) => {
							const prioritizedConvoys = sortConvoysByCommune(event.convoys, commune);
							const displayPrice =
								event.price_xof > 0
									? event.price_xof
									: event.categories.length > 0
										? Math.min(...event.categories.map((c) => c.price_xof))
										: null;
							const posterUrls = getEventPosterUrls(event);

							const communeCounts = new Map<string, number>();
							for (const cv of prioritizedConvoys) {
								const key = (cv.commune || cv.name).trim().toLowerCase();
								communeCounts.set(key, (communeCounts.get(key) || 0) + 1);
							}

							const renderChips = (copyKey: string) =>
								prioritizedConvoys.map((cv) => {
									const isMatch =
										Boolean(commune) &&
										(cv.commune || '').toLowerCase() === commune.toLowerCase();
									const baseLabel = cv.commune || cv.name;
									const hasMultipleInCommune =
										(communeCounts.get(baseLabel.trim().toLowerCase()) || 0) > 1;
									const label =
										hasMultipleInCommune && cv.meeting_point
											? `${baseLabel} (${cv.meeting_point})`
											: baseLabel;
									return (
										<span
											key={`${copyKey}-${cv.id}`}
											class={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold border ${
												isMatch
													? 'bg-brand-600 text-white border-brand-600'
													: 'bg-white text-slate-700 border-slate-200/90'
											}`}
										>
											<MapPin
												class={`h-3 w-3 ${isMatch ? 'text-white' : 'text-brand-600'}`}
											/>
											<span>
												{label} • {cv.remaining}/{cv.capacity} dispo
											</span>
										</span>
									);
								});

							const isSaved = wishlistIds.has(event.id);
							const eventHref = `/events/${event.slug}`;

							return (
								<div key={event.id} class="relative pt-3.5 flex flex-col min-w-0 max-w-full">
									{/* Badge catégorie flottant hors-cadre en haut à gauche (2.jpg & guide.md §3) */}
									{event.category_name && (
										<span class="pointer-events-none absolute top-0 left-4 z-20 inline-flex items-center rounded-full border border-slate-200 bg-white px-3.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-800 shadow-xs">
											{event.category_name}
										</span>
									)}

									<button
										type="button"
										onClick={(e) => handleToggleWishlist(e, event.id)}
										disabled={togglingWishlistId === event.id}
										title={isSaved ? 'Retirer des favoris' : 'Ajouter aux favoris'}
										aria-label={isSaved ? 'Retirer des favoris' : 'Ajouter aux favoris'}
										class={`absolute top-6 right-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-all cursor-pointer ${
											isSaved
												? 'border-red-200 bg-white text-red-500 hover:bg-red-50'
												: 'border-slate-200/90 bg-white/95 text-slate-600 hover:text-red-500 hover:border-red-200'
										}`}
									>
										<Heart class={`h-4 w-4 ${isSaved ? 'fill-red-500 text-red-500' : ''}`} />
									</button>

									<div class="group flex flex-1 flex-col min-w-0 w-full overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs hover:border-slate-300 hover:shadow-md transition-all">
										<EventImageCarousel
											urls={posterUrls}
											alt={event.title}
											aspectClass="aspect-[16/10]"
											href={eventHref}
										/>

										<a href={eventHref} class="flex flex-1 flex-col min-w-0 w-full">
											{/* Bandeau horizontal des départs sous l'image (2.jpg + marquee déterministe) */}
											{prioritizedConvoys.length > 0 && (
												<div class="w-full min-w-0 overflow-hidden border-y border-slate-100 bg-slate-50/90 py-2 px-3">
													{prioritizedConvoys.length === 1 ? (
														<div class="flex items-center gap-2">
															{renderChips('single')}
														</div>
													) : (
														<div class="animate-departure-marquee gap-2">
															<div class="flex items-center gap-2 pr-2">
																{renderChips('a')}
															</div>
															<div
																class="flex items-center gap-2 pr-2"
																aria-hidden="true"
															>
																{renderChips('b')}
															</div>
														</div>
													)}
												</div>
											)}

											<div class="flex flex-1 flex-col p-5">
												<h3 class="text-lg font-bold text-slate-950 group-hover:text-brand-700 transition-colors leading-snug">
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
															<p class="text-sm font-medium text-slate-500">
																Tarif à venir
															</p>
														)}
													</div>
													<span class="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white shadow-xs group-hover:bg-brand-700 transition-colors">
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
			</section>
		</div>
	);
}
