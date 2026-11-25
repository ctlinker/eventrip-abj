import { useEffect, useState } from 'preact/hooks';
import { Plus, ImagePlus, X } from 'lucide-preact';
import { apiFetch, formatDate, formatXof, getEventPosterUrls } from '../../lib/api';

interface AdminEvent {
	id: string;
	slug: string;
	title: string;
	venue: string;
	starts_at: string;
	wave_payment_url: string | null;
	poster_key: string | null;
	poster_keys?: string[];
	status: 'draft' | 'published' | 'archived';
	categories: Array<{ id: string; name: string; price_xof: number; capacity: number; reserved_count: number }>;
	convoys: Array<{ id: string; name: string; price_xof: number; capacity: number; reserved_count: number }>;
}

export default function AdminEvents() {
	const [events, setEvents] = useState<AdminEvent[]>([]);
	const [defaultMerchantId, setDefaultMerchantId] = useState('');
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [startsAt, setStartsAt] = useState('2026-12-20T18:00');
	const [venue, setVenue] = useState('');
	const [waveUrl, setWaveUrl] = useState('');
	const [initialPhotos, setInitialPhotos] = useState<File[]>([]);
	const [initialCatName, setInitialCatName] = useState('Standard');
	const [initialPrice, setInitialPrice] = useState('');
	const [initialCapacity, setInitialCapacity] = useState('');
	const [catForm, setCatForm] = useState<{ eventId: string; name: string; price: string; capacity: string }>({
		eventId: '',
		name: '',
		price: '',
		capacity: '',
	});
	const [error, setError] = useState<string | null>(null);

	function load() {
		apiFetch<{ default_wave_merchant_id?: string; events: AdminEvent[] }>('/api/admin/events')
			.then((res) => {
				setEvents(res.events);
				if (res.default_wave_merchant_id) setDefaultMerchantId(res.default_wave_merchant_id);
			})
			.catch((err) => setError(err.message));
	}

	useEffect(() => {
		load();
	}, []);

	async function handleCreateEvent(e: Event) {
		e.preventDefault();
		setError(null);
		try {
			const created = await apiFetch<{ event: AdminEvent }>('/api/admin/events', {
				method: 'POST',
				body: JSON.stringify({
					title,
					description,
					starts_at: new Date(startsAt).toISOString(),
					venue,
					wave_payment_url: waveUrl.trim() || null,
					status: 'published',
				}),
			});

			if (created.event?.id && initialCatName.trim() && initialPrice !== '' && initialCapacity !== '') {
				await apiFetch(`/api/admin/events/${created.event.id}/categories`, {
					method: 'POST',
					body: JSON.stringify({
						name: initialCatName.trim(),
						price_xof: Number(initialPrice),
						capacity: Number(initialCapacity),
					}),
				});
			}

			if (created.event?.id && initialPhotos.length > 0) {
				const form = new FormData();
				for (const f of initialPhotos) {
					form.append('files', f);
				}
				await apiFetch(`/api/admin/events/${created.event.id}/poster`, {
					method: 'POST',
					body: form,
				});
			}

			setTitle('');
			setDescription('');
			setVenue('');
			setWaveUrl('');
			setInitialPhotos([]);
			setInitialCatName('Standard');
			setInitialPrice('');
			setInitialCapacity('');
			load();
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function toggleStatus(ev: AdminEvent) {
		const next = ev.status === 'published' ? 'draft' : 'published';
		await apiFetch(`/api/admin/events/${ev.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: next }),
		});
		load();
	}

	async function handleAddCategory(e: Event, eventId: string) {
		e.preventDefault();
		setError(null);
		try {
			await apiFetch(`/api/admin/events/${eventId}/categories`, {
				method: 'POST',
				body: JSON.stringify({
					name: catForm.name,
					price_xof: Number(catForm.price),
					capacity: Number(catForm.capacity),
				}),
			});
			setCatForm({ eventId: '', name: '', price: '', capacity: '' });
			load();
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
			await apiFetch(`/api/admin/events/${eventId}/poster`, {
				method: 'POST',
				body: form,
			});
			load();
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function handleRemovePhoto(eventId: string, key: string) {
		setError(null);
		try {
			await apiFetch(`/api/admin/events/${eventId}/poster`, {
				method: 'DELETE',
				body: JSON.stringify({ key }),
			});
			load();
		} catch (err: any) {
			setError(err.message);
		}
	}

	return (
		<div class="space-y-8">
			<form onSubmit={handleCreateEvent} class="rounded-2xl border border-green-100 bg-white p-6 space-y-4">
				<h2 class="text-lg font-bold text-slate-900">Créer un événement</h2>
				<div class="grid gap-4 sm:grid-cols-2">
					<input
						type="text"
						required
						placeholder="Titre de l'événement"
						value={title}
						onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
						class="rounded-xl border border-green-200 px-3.5 py-2 text-sm"
					/>
					<input
						type="text"
						required
						placeholder="Lieu (ex: Palais de la Culture)"
						value={venue}
						onInput={(e) => setVenue((e.target as HTMLInputElement).value)}
						class="rounded-xl border border-green-200 px-3.5 py-2 text-sm"
					/>
					<input
						type="datetime-local"
						required
						value={startsAt}
						onInput={(e) => setStartsAt((e.target as HTMLInputElement).value)}
						class="rounded-xl border border-green-200 px-3.5 py-2 text-sm"
					/>
					<input
						type="text"
						placeholder={`ID Marchand Wave (optionnel · défaut : ${defaultMerchantId || 'plateforme'})`}
						value={waveUrl}
						onInput={(e) => setWaveUrl((e.target as HTMLInputElement).value)}
						class="rounded-xl border border-green-200 px-3.5 py-2 text-sm"
					/>
				</div>
				<p class="text-xs text-slate-500">
					Le lien Wave <span class="font-mono">https://pay.wave.com/m/&lt;marchand&gt;/c/ci?amount=&lt;montant&gt;</span> est généré automatiquement à la commande selon les tickets choisis.
				</p>
				<textarea
					required
					rows={3}
					placeholder="Description de l'événement"
					value={description}
					onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
					class="w-full rounded-xl border border-green-200 px-3.5 py-2 text-sm"
				/>

				<div class="rounded-xl border border-green-100 bg-green-50/40 p-4 space-y-3">
					<p class="text-xs font-bold uppercase tracking-wide text-green-800">
						Tarif &amp; places (1ère catégorie de ticket)
					</p>
					<div class="grid gap-3 sm:grid-cols-3">
						<input
							type="text"
							required
							placeholder="Nom catégorie (ex: Standard)"
							value={initialCatName}
							onInput={(e) => setInitialCatName((e.target as HTMLInputElement).value)}
							class="rounded-xl border border-green-200 bg-white px-3.5 py-2 text-sm"
						/>
						<input
							type="number"
							required
							min={0}
							placeholder="Prix (FCFA)"
							value={initialPrice}
							onInput={(e) => setInitialPrice((e.target as HTMLInputElement).value)}
							class="rounded-xl border border-green-200 bg-white px-3.5 py-2 text-sm"
						/>
						<input
							type="number"
							required
							min={1}
							placeholder="Nombre de places"
							value={initialCapacity}
							onInput={(e) => setInitialCapacity((e.target as HTMLInputElement).value)}
							class="rounded-xl border border-green-200 bg-white px-3.5 py-2 text-sm"
						/>
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

				{error && <p class="text-xs text-red-600">{error}</p>}
				<button
					type="submit"
					class="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 cursor-pointer"
				>
					<Plus class="h-4 w-4" />
					Publier l'événement
				</button>
			</form>

			<div class="space-y-4">
				{events.map((ev) => (
					<div key={ev.id} class="rounded-2xl border border-green-100 bg-white p-6 space-y-4">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div>
								<h3 class="text-lg font-bold text-slate-900">{ev.title}</h3>
								<p class="text-xs text-slate-500">
									{formatDate(ev.starts_at)} · {ev.venue}
								</p>
							</div>
							<button
								type="button"
								onClick={() => toggleStatus(ev)}
								class={`rounded-xl px-3 py-1.5 text-xs font-semibold border cursor-pointer ${
									ev.status === 'published'
										? 'bg-green-600 text-white border-green-600'
										: 'bg-slate-100 text-slate-700 border-slate-200'
								}`}
							>
								{ev.status === 'published' ? 'Publié' : 'Brouillon'}
							</button>
						</div>

						<div class="flex flex-wrap items-center gap-2">
							{getEventPosterUrls(ev).map((url, idx) => {
								const key = ev.poster_keys?.[idx] || ev.poster_key || '';
								return (
									<div key={url} class="relative h-16 w-24 overflow-hidden rounded-xl border border-green-200 bg-green-50">
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
									onChange={(e) => handleUploadMorePhotos(ev.id, (e.target as HTMLInputElement).files)}
								/>
							</label>
						</div>

						<div class="text-sm text-slate-700 space-y-1">
							{ev.categories.length === 0 && (
								<p class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
									Aucune catégorie configurée — ajoutez un tarif ci-dessous pour activer la commande client.
								</p>
							)}
							{ev.categories.map((c) => {
								const merchant = ev.wave_payment_url || defaultMerchantId;
								const previewUrl = merchant
									? merchant.startsWith('http')
										? `${merchant}?amount=${c.price_xof}`
										: `https://pay.wave.com/m/${merchant}/c/ci?amount=${c.price_xof}`
									: null;
								async function handleUploadMorePhotos(eventId: string, files: FileList | null) {
		if (!files || files.length === 0) return;
		setError(null);
		const form = new FormData();
		Array.from(files).forEach((f) => form.append('files', f));
		try {
			await apiFetch(`/api/admin/events/${eventId}/poster`, {
				method: 'POST',
				body: form,
			});
			load();
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function handleRemovePhoto(eventId: string, key: string) {
		setError(null);
		try {
			await apiFetch(`/api/admin/events/${eventId}/poster`, {
				method: 'DELETE',
				body: JSON.stringify({ key }),
			});
			load();
		} catch (err: any) {
			setError(err.message);
		}
	}

	return (
									<div key={c.id} class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-green-50/50 px-3 py-1.5">
										<span>{c.name}</span>
										<div class="flex items-center gap-3">
											{previewUrl && (
												<span class="hidden sm:inline font-mono text-[11px] text-green-700 truncate max-w-xs">
													{previewUrl}
												</span>
											)}
											<span class="font-semibold">
												{formatXof(c.price_xof)} · {c.reserved_count}/{c.capacity} réservés
											</span>
										</div>
									</div>
								);
							})}
						</div>

						{catForm.eventId === ev.id ? (
							<form onSubmit={(e) => handleAddCategory(e, ev.id)} class="flex flex-wrap gap-2">
								<input
									type="text"
									required
									placeholder="Catégorie (ex: VIP)"
									value={catForm.name}
									onInput={(e) =>
										setCatForm({ ...catForm, name: (e.target as HTMLInputElement).value })
									}
									class="rounded-xl border border-green-200 px-3 py-1.5 text-sm"
								/>
								<input
									type="number"
									required
									placeholder="Prix FCFA"
									value={catForm.price}
									onInput={(e) =>
										setCatForm({ ...catForm, price: (e.target as HTMLInputElement).value })
									}
									class="w-32 rounded-xl border border-green-200 px-3 py-1.5 text-sm"
								/>
								<input
									type="number"
									required
									placeholder="Capacité"
									value={catForm.capacity}
									onInput={(e) =>
										setCatForm({ ...catForm, capacity: (e.target as HTMLInputElement).value })
									}
									class="w-28 rounded-xl border border-green-200 px-3 py-1.5 text-sm"
								/>
								<button
									type="submit"
									class="rounded-xl bg-green-600 px-3.5 py-1.5 text-sm font-semibold text-white cursor-pointer"
								>
									Ajouter
								</button>
							</form>
						) : (
							<button
								type="button"
								onClick={() => setCatForm({ eventId: ev.id, name: '', price: '', capacity: '' })}
								class="inline-flex items-center gap-1 rounded-xl border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100 cursor-pointer"
							>
								+ Ajouter une catégorie de tickets
							</button>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
