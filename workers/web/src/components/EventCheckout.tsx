import { useEffect, useState } from 'preact/hooks';
import { Calendar, MapPin, Bus, Minus, Plus, ShoppingBag, CheckCircle2, Heart } from 'lucide-preact';
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

interface Props {
	slug: string;
}

const DRAFT_ORDER_KEY = 'eventrip_draft_order';

export default function EventCheckout({ slug }: Props) {
	const [event, setEvent] = useState<PublicEvent | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [preferredCommune, setPreferredCommune] = useState('');
	const [selectedConvoyId, setSelectedConvoyId] = useState<string>('');
	const [quantity, setQuantity] = useState(1);
	const [submitting, setSubmitting] = useState(false);
	const [wishlisted, setWishlisted] = useState(false);
	const [togglingWishlist, setTogglingWishlist] = useState(false);
	const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

	useEffect(() => {
		const savedCommune = localStorage.getItem('eventrip_commune') || '';
		setPreferredCommune(savedCommune);
		apiFetch<{ user?: { id: string } } | null>('/api/auth/get-session')
			.then((res) => setIsAuthenticated(Boolean(res?.user)))
			.catch(() => setIsAuthenticated(false));
		apiFetch<{ event: PublicEvent }>(`/api/events/${slug}`)
			.then((data) => {
				setEvent(data.event);
				setWishlisted(Boolean(data.event.wishlisted));
				const sorted = sortConvoysByCommune(data.event.convoys, savedCommune);

				// Restaurer le panier si l'utilisateur revient de /auth
				try {
					const rawDraft = sessionStorage.getItem(DRAFT_ORDER_KEY);
					if (rawDraft) {
						const draft = JSON.parse(rawDraft) as {
							slug?: string;
							convoyId?: string;
							quantity?: number;
						};
						if (draft.slug === slug && draft.convoyId) {
							const exists = sorted.find(
								(cv) => cv.id === draft.convoyId && cv.remaining > 0,
							);
							if (exists) {
								setSelectedConvoyId(exists.id);
								if (draft.quantity && draft.quantity >= 1) {
									setQuantity(Math.min(draft.quantity, exists.remaining));
								}
								sessionStorage.removeItem(DRAFT_ORDER_KEY);
								return;
							}
						}
					}
				} catch {}

				const firstAvailable = sorted.find((cv) => cv.remaining > 0) || sorted[0];
				if (firstAvailable) setSelectedConvoyId(firstAvailable.id);
			})
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, [slug]);

	if (loading) {
		return <div class="h-96 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse" />;
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

	async function handleToggleWishlist() {
		if (!event || togglingWishlist) return;
		const next = !wishlisted;
		setTogglingWishlist(true);
		try {
			await apiFetch(`/api/wishlists/${event.id}`, {
				method: next ? 'POST' : 'DELETE',
			});
			setWishlisted(next);
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				window.location.href = `/auth?next=/events/${slug}`;
				return;
			}
			setError(err instanceof Error ? err.message : 'Impossible de mettre à jour vos favoris');
		} finally {
			setTogglingWishlist(false);
		}
	}

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
		if (isAuthenticated === false) {
			try {
				sessionStorage.setItem(
					DRAFT_ORDER_KEY,
					JSON.stringify({
						slug,
						convoyId: selectedConvoy.id,
						quantity: safeQty,
					}),
				);
			} catch {}
			window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname)}`;
			return;
		}
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
			sessionStorage.removeItem(DRAFT_ORDER_KEY);
			window.location.href = `/orders/${res.order.id}`;
		} catch (err: any) {
			if (String(err.message).includes('authentifié') || String(err.message).includes('401')) {
				try {
					sessionStorage.setItem(
						DRAFT_ORDER_KEY,
						JSON.stringify({
							slug,
							convoyId: selectedConvoy.id,
							quantity: safeQty,
						}),
					);
				} catch {}
				window.location.href = `/auth?next=${encodeURIComponent(window.location.pathname)}`;
				return;
			}
			setError(err.message);
			setSubmitting(false);
		}
	}

	const posterUrls = getEventPosterUrls(event);

	return (
		<div class="pb-4 lg:pb-0">
			<div class="grid gap-8 lg:grid-cols-3">
				<div class="lg:col-span-2 space-y-8">
					<div class="relative pt-3.5">
						{event.category_name && (
							<span class="pointer-events-none absolute top-0 left-5 z-20 inline-flex items-center rounded-full border border-slate-200 bg-white px-3.5 py-1 text-[11px] font-extrabold uppercase tracking-wider text-slate-800 shadow-xs">
								{event.category_name}
							</span>
						)}
						<div class="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-xs">
							{posterUrls.length > 0 && (
								<EventImageCarousel
									urls={posterUrls}
									alt={event.title}
									aspectClass="aspect-[16/9]"
								/>
							)}
							<div class="p-6 sm:p-8">
								<div class="flex flex-wrap items-center justify-between gap-3">
									<span class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
										<Calendar class="h-3.5 w-3.5 text-brand-600" />
										{formatDate(event.starts_at)}
									</span>
									<span class="text-xl font-black tracking-tight text-slate-950">
										{formatXof(ticketPrice)}{' '}
										<span class="text-xs font-medium text-slate-500">
											/ billet (convoi A/R inclus)
										</span>
									</span>
								</div>
								<div class="mt-3 flex flex-wrap items-start justify-between gap-3">
									<h1 class="text-2xl sm:text-3xl font-black tracking-tight text-slate-950">
										{event.title}
									</h1>
									<button
										type="button"
										onClick={handleToggleWishlist}
										disabled={togglingWishlist}
										class={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors cursor-pointer ${
											wishlisted
												? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
												: 'border-slate-200 bg-white text-slate-700 hover:border-red-200 hover:text-red-600'
										}`}
									>
										<Heart class={`h-4 w-4 ${wishlisted ? 'fill-red-500 text-red-500' : ''}`} />
										<span>{wishlisted ? 'Dans mes favoris' : 'Ajouter aux favoris'}</span>
									</button>
								</div>
								<p class="mt-2 flex items-center gap-2 text-sm font-medium text-slate-600">
									<MapPin class="h-4 w-4 text-brand-600 shrink-0" />
									{event.venue}
								</p>
								<p class="mt-5 whitespace-pre-line text-slate-700 leading-relaxed">
									{event.description}
								</p>
								{event.extra_info && (
									<div class="mt-5 rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-700">
										{event.extra_info}
									</div>
								)}
							</div>
						</div>
					</div>

					<section class="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs">
						<h2 class="flex items-center gap-2 text-lg font-extrabold text-slate-950">
							<Bus class="h-5 w-5 text-brand-600" />
							Choisissez votre commune de départ
						</h2>
						<p class="mt-1 text-xs text-slate-500">
							Tous les départs incluent le trajet aller-retour au tarif unique de{' '}
							<strong class="text-slate-800">{formatXof(ticketPrice)}</strong>.
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
												setQuantity((q) => Math.min(q, cv.remaining));
											}}
											class={`w-full text-left rounded-2xl border p-4 transition-all cursor-pointer disabled:opacity-50 ${
												isSelected
													? 'border-brand-600 bg-brand-50/40 ring-2 ring-brand-500/15'
													: 'border-slate-200 bg-white hover:border-slate-300'
											}`}
										>
											<div class="flex items-start justify-between gap-3">
												<div>
													<div class="flex flex-wrap items-center gap-2">
														<span class="font-bold text-slate-950">
															Départ {cv.commune || cv.name}
														</span>
														{isMatch && (
															<span class="rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
																Votre commune
															</span>
														)}
													</div>
													<p class="mt-1 text-sm text-slate-600">
														Rassemblement : <strong class="text-slate-800">{cv.meeting_point}</strong>{' '}
														• {formatDate(cv.departure_at)}
													</p>
													<p class="mt-1.5 text-xs font-semibold text-brand-700">
														{soldOut
															? 'Complet'
															: `${cv.remaining}/${cv.capacity} dispo`}
													</p>
												</div>
												{isSelected && (
													<CheckCircle2 class="h-5 w-5 text-brand-600 shrink-0" />
												)}
											</div>
										</button>
									);
								})}
							</div>
						)}
					</section>
				</div>

				{/* Sidebar Desktop */}
				<aside class="lg:col-span-1">
					<div class="sticky top-24 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
						<h3 class="text-lg font-extrabold text-slate-950">Récapitulatif</h3>

						{selectedConvoy && (
							<div class="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-sm">
								<p class="font-bold text-slate-900">
									Départ {selectedConvoy.commune || selectedConvoy.name}
								</p>
								<p class="text-xs text-slate-500 mt-0.5">{selectedConvoy.meeting_point}</p>
							</div>
						)}

						<div class="flex items-center justify-between">
							<span class="text-sm font-semibold text-slate-700">Nombre de billets</span>
							<div class="flex items-center gap-2">
								<button
									type="button"
									aria-label="Retirer un billet"
									disabled={safeQty <= 1}
									onClick={() => setQuantity(Math.max(1, safeQty - 1))}
									class="h-9 w-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
								>
									<Minus class="h-4 w-4" />
								</button>
								<span class="w-8 text-center font-bold text-slate-950">{safeQty}</span>
								<button
									type="button"
									aria-label="Ajouter un billet"
									disabled={safeQty >= maxQty}
									onClick={() => setQuantity(Math.min(maxQty, safeQty + 1))}
									class="h-9 w-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
								>
									<Plus class="h-4 w-4" />
								</button>
							</div>
						</div>

						<div class="space-y-2 text-sm text-slate-600 pt-3 border-t border-slate-100">
							<div class="flex justify-between">
								<span>Prix unitaire</span>
								<span class="font-semibold text-slate-900">{formatXof(ticketPrice)}</span>
							</div>
							<div class="flex justify-between text-base font-black text-slate-950 pt-2 border-t border-slate-200">
								<span>Total à régler</span>
								<span class="text-brand-600">{formatXof(totalAmount)}</span>
							</div>
						</div>

						<p class="text-xs text-slate-500">
							Places réservées pendant <strong>2 heures</strong> pour effectuer votre paiement Wave.
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
							class="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white shadow-xs hover:bg-brand-700 disabled:opacity-50 transition-colors cursor-pointer"
						>
							<ShoppingBag class="h-4 w-4" />
							{submitting ? 'Création en cours...' : 'Commander maintenant'}
						</button>
					</div>
				</aside>
			</div>

			{/* Barre d'action sticky en bas sur mobile (< lg) sans recouvrir le footer */}
			{selectedConvoy && (
				<div class="sticky bottom-0 z-30 -mx-4 sm:-mx-6 mt-6 border-t border-slate-200 bg-white/95 px-4 sm:px-6 py-3 backdrop-blur lg:hidden">
					<div class="mx-auto flex max-w-2xl items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate text-xs font-semibold text-slate-500">
								Départ {selectedConvoy.commune || selectedConvoy.name} • {safeQty} billet(s)
							</p>
							<p class="text-base font-black text-slate-950">{formatXof(totalAmount)}</p>
						</div>
						<button
							type="button"
							disabled={safeQty < 1 || submitting}
							onClick={handleCheckout}
							class="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-brand-700 disabled:opacity-50 cursor-pointer shrink-0"
						>
							<ShoppingBag class="h-4 w-4" />
							{submitting ? 'En cours...' : 'Commander'}
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
