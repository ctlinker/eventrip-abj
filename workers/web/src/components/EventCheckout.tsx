import { useEffect, useState } from 'preact/hooks';
import { Calendar, MapPin, Bus, Ticket, Minus, Plus, ShoppingBag } from 'lucide-preact';
import { apiFetch, formatDate, formatXof, posterUrl, type PublicEvent } from '../lib/api';

interface Props {
	slug: string;
}

export default function EventCheckout({ slug }: Props) {
	const [event, setEvent] = useState<PublicEvent | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [catQty, setCatQty] = useState<Record<string, number>>({});
	const [convQty, setConvQty] = useState<Record<string, number>>({});
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		apiFetch<{ event: PublicEvent }>(`/api/events/${slug}`)
			.then((data) => setEvent(data.event))
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, [slug]);

	if (loading) {
		return <div class="h-96 rounded-2xl border border-green-100 bg-green-50/40 animate-pulse" />;
	}

	if (error || !event) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				{error || 'Événement introuvable'}
			</div>
		);
	}

	const totalAmount =
		event.categories.reduce((sum, c) => sum + (catQty[c.id] || 0) * c.price_xof, 0) +
		event.convoys.reduce((sum, cv) => sum + (convQty[cv.id] || 0) * cv.price_xof, 0);

	const totalItems =
		Object.values(catQty).reduce((a, b) => a + b, 0) +
		Object.values(convQty).reduce((a, b) => a + b, 0);

	async function handleCheckout() {
		if (!event || totalItems === 0) return;
		setSubmitting(true);
		setError(null);

		const items = [
			...Object.entries(catQty)
				.filter(([, q]) => q > 0)
				.map(([id, quantity]) => ({ type: 'ticket_category' as const, id, quantity })),
			...Object.entries(convQty)
				.filter(([, q]) => q > 0)
				.map(([id, quantity]) => ({ type: 'convoy' as const, id, quantity })),
		];

		try {
			const res = await apiFetch<{ order: { id: string } }>('/api/orders', {
				method: 'POST',
				body: JSON.stringify({ items }),
			});
			window.location.href = `/orders/${res.order.id}`;
		} catch (err: any) {
			if (String(err.message).includes('authentifié') || String(err.message).includes('401')) {
				window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname)}`;
				return;
			}
			setError(err.message);
			setSubmitting(false);
		}
	}

	const poster = posterUrl(event.poster_key);

	return (
		<div class="grid gap-8 lg:grid-cols-3">
			<div class="lg:col-span-2 space-y-8">
				<div class="overflow-hidden rounded-2xl border border-green-100 bg-white">
					{poster && (
						<div class="aspect-[16/9] w-full bg-green-50 overflow-hidden">
							<img src={poster} alt={event.title} class="h-full w-full object-cover" />
						</div>
					)}
					<div class="p-6 sm:p-8">
						<span class="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 border border-green-200">
							<Calendar class="h-3.5 w-3.5" />
							{formatDate(event.starts_at)}
						</span>
						<h1 class="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
							{event.title}
						</h1>
						<p class="mt-2 flex items-center gap-2 text-sm font-medium text-slate-600">
							<MapPin class="h-4 w-4 text-green-600" />
							{event.venue}
						</p>
						<p class="mt-5 whitespace-pre-line text-slate-700 leading-relaxed">
							{event.description}
						</p>
						{event.extra_info && (
							<div class="mt-5 rounded-xl bg-green-50/70 border border-green-100 p-4 text-sm text-slate-700">
								{event.extra_info}
							</div>
						)}
					</div>
				</div>

				<section class="rounded-2xl border border-green-100 bg-white p-6">
					<h2 class="flex items-center gap-2 text-lg font-bold text-slate-900">
						<Ticket class="h-5 w-5 text-green-600" />
						Catégories de tickets
					</h2>
					{event.categories.length === 0 ? (
						<p class="mt-4 text-sm text-slate-500">
							Aucune catégorie de ticket n'est encore configurée pour cet événement.
						</p>
					) : (
					<div class="mt-4 divide-y divide-green-50">
						{event.categories.map((cat) => {
							const qty = catQty[cat.id] || 0;
							return (
								<div key={cat.id} class="py-4 flex items-center justify-between gap-4">
									<div>
										<p class="font-semibold text-slate-900">{cat.name}</p>
										{cat.description && <p class="text-sm text-slate-500">{cat.description}</p>}
										<p class="mt-1 text-sm font-bold text-green-700">
											{formatXof(cat.price_xof)}{' '}
											<span class="font-normal text-xs text-slate-500">
												· {cat.remaining} restant(s)
											</span>
										</p>
									</div>
									<div class="flex items-center gap-2">
										<button
											type="button"
											disabled={qty === 0}
											onClick={() => setCatQty({ ...catQty, [cat.id]: Math.max(0, qty - 1) })}
											class="h-9 w-9 rounded-xl border border-green-200 flex items-center justify-center text-slate-700 hover:bg-green-50 disabled:opacity-40 cursor-pointer"
										>
											<Minus class="h-4 w-4" />
										</button>
										<span class="w-8 text-center font-semibold">{qty}</span>
										<button
											type="button"
											disabled={qty >= cat.remaining}
											onClick={() =>
												setCatQty({ ...catQty, [cat.id]: Math.min(cat.remaining, qty + 1) })
											}
											class="h-9 w-9 rounded-xl border border-green-200 flex items-center justify-center text-slate-700 hover:bg-green-50 disabled:opacity-40 cursor-pointer"
										>
											<Plus class="h-4 w-4" />
										</button>
									</div>
								</div>
							);
						})}
					</div>
					)}
				</section>

				{event.convoys.length > 0 && (
					<section class="rounded-2xl border border-green-100 bg-white p-6">
						<h2 class="flex items-center gap-2 text-lg font-bold text-slate-900">
							<Bus class="h-5 w-5 text-green-600" />
							Convois de transport associés
						</h2>
						<div class="mt-4 divide-y divide-green-50">
							{event.convoys.map((cv) => {
								const qty = convQty[cv.id] || 0;
								return (
									<div key={cv.id} class="py-4 flex items-center justify-between gap-4">
										<div>
											<p class="font-semibold text-slate-900">
												{cv.name}{' '}
												<span class="ml-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700 border border-green-200">
													{cv.trip_type === 'round_trip' ? 'Aller-retour' : 'Aller simple'}
												</span>
											</p>
											<p class="text-sm text-slate-600">
												Départ : {formatDate(cv.departure_at)} · {cv.meeting_point} →{' '}
												{cv.destination}
											</p>
											<p class="mt-1 text-sm font-bold text-green-700">
												{formatXof(cv.price_xof)}{' '}
												<span class="font-normal text-xs text-slate-500">
													· {cv.remaining} place(s)
												</span>
											</p>
										</div>
										<div class="flex items-center gap-2">
											<button
												type="button"
												disabled={qty === 0}
												onClick={() =>
													setConvQty({ ...convQty, [cv.id]: Math.max(0, qty - 1) })
												}
												class="h-9 w-9 rounded-xl border border-green-200 flex items-center justify-center text-slate-700 hover:bg-green-50 disabled:opacity-40 cursor-pointer"
											>
												<Minus class="h-4 w-4" />
											</button>
											<span class="w-8 text-center font-semibold">{qty}</span>
											<button
												type="button"
												disabled={qty >= cv.remaining}
												onClick={() =>
													setConvQty({
														...convQty,
														[cv.id]: Math.min(cv.remaining, qty + 1),
													})
												}
												class="h-9 w-9 rounded-xl border border-green-200 flex items-center justify-center text-slate-700 hover:bg-green-50 disabled:opacity-40 cursor-pointer"
											>
												<Plus class="h-4 w-4" />
											</button>
										</div>
									</div>
								);
							})}
						</div>
					</section>
				)}
			</div>

			<aside class="lg:col-span-1">
				<div class="sticky top-24 rounded-2xl border border-green-200 bg-green-50/50 p-6 space-y-5">
					<h3 class="text-lg font-bold text-slate-900">Votre commande</h3>
					<div class="space-y-2 text-sm text-slate-600">
						<div class="flex justify-between">
							<span>Articles sélectionnés</span>
							<span class="font-semibold text-slate-900">{totalItems}</span>
						</div>
						<div class="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-green-200">
							<span>Total à régler</span>
							<span class="text-green-700">{formatXof(totalAmount)}</span>
						</div>
					</div>

					<p class="text-xs text-slate-500">
						Vos places sont réservées pendant <strong>2 heures</strong> dès la validation de la commande pour effectuer votre paiement Wave.
					</p>

					{error && (
						<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
							{error}
						</div>
					)}

					<button
						type="button"
						disabled={totalItems === 0 || submitting}
						onClick={handleCheckout}
						class="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-green-700 disabled:opacity-50 transition-colors cursor-pointer"
					>
						<ShoppingBag class="h-4 w-4" />
						{submitting ? 'Création en cours...' : 'Commander maintenant'}
					</button>
				</div>
			</aside>
		</div>
	);
}
