import { useEffect, useState } from 'preact/hooks';
import { Calendar, MapPin, Bus, Minus, Plus, ShoppingBag, CheckCircle2 } from 'lucide-preact';
import {
	apiFetch,
	formatDate,
	formatXof,
	getEventPosterUrls,
	sortConvoysByCommune,
	type PublicEvent,
} from '../lib/api';
import EventImageCarousel from './EventImageCarousel';

interface Props {
	slug: string;
}

export default function EventCheckout({ slug }: Props) {
	const [event, setEvent] = useState<PublicEvent | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [preferredCommune, setPreferredCommune] = useState('');
	const [selectedConvoyId, setSelectedConvoyId] = useState<string>('');
	const [quantity, setQuantity] = useState(1);
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		const savedCommune = localStorage.getItem('eventrip_commune') || '';
		setPreferredCommune(savedCommune);
		apiFetch<{ event: PublicEvent }>(`/api/events/${slug}`)
			.then((data) => {
				setEvent(data.event);
				const sorted = sortConvoysByCommune(data.event.convoys, savedCommune);
				const firstAvailable = sorted.find((cv) => cv.remaining > 0) || sorted[0];
				if (firstAvailable) setSelectedConvoyId(firstAvailable.id);
			})
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, [slug]);

	if (loading) {
		return <div class="h-96 rounded-2xl border border-green-100 bg-green-50/40 animate-pulse" />;
	}

	if (error && !event) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				{error}
			</div>
		);
	}

	if (!event) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				Événement introuvable
			</div>
		);
	}

	const sortedConvoys = sortConvoysByCommune(event.convoys, preferredCommune);
	const selectedConvoy = sortedConvoys.find((cv) => cv.id === selectedConvoyId) || null;
	const ticketPrice =
		event.price_xof > 0
			? event.price_xof
			: event.categories.length > 0
				? event.categories[0].price_xof
				: 0;
	const maxQty = selectedConvoy ? Math.min(50, selectedConvoy.remaining) : 0;
	const safeQty = maxQty > 0 ? Math.min(quantity, maxQty) : 0;
	const totalAmount = safeQty * ticketPrice;

	async function handleCheckout() {
		if (!selectedConvoy || safeQty < 1) return;
		setSubmitting(true);
		setError(null);

		try {
			const res = await apiFetch<{ order: { id: string } }>('/api/orders', {
				method: 'POST',
				body: JSON.stringify({
					convoy_id: selectedConvoy.id,
					quantity: safeQty,
				}),
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

	const posterUrls = getEventPosterUrls(event);

	return (
		<div class="grid gap-8 lg:grid-cols-3">
			<div class="lg:col-span-2 space-y-8">
				<div class="overflow-hidden rounded-2xl border border-green-100 bg-white">
					{posterUrls.length > 0 && (
						<EventImageCarousel urls={posterUrls} alt={event.title} aspectClass="aspect-[16/9]" />
					)}
					<div class="p-6 sm:p-8">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<span class="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 border border-green-200">
								<Calendar class="h-3.5 w-3.5" />
								{formatDate(event.starts_at)}
							</span>
							<span class="text-lg font-bold text-green-700">
								{formatXof(ticketPrice)} <span class="text-xs font-normal text-slate-500">/ billet (Aller-Retour inclus)</span>
							</span>
						</div>
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
						<Bus class="h-5 w-5 text-green-600" />
						Choisissez votre commune de départ
					</h2>
					<p class="mt-1 text-xs text-slate-500">
						Tous les départs incluent l’aller-retour (QR code scannable 2 fois) au tarif unique de{' '}
						<strong>{formatXof(ticketPrice)}</strong>.
					</p>

					{sortedConvoys.length === 0 ? (
						<p class="mt-4 text-sm text-slate-500">
							Aucun départ configuré pour cet événement pour le moment.
						</p>
					) : (
						<div class="mt-4 space-y-3">
							{sortedConvoys.map((cv) => {
								const isMatch =
									Boolean(preferredCommune) &&
									(cv.commune || '').toLowerCase() === preferredCommune.toLowerCase();
								const isSelected = selectedConvoyId === cv.id;
								const soldOut = cv.remaining <= 0;

								return (
									<button
										key={cv.id}
										type="button"
										disabled={soldOut}
										onClick={() => {
											setSelectedConvoyId(cv.id);
											setQuantity(1);
										}}
										class={`w-full text-left rounded-2xl border p-4 transition-all cursor-pointer disabled:opacity-50 ${
											isSelected
												? 'border-green-600 bg-green-50/60 ring-2 ring-green-500/20'
												: 'border-green-100 bg-white hover:border-green-300'
										}`}
									>
										<div class="flex items-start justify-between gap-3">
											<div>
												<div class="flex flex-wrap items-center gap-2">
													<span class="font-bold text-slate-900">
														Départ {cv.commune || cv.name}
													</span>
													{isMatch && (
														<span class="rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">
															Votre commune
														</span>
													)}
												</div>
												<p class="mt-1 text-sm text-slate-600">
													Rassemblement : <strong>{cv.meeting_point}</strong> ·{' '}
													{formatDate(cv.departure_at)}
												</p>
												<p class="mt-1 text-xs font-semibold text-green-700">
													{soldOut ? 'Complet' : `${cv.remaining} / ${cv.capacity} places disponibles`}
												</p>
											</div>
											{isSelected && <CheckCircle2 class="h-5 w-5 text-green-600 shrink-0" />}
										</div>
									</button>
								);
							})}
						</div>
					)}
				</section>
			</div>

			<aside class="lg:col-span-1">
				<div class="sticky top-24 rounded-2xl border border-green-200 bg-green-50/50 p-6 space-y-5">
					<h3 class="text-lg font-bold text-slate-900">Votre commande</h3>

					{selectedConvoy && (
						<div class="rounded-xl border border-green-200 bg-white p-3.5 text-sm">
							<p class="font-semibold text-slate-900">
								Départ : {selectedConvoy.commune || selectedConvoy.name}
							</p>
							<p class="text-xs text-slate-500 mt-0.5">{selectedConvoy.meeting_point}</p>
						</div>
					)}

					<div class="flex items-center justify-between">
						<span class="text-sm font-medium text-slate-700">Nombre de billets</span>
						<div class="flex items-center gap-2">
							<button
								type="button"
								disabled={safeQty <= 1}
								onClick={() => setQuantity(Math.max(1, safeQty - 1))}
								class="h-9 w-9 rounded-xl border border-green-200 bg-white flex items-center justify-center text-slate-700 hover:bg-green-50 disabled:opacity-40 cursor-pointer"
							>
								<Minus class="h-4 w-4" />
							</button>
							<span class="w-8 text-center font-semibold">{safeQty}</span>
							<button
								type="button"
								disabled={safeQty >= maxQty}
								onClick={() => setQuantity(Math.min(maxQty, safeQty + 1))}
								class="h-9 w-9 rounded-xl border border-green-200 bg-white flex items-center justify-center text-slate-700 hover:bg-green-50 disabled:opacity-40 cursor-pointer"
							>
								<Plus class="h-4 w-4" />
							</button>
						</div>
					</div>

					<div class="space-y-2 text-sm text-slate-600 pt-2 border-t border-green-200">
						<div class="flex justify-between">
							<span>Prix unitaire</span>
							<span class="font-semibold text-slate-900">{formatXof(ticketPrice)}</span>
						</div>
						<div class="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-green-200">
							<span>Total à régler</span>
							<span class="text-green-700">{formatXof(totalAmount)}</span>
						</div>
					</div>

					<p class="text-xs text-slate-500">
						Vos places sont réservées pendant <strong>2 heures</strong> dès la commande pour effectuer votre paiement Wave.
					</p>

					{error && (
						<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
							{error}
						</div>
					)}

					<button
						type="button"
						disabled={!selectedConvoy || safeQty < 1 || submitting}
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
