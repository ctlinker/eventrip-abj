import { useEffect, useState } from 'preact/hooks';
import { Calendar, MapPin, ArrowRight, Bus } from 'lucide-preact';
import {
	ABIDJAN_COMMUNES,
	apiFetch,
	formatDate,
	formatXof,
	getEventPosterUrls,
	sortConvoysByCommune,
	type EventCategory,
	type PublicEvent,
} from '../lib/api';
import EventImageCarousel from './EventImageCarousel';

export default function EventsCatalog() {
	const [events, setEvents] = useState<PublicEvent[]>([]);
	const [eventCategories, setEventCategories] = useState<EventCategory[]>([]);
	const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
	const [commune, setCommune] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const saved = localStorage.getItem('eventrip_commune') || '';
		setCommune(saved);
		apiFetch<{ events: PublicEvent[]; event_categories?: EventCategory[] }>('/api/events')
			.then((data) => {
				setEvents(data.events);
				setEventCategories(data.event_categories || []);
			})
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, []);

	function handleCommuneChange(value: string) {
		setCommune(value);
		if (value) {
			localStorage.setItem('eventrip_commune', value);
		} else {
			localStorage.removeItem('eventrip_commune');
		}
	}

	if (loading) {
		return (
			<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{[1, 2, 3].map((n) => (
					<div key={n} class="h-80 rounded-2xl border border-green-100 bg-green-50/40 animate-pulse" />
				))}
			</div>
		);
	}

	if (error) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				Impossible de charger les événements : {error}
			</div>
		);
	}

	if (events.length === 0) {
		return (
			<div class="rounded-2xl border border-green-100 bg-green-50/40 p-12 text-center">
				<Calendar class="mx-auto h-10 w-10 text-green-600 mb-3" />
				<h3 class="text-lg font-semibold text-slate-900">Aucun événement disponible</h3>
				<p class="mt-1 text-sm text-slate-600">Revenez bientôt pour découvrir les prochains événements.</p>
			</div>
		);
	}

	const filteredEvents = selectedCategoryId
		? events.filter((ev) => ev.category_id === selectedCategoryId)
		: events;

	return (
		<div class="space-y-6">
			<div class="flex flex-col gap-3 rounded-2xl border border-green-100 bg-green-50/40 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
				<div class="flex flex-wrap items-center gap-1.5">
					<button
						type="button"
						onClick={() => setSelectedCategoryId('')}
						class={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors cursor-pointer ${
							selectedCategoryId === ''
								? 'bg-green-600 text-white border-green-600'
								: 'bg-white text-slate-700 border-green-200 hover:bg-green-50'
						}`}
					>
						Toutes
					</button>
					{eventCategories.map((cat) => (
						<button
							key={cat.id}
							type="button"
							onClick={() => setSelectedCategoryId(cat.id)}
							class={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors cursor-pointer ${
								selectedCategoryId === cat.id
									? 'bg-green-600 text-white border-green-600'
									: 'bg-white text-slate-700 border-green-200 hover:bg-green-50'
							}`}
						>
							{cat.name}
						</button>
					))}
				</div>

				<div class="flex items-center gap-2 shrink-0">
					<Bus class="h-4 w-4 text-green-600" />
					<select
						aria-label="Ma commune de départ"
						value={commune}
						onChange={(e) => handleCommuneChange((e.target as HTMLSelectElement).value)}
						class="rounded-xl border border-green-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 focus:border-green-600 focus:outline-none"
					>
						<option value="">Toutes communes</option>
						{ABIDJAN_COMMUNES.map((c) => (
							<option key={c} value={c}>
								Départ : {c}
							</option>
						))}
					</select>
				</div>
			</div>

			{filteredEvents.length === 0 ? (
				<div class="rounded-2xl border border-green-100 bg-green-50/30 p-10 text-center text-sm text-slate-600">
					Aucun événement dans cette catégorie pour le moment.
				</div>
			) : (
			<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{filteredEvents.map((event) => {
					const prioritizedConvoys = sortConvoysByCommune(event.convoys, commune);
					const displayPrice =
						event.price_xof > 0
							? event.price_xof
							: event.categories.length > 0
								? Math.min(...event.categories.map((c) => c.price_xof))
								: null;
					const totalRemaining =
						prioritizedConvoys.length > 0
							? prioritizedConvoys.reduce((acc, cv) => acc + cv.remaining, 0)
							: event.categories.reduce((acc, c) => acc + c.remaining, 0);
					const posterUrls = getEventPosterUrls(event);

					const renderChips = (copyKey: string) =>
						prioritizedConvoys.map((cv) => {
							const isMatch =
								Boolean(commune) &&
								(cv.commune || '').toLowerCase() === commune.toLowerCase();
							return (
								<span
									key={`${copyKey}-${cv.id}`}
									class={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
										isMatch
											? 'bg-green-600 text-white border-green-600'
											: 'bg-white text-green-800 border-green-200'
									}`}
								>
									<Bus class="h-3 w-3" />
									<span>
										{cv.commune || cv.name} · {cv.remaining}/{cv.capacity}
									</span>
								</span>
							);
						});

					return (
						<a
							key={event.id}
							href={`/events/${event.slug}`}
							class="group flex flex-col overflow-hidden rounded-2xl border border-green-100 bg-white shadow-xs hover:border-green-300 hover:shadow-md transition-all"
						>
							<EventImageCarousel urls={posterUrls} alt={event.title} aspectClass="aspect-[16/10]" />

							{prioritizedConvoys.length > 0 && (
								<div class="overflow-hidden border-y border-green-100 bg-green-50/70 py-2 px-3">
									{prioritizedConvoys.length === 1 ? (
										<div class="flex items-center gap-2">{renderChips('single')}</div>
									) : (
										<div class="animate-departure-marquee gap-2">
											<div class="flex items-center gap-2 pr-2">{renderChips('a')}</div>
											<div class="flex items-center gap-2 pr-2" aria-hidden="true">
												{renderChips('b')}
											</div>
										</div>
									)}
								</div>
							)}

							<div class="flex flex-1 flex-col p-5">
								<div class="flex items-center justify-between gap-2">
									<p class="text-xs font-semibold uppercase tracking-wide text-green-600">
										{formatDate(event.starts_at)}
									</p>
									{event.category_name && (
										<span class="rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-[11px] font-semibold text-green-800">
											{event.category_name}
										</span>
									)}
								</div>
								<h3 class="mt-1.5 text-lg font-bold text-slate-900 group-hover:text-green-700 transition-colors">
									{event.title}
								</h3>
								<p class="mt-1.5 flex items-center gap-1.5 text-sm text-slate-600">
									<MapPin class="h-4 w-4 text-green-600 shrink-0" />
									<span class="truncate">{event.venue}</span>
								</p>

								<div class="mt-auto pt-5 flex items-center justify-between border-t border-green-50">
									<div>
										{displayPrice !== null ? (
											<p class="text-sm font-bold text-slate-900">
												Ticket : <span class="text-green-700">{formatXof(displayPrice)}</span>
											</p>
										) : (
											<p class="text-sm text-slate-500">Tarif à venir</p>
										)}
										<p class="text-xs text-slate-500">{totalRemaining} places restantes</p>
									</div>
									<span class="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-green-50 text-green-700 group-hover:bg-green-600 group-hover:text-white transition-colors">
										<ArrowRight class="h-4 w-4" />
									</span>
								</div>
							</div>
						</a>
					);
				})}
			</div>
			)}
		</div>
	);
}
