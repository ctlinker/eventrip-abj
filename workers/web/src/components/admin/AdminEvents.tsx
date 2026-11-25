import { useEffect, useState } from 'preact/hooks';
import { Plus, ImagePlus, X, Bus, ArrowLeft, Tag, Archive, Trash2, RotateCcw } from 'lucide-preact';
import {
	ABIDJAN_COMMUNES,
	apiFetch,
	formatDate,
	formatXof,
	getEventPosterUrls,
	type EventCategory,
} from '../../lib/api';

interface AdminEvent {
	id: string;
	slug: string;
	title: string;
	venue: string;
	starts_at: string;
	price_xof: number;
	category_id?: string | null;
	category_name?: string | null;
	wave_payment_url: string | null;
	poster_key: string | null;
	poster_keys?: string[];
	status: 'draft' | 'published' | 'archived';
	convoys: Array<{
		id: string;
		name: string;
		commune?: string;
		meeting_point?: string;
		departure_at?: string;
		capacity: number;
		reserved_count: number;
	}>;
}

export default function AdminEvents() {
	const [view, setView] = useState<'list' | 'create' | 'categories' | 'departures'>('list');
	const [events, setEvents] = useState<AdminEvent[]>([]);
	const [eventCategories, setEventCategories] = useState<EventCategory[]>([]);
	const [defaultMerchantId, setDefaultMerchantId] = useState('');

	// Formulaire création événement
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [startsAt, setStartsAt] = useState('2026-12-20T18:00');
	const [venue, setVenue] = useState('');
	const [priceXof, setPriceXof] = useState('');
	const [categoryId, setCategoryId] = useState('');
	const [waveUrl, setWaveUrl] = useState('');
	const [initialPhotos, setInitialPhotos] = useState<File[]>([]);

	// Ajout rapide de catégorie
	const [newCatName, setNewCatName] = useState('');
	const [showInlineCat, setShowInlineCat] = useState(false);

	// Départs définis à la création (au moins 1 obligatoire, extensible avec +)
	const [initialDepartures, setInitialDepartures] = useState<
		Array<{ commune: string; meetingPoint: string; departureAt: string; capacity: string }>
	>([{ commune: 'Cocody', meetingPoint: '', departureAt: '2026-12-20T14:00', capacity: '55' }]);

	// Onglet dédié Départs
	const [depTabEventId, setDepTabEventId] = useState('');
	const [depTabForm, setDepTabForm] = useState({
		commune: 'Cocody',
		meetingPoint: '',
		departureAt: '2026-12-20T14:00',
		capacity: '55',
	});

	const [convoyForm, setConvoyForm] = useState<{
		eventId: string;
		commune: string;
		meetingPoint: string;
		departureAt: string;
		capacity: string;
	}>({
		eventId: '',
		commune: 'Yopougon',
		meetingPoint: '',
		departureAt: '2026-12-20T14:00',
		capacity: '55',
	});
	const [error, setError] = useState<string | null>(null);
	const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

	function load() {
		apiFetch<{
			default_wave_merchant_id?: string;
			event_categories?: EventCategory[];
			events: AdminEvent[];
		}>('/api/admin/events')
			.then((res) => {
				setEvents(res.events);
				setEventCategories(res.event_categories || []);
				if (res.default_wave_merchant_id) setDefaultMerchantId(res.default_wave_merchant_id);
				if (res.events.length > 0 && !depTabEventId) {
					setDepTabEventId(res.events[0].id);
				}
			})
			.catch((err) => setError(err.message));
	}

	useEffect(() => {
		load();
	}, []);

	async function handleAddEventCategory(e?: Event) {
		if (e) e.preventDefault();
		const trimmed = newCatName.trim();
		if (!trimmed) return;
		setError(null);
		try {
			const res = await apiFetch<{ category: EventCategory }>('/api/admin/event-categories', {
				method: 'POST',
				body: JSON.stringify({ name: trimmed }),
			});
			if (res.category) {
				setEventCategories((prev) =>
					[...prev, res.category].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
				);
				setCategoryId(res.category.id);
			}
			setNewCatName('');
			setShowInlineCat(false);
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function handleCreateEvent(e: Event) {
		e.preventDefault();
		setError(null);
		const firstDep = initialDepartures[0];
		if (!firstDep) {
			setError('Au moins un départ initial est requis.');
			return;
		}
		try {
			const created = await apiFetch<{ event: AdminEvent }>('/api/admin/events', {
				method: 'POST',
				body: JSON.stringify({
					title,
					description,
					starts_at: new Date(startsAt).toISOString(),
					venue,
					price_xof: Number(priceXof),
					category_id: categoryId || null,
					wave_payment_url: waveUrl.trim() || null,
					status: 'published',
					initial_departure: {
						commune: firstDep.commune,
						meeting_point: firstDep.meetingPoint,
						departure_at: new Date(firstDep.departureAt).toISOString(),
						capacity: Number(firstDep.capacity) || 55,
					},
				}),
			});

			const extraConvoys: AdminEvent['convoys'] = [];
			if (created.event?.id && initialDepartures.length > 1) {
				for (const extra of initialDepartures.slice(1)) {
					if (!extra.meetingPoint.trim()) continue;
					const convRes = await apiFetch<{ convoy: AdminEvent['convoys'][number] }>(
						`/api/admin/events/${created.event.id}/convoys`,
						{
							method: 'POST',
							body: JSON.stringify({
								name: `Départ ${extra.commune}`,
								commune: extra.commune,
								meeting_point: extra.meetingPoint,
								destination: venue,
								departure_at: new Date(extra.departureAt).toISOString(),
								trip_type: 'round_trip',
								price_xof: 0,
								capacity: Number(extra.capacity) || 55,
							}),
						},
					);
					if (convRes.convoy) extraConvoys.push(convRes.convoy);
				}
			}

			let posterKey: string | null = null;
			let posterKeys: string[] = [];
			if (created.event?.id && initialPhotos.length > 0) {
				const form = new FormData();
				for (const f of initialPhotos) {
					form.append('files', f);
				}
				const posterRes = await apiFetch<{ poster_key: string | null; poster_keys: string[] }>(
					`/api/admin/events/${created.event.id}/poster`,
					{
						method: 'POST',
						body: form,
					},
				);
				posterKey = posterRes.poster_key;
				posterKeys = posterRes.poster_keys;
			}

			if (created.event) {
				setEvents((prev) => [
					{
						...created.event,
						poster_key: posterKey,
						poster_keys: posterKeys,
						convoys: [...(created.event.convoys || []), ...extraConvoys],
					},
					...prev,
				]);
				setDepTabEventId((prev) => prev || created.event.id);
			}

			setTitle('');
			setDescription('');
			setVenue('');
			setPriceXof('');
			setCategoryId('');
			setWaveUrl('');
			setInitialPhotos([]);
			setInitialDepartures([
				{ commune: 'Cocody', meetingPoint: '', departureAt: '2026-12-20T14:00', capacity: '55' },
			]);
			setView('list');
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function handleAddDepartureFromTab(e: Event) {
		e.preventDefault();
		const targetEvent = events.find((ev) => ev.id === depTabEventId) || events[0];
		if (!targetEvent) return;
		setError(null);
		try {
			const res = await apiFetch<{ convoy: AdminEvent['convoys'][number] }>(
				`/api/admin/events/${targetEvent.id}/convoys`,
				{
					method: 'POST',
					body: JSON.stringify({
						name: `Départ ${depTabForm.commune}`,
						commune: depTabForm.commune,
						meeting_point: depTabForm.meetingPoint,
						destination: targetEvent.venue,
						departure_at: new Date(depTabForm.departureAt).toISOString(),
						trip_type: 'round_trip',
						price_xof: 0,
						capacity: Number(depTabForm.capacity) || 55,
					}),
				},
			);
			if (res.convoy) {
				setEvents((prev) =>
					prev.map((item) =>
						item.id === targetEvent.id
							? { ...item, convoys: [...item.convoys, res.convoy] }
							: item,
					),
				);
			}
			setDepTabForm((prev) => ({ ...prev, meetingPoint: '' }));
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function setEventStatus(ev: AdminEvent, next: 'draft' | 'published' | 'archived') {
		setError(null);
		try {
			await apiFetch(`/api/admin/events/${ev.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ status: next }),
			});
			setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, status: next } : e)));
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function handleDeleteEvent(ev: AdminEvent) {
		setError(null);
		try {
			await apiFetch(`/api/admin/events/${ev.id}`, { method: 'DELETE' });
			setEvents((prev) => prev.filter((e) => e.id !== ev.id));
			setConfirmDeleteId(null);
		} catch (err: any) {
			setError(err.message);
			setConfirmDeleteId(null);
		}
	}

	async function handleAddConvoy(e: Event, ev: AdminEvent) {
		e.preventDefault();
		setError(null);
		try {
			const res = await apiFetch<{ convoy: AdminEvent['convoys'][number] }>(
				`/api/admin/events/${ev.id}/convoys`,
				{
					method: 'POST',
					body: JSON.stringify({
						name: `Départ ${convoyForm.commune}`,
						commune: convoyForm.commune,
						meeting_point: convoyForm.meetingPoint,
						destination: ev.venue,
						departure_at: new Date(convoyForm.departureAt).toISOString(),
						trip_type: 'round_trip',
						price_xof: 0,
						capacity: Number(convoyForm.capacity) || 55,
					}),
				},
			);
			setConvoyForm({
				eventId: '',
				commune: 'Yopougon',
				meetingPoint: '',
				departureAt: '2026-12-20T14:00',
				capacity: '55',
			});
			if (res.convoy) {
				setEvents((prev) =>
					prev.map((item) =>
						item.id === ev.id ? { ...item, convoys: [...item.convoys, res.convoy] } : item,
					),
				);
			}
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function handleUploadMorePhotos(eventId: string, files: FileList | null) {
		if (!files || files.length === 0) return;
		setError(null);
		const form = new FormData();
		Array.from(files).forEach((f) => form.append('files', f));
		try {
			const res = await apiFetch<{ poster_key: string | null; poster_keys: string[] }>(
				`/api/admin/events/${eventId}/poster`,
				{
					method: 'POST',
					body: form,
				},
			);
			setEvents((prev) =>
				prev.map((ev) =>
					ev.id === eventId
						? { ...ev, poster_key: res.poster_key, poster_keys: res.poster_keys }
						: ev,
				),
			);
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function handleRemovePhoto(eventId: string, key: string) {
		setError(null);
		try {
			const res = await apiFetch<{ poster_keys: string[] }>(
				`/api/admin/events/${eventId}/poster`,
				{
					method: 'DELETE',
					body: JSON.stringify({ key }),
				},
			);
			setEvents((prev) =>
				prev.map((ev) =>
					ev.id === eventId
						? {
								...ev,
								poster_key: res.poster_keys[0] ?? null,
								poster_keys: res.poster_keys,
							}
						: ev,
				),
			);
		} catch (err: any) {
			setError(err.message);
		}
	}

	return (
		<div class="space-y-6">
			{/* Barre de séparation claire : Liste / Catégories / + Nouvel événement */}
			<div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-2.5">
				<div class="flex flex-wrap gap-1.5">
					<button
						type="button"
						onClick={() => {
							setView('list');
							setError(null);
						}}
						class={`rounded-xl px-4 py-2 text-sm font-bold transition-colors cursor-pointer ${
							view === 'list'
								? 'bg-white text-slate-950 border border-slate-200 shadow-xs'
								: 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
						}`}
					>
						Événements ({events.length})
					</button>
					<button
						type="button"
						onClick={() => {
							setView('categories');
							setError(null);
						}}
						class={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition-colors cursor-pointer ${
							view === 'categories'
								? 'bg-white text-slate-950 border border-slate-200 shadow-xs'
								: 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
						}`}
					>
						<Tag class="h-4 w-4 text-emerald-600" />
						Catégories ({eventCategories.length})
					</button>
					<button
						type="button"
						onClick={() => {
							setView('departures');
							setError(null);
						}}
						class={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition-colors cursor-pointer ${
							view === 'departures'
								? 'bg-white text-slate-950 border border-slate-200 shadow-xs'
								: 'text-slate-600 hover:bg-white/70 hover:text-slate-900'
						}`}
					>
						<Bus class="h-4 w-4 text-emerald-600" />
						Départs ({events.reduce((acc, ev) => acc + ev.convoys.length, 0)})
					</button>
				</div>

				{view !== 'create' ? (
					<button
						type="button"
						onClick={() => {
							setView('create');
							setError(null);
						}}
						class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-emerald-700 cursor-pointer"
					>
						<Plus class="h-4 w-4" />
						Nouvel événement
					</button>
				) : (
					<button
						type="button"
						onClick={() => {
							setView('list');
							setError(null);
						}}
						class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
					>
						<ArrowLeft class="h-4 w-4" />
						Retour à la liste
					</button>
				)}
			</div>

			{error && (
				<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
			)}

			{view === 'categories' && (
				<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
					<div>
						<h2 class="text-lg font-extrabold text-slate-950">Catégories d’événements</h2>
						<p class="text-xs text-slate-500 mt-0.5">
							Ajoutez des types d’événements (Concert live, Séminaire, Excursion…) utilisables lors de la création et pour filtrer l’accueil.
						</p>
					</div>

					<form onSubmit={handleAddEventCategory} class="flex flex-wrap gap-2">
						<input
							type="text"
							name="new_category"
							aria-label="Nouvelle catégorie"
							required
							placeholder="Nouvelle catégorie (ex: Conférence, Gala...)"
							value={newCatName}
							onInput={(e) => setNewCatName((e.target as HTMLInputElement).value)}
							class="flex-1 min-w-[220px] rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-emerald-600 focus:outline-none"
						/>
						<button
							type="submit"
							class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 cursor-pointer shadow-xs"
						>
							<Plus class="h-4 w-4" />
							Ajouter
						</button>
					</form>

					<div class="flex flex-wrap gap-2 pt-2">
						{eventCategories.map((cat) => (
							<span
								key={cat.id}
								class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-bold text-slate-800"
							>
								<Tag class="h-3.5 w-3.5 text-emerald-600" />
								{cat.name}
							</span>
						))}
					</div>
				</div>
			)}

			{view === 'departures' && (
				<div class="space-y-6">
					<form
						onSubmit={handleAddDepartureFromTab}
						class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4"
					>
						<div>
							<h2 class="text-lg font-extrabold text-slate-950">Ajouter un départ (commune)</h2>
							<p class="text-xs text-slate-500 mt-0.5">
								Associez une nouvelle commune de départ à un événement existant (55 places par défaut, sans changement de prix).
							</p>
						</div>

						{events.length === 0 ? (
							<p class="text-sm text-slate-500">
								Créez d’abord un événement avant d’ajouter des départs supplémentaires.
							</p>
						) : (
							<>
								<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
									<div class="lg:col-span-2">
										<label for="dep-tab-event" class="block text-xs font-semibold text-slate-600 mb-1">
											Événement
										</label>
										<select
											id="dep-tab-event"
											value={depTabEventId || events[0]?.id || ''}
											onChange={(e) => setDepTabEventId((e.target as HTMLSelectElement).value)}
											class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
										>
											{events.map((ev) => (
												<option key={ev.id} value={ev.id}>
													{ev.title} ({ev.venue})
												</option>
											))}
										</select>
									</div>

									<div>
										<label for="dep-tab-commune" class="block text-xs font-semibold text-slate-600 mb-1">
											Commune
										</label>
										<select
											id="dep-tab-commune"
											value={depTabForm.commune}
											onChange={(e) =>
												setDepTabForm({
													...depTabForm,
													commune: (e.target as HTMLSelectElement).value,
												})
											}
											class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
										>
											{ABIDJAN_COMMUNES.map((c) => (
												<option key={c} value={c}>
													{c}
												</option>
											))}
										</select>
									</div>

									<div>
										<label for="dep-tab-meeting" class="block text-xs font-semibold text-slate-600 mb-1">
											Point de rassemblement
										</label>
										<input
											id="dep-tab-meeting"
											type="text"
											required
											placeholder="Ex: Cosmos Yopougon"
											value={depTabForm.meetingPoint}
											onInput={(e) =>
												setDepTabForm({
													...depTabForm,
													meetingPoint: (e.target as HTMLInputElement).value,
												})
											}
											class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
										/>
									</div>

									<div>
										<label for="dep-tab-capacity" class="block text-xs font-semibold text-slate-600 mb-1">
											Places (défaut 55)
										</label>
										<input
											id="dep-tab-capacity"
											type="number"
											required
											min={1}
											value={depTabForm.capacity}
											onInput={(e) =>
												setDepTabForm({
													...depTabForm,
													capacity: (e.target as HTMLInputElement).value,
												})
											}
											class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
										/>
									</div>
								</div>

								<div class="flex flex-wrap items-end justify-between gap-3">
									<div>
										<label for="dep-tab-at" class="block text-xs font-semibold text-slate-600 mb-1">
											Date et heure de départ
										</label>
										<input
											id="dep-tab-at"
											type="datetime-local"
											required
											value={depTabForm.departureAt}
											onInput={(e) =>
												setDepTabForm({
													...depTabForm,
													departureAt: (e.target as HTMLInputElement).value,
												})
											}
											class="rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
										/>
									</div>

									<button
										type="submit"
										class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 cursor-pointer shadow-xs"
									>
										<Plus class="h-4 w-4" />
										Ajouter ce départ
									</button>
								</div>
							</>
						)}
					</form>

					<div class="space-y-4">
						{events.map((ev) => (
							<div key={ev.id} class="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<h3 class="font-extrabold text-slate-950">{ev.title}</h3>
									<span class="text-xs font-semibold text-slate-500">
										{ev.convoys.length} départ(s)
									</span>
								</div>
								<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
									{ev.convoys.map((cv) => (
										<div
											key={cv.id}
											class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs"
										>
											<div class="min-w-0 pr-2">
												<p class="font-bold text-slate-900 truncate">{cv.commune || cv.name}</p>
												<p class="text-slate-500 truncate">{cv.meeting_point}</p>
											</div>
											<span class="shrink-0 font-bold text-emerald-700">
												{Math.max(0, cv.capacity - cv.reserved_count)}/{cv.capacity} dispo
											</span>
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{view === 'create' && (
				<form onSubmit={handleCreateEvent} class="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-5 shadow-xs">
					<h2 class="text-xl font-extrabold text-slate-950">Créer un nouvel événement</h2>

					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label for="ev-title" class="block text-xs font-semibold text-slate-600 mb-1">Titre</label>
							<input
								id="ev-title"
								type="text"
								required
								placeholder="Ex: Concert Live Assinie"
								value={title}
								onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-emerald-600 focus:outline-none"
							/>
						</div>

						<div>
							<label for="ev-cat" class="block text-xs font-semibold text-slate-600 mb-1">Catégorie</label>
							<div class="flex gap-2">
								<select
									id="ev-cat"
									value={categoryId}
									onChange={(e) => setCategoryId((e.target as HTMLSelectElement).value)}
									class="flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm focus:border-emerald-600 focus:outline-none"
								>
									<option value="">Choisir une catégorie...</option>
									{eventCategories.map((cat) => (
										<option key={cat.id} value={cat.id}>
											{cat.name}
										</option>
									))}
								</select>
								<button
									type="button"
									title="Ajouter une nouvelle catégorie"
									onClick={() => setShowInlineCat(!showInlineCat)}
									class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-slate-100 cursor-pointer"
								>
									+
								</button>
							</div>
							{showInlineCat && (
								<div class="mt-2 flex gap-2">
									<input
										type="text"
										placeholder="Nom nouvelle catégorie"
										value={newCatName}
										onInput={(e) => setNewCatName((e.target as HTMLInputElement).value)}
										class="flex-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs"
									/>
									<button
										type="button"
										onClick={() => handleAddEventCategory()}
										class="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
									>
										Créer
									</button>
								</div>
							)}
						</div>

						<div>
							<label for="ev-venue" class="block text-xs font-semibold text-slate-600 mb-1">Lieu / Destination</label>
							<input
								id="ev-venue"
								type="text"
								required
								placeholder="Ex: Assinie-Mafia"
								value={venue}
								onInput={(e) => setVenue((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-emerald-600 focus:outline-none"
							/>
						</div>

						<div>
							<label for="ev-starts" class="block text-xs font-semibold text-slate-600 mb-1">Date et heure</label>
							<input
								id="ev-starts"
								type="datetime-local"
								required
								value={startsAt}
								onInput={(e) => setStartsAt((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-emerald-600 focus:outline-none"
							/>
						</div>

						<div>
							<label for="ev-price" class="block text-xs font-semibold text-slate-600 mb-1">Prix du billet (FCFA)</label>
							<input
								id="ev-price"
								type="number"
								required
								min={0}
								placeholder="Ex: 10000"
								value={priceXof}
								onInput={(e) => setPriceXof((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-emerald-600 focus:outline-none"
							/>
						</div>

						<div>
							<label for="ev-wave" class="block text-xs font-semibold text-slate-600 mb-1">
								ID Marchand Wave (optionnel)
							</label>
							<input
								id="ev-wave"
								type="text"
								placeholder={`Défaut : ${defaultMerchantId || 'plateforme'}`}
								value={waveUrl}
								onInput={(e) => setWaveUrl((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-emerald-600 focus:outline-none"
							/>
						</div>
					</div>

					<div>
						<label for="ev-desc" class="block text-xs font-semibold text-slate-600 mb-1">Description</label>
						<textarea
							id="ev-desc"
							required
							rows={3}
							placeholder="Description de l'événement"
							value={description}
							onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
							class="w-full rounded-xl border border-slate-200 px-3.5 py-2 text-sm focus:border-emerald-600 focus:outline-none"
						/>
					</div>

					<div class="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<p class="text-xs font-bold uppercase tracking-wide text-slate-700">
								Départs par commune (au moins 1 obligatoire · 55 places par défaut)
							</p>
							<button
								type="button"
								onClick={() =>
									setInitialDepartures((prev) => [
										...prev,
										{
											commune: ABIDJAN_COMMUNES[prev.length % ABIDJAN_COMMUNES.length],
											meetingPoint: '',
											departureAt: prev[0]?.departureAt || '2026-12-20T14:00',
											capacity: '55',
										},
									])
								}
								class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50 cursor-pointer"
							>
								<Plus class="h-3.5 w-3.5" />
								Ajouter un départ
							</button>
						</div>

						<div class="space-y-2.5">
							{initialDepartures.map((dep, idx) => (
								<div key={idx} class="grid gap-2.5 sm:grid-cols-12 items-center">
									<select
										aria-label={`Commune départ ${idx + 1}`}
										value={dep.commune}
										onChange={(e) =>
											setInitialDepartures((prev) =>
												prev.map((d, i) =>
													i === idx
														? { ...d, commune: (e.target as HTMLSelectElement).value }
														: d,
												),
											)
										}
										class="sm:col-span-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
									>
										{ABIDJAN_COMMUNES.map((c) => (
											<option key={c} value={c}>
												{c}
											</option>
										))}
									</select>
									<input
										type="text"
										required
										placeholder="Point de rassemblement"
										value={dep.meetingPoint}
										onInput={(e) =>
											setInitialDepartures((prev) =>
												prev.map((d, i) =>
													i === idx
														? { ...d, meetingPoint: (e.target as HTMLInputElement).value }
														: d,
												),
											)
										}
										class="sm:col-span-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
									/>
									<input
										type="datetime-local"
										required
										value={dep.departureAt}
										onInput={(e) =>
											setInitialDepartures((prev) =>
												prev.map((d, i) =>
													i === idx
														? { ...d, departureAt: (e.target as HTMLInputElement).value }
														: d,
												),
											)
										}
										class="sm:col-span-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
									/>
									<div class="sm:col-span-2 flex gap-1.5 items-center">
										<input
											type="number"
											required
											min={1}
											placeholder="55"
											value={dep.capacity}
											onInput={(e) =>
												setInitialDepartures((prev) =>
													prev.map((d, i) =>
														i === idx
															? { ...d, capacity: (e.target as HTMLInputElement).value }
															: d,
													),
												)
											}
											class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
										/>
										{initialDepartures.length > 1 && (
											<button
												type="button"
												onClick={() =>
													setInitialDepartures((prev) => prev.filter((_, i) => i !== idx))
												}
												title="Retirer ce départ"
												class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-red-600 cursor-pointer"
											>
												<X class="h-3.5 w-3.5" />
											</button>
										)}
									</div>
								</div>
							))}
						</div>
					</div>

					<div class="rounded-xl border border-green-100 bg-green-50/40 p-4 space-y-2">
						<label class="block text-xs font-bold uppercase tracking-wide text-green-800">
							Photos de l’événement (1 ou plusieurs — JPEG, PNG, WebP)
						</label>
						<input
							type="file"
							multiple
							accept="image/jpeg,image/png,image/webp"
							onChange={(e) =>
								setInitialPhotos(Array.from((e.target as HTMLInputElement).files || []))
							}
							class="block w-full text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-green-600 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-green-700 cursor-pointer"
						/>
						{initialPhotos.length > 0 && (
							<p class="text-xs text-green-700 font-medium">
								{initialPhotos.length} photo(s) sélectionnée(s)
							</p>
						)}
					</div>

					<div class="flex flex-wrap items-center justify-end gap-3 pt-2">
						<button
							type="button"
							onClick={() => setView('list')}
							class="rounded-xl border border-green-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-green-50 cursor-pointer"
						>
							Annuler
						</button>
						<button
							type="submit"
							class="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 cursor-pointer"
						>
							<Plus class="h-4 w-4" />
							Publier l'événement
						</button>
					</div>
				</form>
			)}

			{view === 'list' && (
				<div class="space-y-4">
					{events.length === 0 ? (
						<div class="rounded-2xl border border-green-100 bg-green-50/30 p-10 text-center space-y-3">
							<p class="font-semibold text-slate-900">Aucun événement créé pour le moment</p>
							<button
								type="button"
								onClick={() => setView('create')}
								class="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 cursor-pointer"
							>
								<Plus class="h-4 w-4" />
								Créer mon premier événement
							</button>
						</div>
					) : (
						events.map((ev) => {
							const merchant = ev.wave_payment_url || defaultMerchantId;
							const previewUrl =
								merchant && ev.price_xof > 0
									? merchant.startsWith('http')
										? `${merchant}?amount=${ev.price_xof}`
										: `https://pay.wave.com/m/${merchant}/c/ci?amount=${ev.price_xof}`
									: null;
							const hasBookings = ev.convoys.some((cv) => cv.reserved_count > 0);
							const statusLabel =
								ev.status === 'published'
									? 'Publié'
									: ev.status === 'archived'
										? 'Archivé'
										: 'Brouillon';
							const statusCls =
								ev.status === 'published'
									? 'bg-emerald-50 text-emerald-700 border-emerald-200'
									: ev.status === 'archived'
										? 'bg-amber-50 text-amber-800 border-amber-200'
										: 'bg-slate-100 text-slate-700 border-slate-200';

							return (
								<div key={ev.id} class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
									<div class="flex flex-wrap items-start justify-between gap-3">
										<div>
											<div class="flex flex-wrap items-center gap-2.5">
												<h3 class="text-lg font-extrabold text-slate-950">{ev.title}</h3>
												<span class={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${statusCls}`}>
													{statusLabel}
												</span>
												{ev.category_name && (
													<span class="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-800">
														{ev.category_name}
													</span>
												)}
												<span class="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
													{formatXof(ev.price_xof)}
												</span>
											</div>
											<p class="text-xs text-slate-500 mt-1">
												{formatDate(ev.starts_at)} • {ev.venue}
											</p>
											{previewUrl && (
												<p class="font-mono text-[11px] text-emerald-700 mt-1 break-all">
													{previewUrl}
												</p>
											)}
										</div>
										<div class="flex flex-wrap items-center gap-2">
											{ev.status === 'archived' ? (
												<button
													type="button"
													onClick={() => setEventStatus(ev, 'published')}
													class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
												>
													<RotateCcw class="h-3.5 w-3.5" />
													Réactiver
												</button>
											) : (
												<>
													<button
														type="button"
														onClick={() =>
															setEventStatus(ev, ev.status === 'published' ? 'draft' : 'published')
														}
														class={`rounded-xl px-3 py-1.5 text-xs font-bold border cursor-pointer ${
															ev.status === 'published'
																? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
																: 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
														}`}
													>
														{ev.status === 'published' ? 'Passer brouillon' : 'Publier'}
													</button>
													<button
														type="button"
														onClick={() => setEventStatus(ev, 'archived')}
														class="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 cursor-pointer"
													>
														<Archive class="h-3.5 w-3.5" />
														Archiver
													</button>
												</>
											)}

											{confirmDeleteId === ev.id ? (
												<div class="inline-flex items-center gap-1">
													<button
														type="button"
														onClick={() => handleDeleteEvent(ev)}
														class="inline-flex items-center gap-1 rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
													>
														Confirmer suppression
													</button>
													<button
														type="button"
														onClick={() => setConfirmDeleteId(null)}
														title="Annuler"
														class="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-900 cursor-pointer"
													>
														<X class="h-3.5 w-3.5" />
													</button>
												</div>
											) : (
												<button
													type="button"
													disabled={hasBookings}
													onClick={() => setConfirmDeleteId(ev.id)}
													title={
														hasBookings
															? 'Suppression impossible : des places ont déjà été réservées'
															: "Supprimer définitivement l'événement"
													}
													class={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors ${
														hasBookings
															? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed'
															: 'border-red-200 bg-white text-red-600 hover:bg-red-50 cursor-pointer'
													}`}
												>
													<Trash2 class="h-3.5 w-3.5" />
													Supprimer
												</button>
											)}
										</div>
									</div>

									<div class="flex flex-wrap items-center gap-2">
										{getEventPosterUrls(ev).map((url, idx) => {
											const key = ev.poster_keys?.[idx] || ev.poster_key || '';
											return (
												<div
													key={url}
													class="relative h-16 w-24 overflow-hidden rounded-xl border border-green-200 bg-green-50"
												>
													<img src={url} alt={ev.title} class="h-full w-full object-cover" />
													{key && (
														<button
															type="button"
															onClick={() => handleRemovePhoto(ev.id, key)}
															title="Supprimer cette photo"
															class="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-red-600 cursor-pointer"
														>
															<X class="h-3 w-3" />
														</button>
													)}
												</div>
											);
										})}
										<label class="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-green-300 bg-green-50/50 px-3 py-2 text-xs font-semibold text-green-700 hover:bg-green-100 cursor-pointer">
											<ImagePlus class="h-4 w-4" />
											<span>Ajouter photos</span>
											<input
												type="file"
												multiple
												accept="image/jpeg,image/png,image/webp"
												class="hidden"
												onChange={(e) =>
													handleUploadMorePhotos(ev.id, (e.target as HTMLInputElement).files)
												}
											/>
										</label>
									</div>

									{ev.convoys.length > 0 && (
										<div class="text-xs text-slate-700 space-y-1.5 pt-2 border-t border-slate-100">
											<p class="font-bold text-slate-600">
												Départs par commune (prix inchangé) :
											</p>
											{ev.convoys.map((cv) => (
												<div
													key={cv.id}
													class="flex justify-between rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-1.5"
												>
													<span class="font-medium">
														{cv.commune || cv.name}{' '}
														{cv.meeting_point ? `• ${cv.meeting_point}` : ''}
													</span>
													<span class="font-bold text-emerald-700">
														{Math.max(0, cv.capacity - cv.reserved_count)}/{cv.capacity} dispo
													</span>
												</div>
											))}
										</div>
									)}

									<button
										type="button"
										onClick={() =>
											setConvoyForm({
												eventId: convoyForm.eventId === ev.id ? '' : ev.id,
												commune: 'Yopougon',
												meetingPoint: '',
												departureAt: ev.starts_at.slice(0, 16),
												capacity: '55',
											})
										}
										class="inline-flex items-center gap-1 rounded-xl border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 cursor-pointer"
									>
										<Bus class="h-3.5 w-3.5" />
										+ Ajouter une commune de départ (55 pl.)
									</button>

									{convoyForm.eventId === ev.id && (
										<form onSubmit={(e) => handleAddConvoy(e, ev)} class="grid gap-2 sm:grid-cols-4 pt-2">
											<select
												value={convoyForm.commune}
												onChange={(e) =>
													setConvoyForm({
														...convoyForm,
														commune: (e.target as HTMLSelectElement).value,
													})
												}
												class="rounded-xl border border-green-200 bg-white px-3 py-1.5 text-sm"
											>
												{ABIDJAN_COMMUNES.map((c) => (
													<option key={c} value={c}>
														{c}
													</option>
												))}
											</select>
											<input
												type="text"
												required
												placeholder="Point de rassemblement"
												value={convoyForm.meetingPoint}
												onInput={(e) =>
													setConvoyForm({
														...convoyForm,
														meetingPoint: (e.target as HTMLInputElement).value,
													})
												}
												class="rounded-xl border border-green-200 px-3 py-1.5 text-sm"
											/>
											<input
												type="datetime-local"
												required
												value={convoyForm.departureAt}
												onInput={(e) =>
													setConvoyForm({
														...convoyForm,
														departureAt: (e.target as HTMLInputElement).value,
													})
												}
												class="rounded-xl border border-green-200 px-3 py-1.5 text-sm"
											/>
											<div class="flex gap-2">
												<input
													type="number"
													required
													min={1}
													placeholder="Places"
													value={convoyForm.capacity}
													onInput={(e) =>
														setConvoyForm({
															...convoyForm,
															capacity: (e.target as HTMLInputElement).value,
														})
													}
													class="w-20 rounded-xl border border-green-200 px-3 py-1.5 text-sm"
												/>
												<button
													type="submit"
													class="flex-1 rounded-xl bg-green-600 px-3 py-1.5 text-sm font-semibold text-white cursor-pointer"
												>
													Ajouter
												</button>
											</div>
										</form>
									)}
								</div>
							);
						})
					)}
				</div>
			)}
		</div>
	);
}
