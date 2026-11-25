import { useEffect, useState } from 'preact/hooks';
import { Calendar, MapPin, ArrowRight, Bus } from 'lucide-preact';
import { apiFetch, formatDate, formatXof, getEventPosterUrls, type PublicEvent } from '../lib/api';
import EventImageCarousel from './EventImageCarousel';

export default function EventsCatalog() {
	const [events, setEvents] = useState<PublicEvent[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		apiFetch<{ events: PublicEvent[] }>('/api/events')
			.then((data) => setEvents(data.events))
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, []);

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

	return (
		<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
			{events.map((event) => {
				const minPrice =
					event.categories.length > 0
						? Math.min(...event.categories.map((c) => c.price_xof))
						: null;
				const totalRemaining = event.categories.reduce((acc, c) => acc + c.remaining, 0);
				const posterUrls = getEventPosterUrls(event);

				return (
					<a
						key={event.id}
						href={`/events/${event.slug}`}
						class="group flex flex-col overflow-hidden rounded-2xl border border-green-100 bg-white shadow-xs hover:border-green-300 hover:shadow-md transition-all"
					>
						<div class="relative">
							<EventImageCarousel urls={posterUrls} alt={event.title} aspectClass="aspect-[16/10]" />
							{event.convoys.length > 0 && (
								<span class="absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-xs font-semibold text-green-700 shadow-xs border border-green-100">
									<Bus class="h-3.5 w-3.5" />
									Convoi dispo
								</span>
							)}
						</div>

						<div class="flex flex-1 flex-col p-5">
							<p class="text-xs font-semibold uppercase tracking-wide text-green-600">
								{formatDate(event.starts_at)}
							</p>
							<h3 class="mt-1.5 text-lg font-bold text-slate-900 group-hover:text-green-700 transition-colors">
								{event.title}
							</h3>
							<p class="mt-1.5 flex items-center gap-1.5 text-sm text-slate-600">
								<MapPin class="h-4 w-4 text-green-600 shrink-0" />
								<span class="truncate">{event.venue}</span>
							</p>

							<div class="mt-auto pt-5 flex items-center justify-between border-t border-green-50">
								<div>
									{minPrice !== null ? (
										<p class="text-sm font-bold text-slate-900">
											À partir de <span class="text-green-700">{formatXof(minPrice)}</span>
										</p>
									) : (
										<p class="text-sm text-slate-500">Tarifs à venir</p>
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
	);
}
