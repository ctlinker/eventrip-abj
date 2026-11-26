import { useEffect, useState } from 'preact/hooks';
import { X, Lock, Copy, History, AlertTriangle, BellRing, CheckCircle2 } from 'lucide-preact';
import { apiFetch, formatDate, formatXof, type EventCategory } from '../../lib/api';

export interface AdminConvoyItem {
	id: string;
	name: string;
	commune?: string;
	meeting_point?: string;
	departure_at?: string;
	capacity: number;
	reserved_count: number;
	revision_number?: number;
	affected_holders_count?: number;
	affected_tickets_count?: number;
}

export interface AdminEventItem {
	id: string;
	slug: string;
	title: string;
	description?: string;
	venue: string;
	starts_at: string;
	price_xof: number;
	category_id?: string | null;
	category_name?: string | null;
	extra_info?: string | null;
	wave_payment_url: string | null;
	poster_key: string | null;
	poster_keys?: string[];
	status: 'draft' | 'published' | 'archived';
	revision_number?: number;
	price_locked?: boolean;
	active_orders_count?: number;
	affected_holders_count?: number;
	affected_tickets_count?: number;
	categories?: Array<{ id: string; name: string; price_xof: number }>;
	convoys: AdminConvoyItem[];
}

type Severity = 'minor' | 'important' | 'critical';

const SEVERITY_BADGE: Record<Severity, { label: string; cls: string }> = {
	minor: { label: 'Mineure', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
	important: { label: 'Importante', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
	critical: { label: 'Critique', cls: 'bg-red-50 text-red-700 border-red-200' },
};

function toLocalDatetimeInput(iso?: string | null): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface RevisionRecord {
	id: string;
	version_number: number;
	severity: Severity;
	change_summary: string | null;
	changes_json: string | null;
	changed_by_name?: string | null;
	created_at: string;
	convoy_label?: string;
}

export function EditEventModal({
	event,
	eventCategories,
	onClose,
	onSaved,
	onOpenClone,
}: {
	event: AdminEventItem;
	eventCategories: EventCategory[];
	onClose: () => void;
	onSaved: () => void;
	onOpenClone: () => void;
}) {
	const [title, setTitle] = useState(event.title);
	const [description, setDescription] = useState(event.description || '');
	const [venue, setVenue] = useState(event.venue);
	const [startsAt, setStartsAt] = useState(toLocalDatetimeInput(event.starts_at));
	const [priceXof, setPriceXof] = useState(String(event.price_xof));
	const [categoryId, setCategoryId] = useState(event.category_id || '');
	const [waveUrl, setWaveUrl] = useState(event.wave_payment_url || '');
	const [changeSummary, setChangeSummary] = useState('');
	const [confirmedNotify, setConfirmedNotify] = useState(false);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const nextStartsIso = startsAt ? new Date(startsAt).toISOString() : event.starts_at;
	const diffs: Array<{ label: string; before: string; after: string; severity: Severity }> = [];
	if (title.trim() !== event.title) {
		diffs.push({ label: 'Titre', before: event.title, after: title.trim(), severity: 'minor' });
	}
	if (description !== (event.description || '')) {
		diffs.push({ label: 'Description', before: 'Modifiée', after: 'Nouvelle description', severity: 'minor' });
	}
	if (venue.trim() !== event.venue) {
		diffs.push({ label: 'Lieu', before: event.venue, after: venue.trim(), severity: 'important' });
	}
	if (nextStartsIso !== event.starts_at) {
		diffs.push({
			label: 'Date',
			before: formatDate(event.starts_at),
			after: formatDate(nextStartsIso),
			severity: 'critical',
		});
	}
	if (!event.price_locked && Number(priceXof) !== event.price_xof) {
		diffs.push({
			label: 'Prix',
			before: formatXof(event.price_xof),
			after: formatXof(Number(priceXof) || 0),
			severity: 'minor',
		});
	}
	if ((categoryId || null) !== (event.category_id || null)) {
		diffs.push({ label: 'Catégorie', before: event.category_name || '—', after: 'Mise à jour', severity: 'minor' });
	}
	if ((waveUrl.trim() || null) !== (event.wave_payment_url || null)) {
		diffs.push({ label: 'Lien Wave', before: event.wave_payment_url || 'Défaut', after: waveUrl.trim() || 'Défaut', severity: 'minor' });
	}

	const severity: Severity = diffs.some((d) => d.severity === 'critical')
		? 'critical'
		: diffs.some((d) => d.severity === 'important')
			? 'important'
			: 'minor';
	const holders = event.affected_holders_count ?? 0;
	const needsConfirm = (severity === 'important' || severity === 'critical') && holders > 0;

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (diffs.length === 0 || saving) return;
		if (needsConfirm && !confirmedNotify) {
			setErr('Veuillez confirmer la notification des clients impactés.');
			return;
		}
		setSaving(true);
		setErr(null);
		try {
			const payload: Record<string, unknown> = {
				title: title.trim(),
				description,
				venue: venue.trim(),
				starts_at: nextStartsIso,
				category_id: categoryId || null,
				wave_payment_url: waveUrl.trim() || null,
				change_summary: changeSummary.trim() || undefined,
			};
			if (!event.price_locked) {
				payload.price_xof = Number(priceXof);
			}
			await apiFetch(`/api/admin/events/${event.id}`, {
				method: 'PATCH',
				body: JSON.stringify(payload),
			});
			onSaved();
		} catch (error: any) {
			setErr(error.message || 'Erreur lors de la mise à jour');
		} finally {
			setSaving(false);
		}
	}

	return (
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs overflow-y-auto">
			<div class="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl my-8">
				<button
					type="button"
					onClick={onClose}
					aria-label="Fermer"
					class="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
				>
					<X class="h-4 w-4" />
				</button>

				<div class="flex flex-wrap items-center gap-2 pr-8">
					<h3 class="text-lg font-extrabold text-slate-950">Modifier l’événement</h3>
					<span class="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-mono font-bold text-slate-700">
						v{event.revision_number ?? 1} → v{(event.revision_number ?? 1) + 1}
					</span>
					{holders > 0 && (
						<span class="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-bold text-amber-800">
							{holders} détenteur(s) ({event.affected_tickets_count ?? 0} billet(s))
						</span>
					)}
				</div>

				<form onSubmit={handleSubmit} class="mt-5 space-y-4">
					{err && <div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{err}</div>}

					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Titre</label>
							<input
								type="text"
								required
								value={title}
								onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
							/>
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Lieu</label>
							<input
								type="text"
								required
								value={venue}
								onInput={(e) => setVenue((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
							/>
						</div>
					</div>

					<div class="grid gap-3 sm:grid-cols-3">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Date &amp; heure</label>
							<input
								type="datetime-local"
								required
								value={startsAt}
								onInput={(e) => setStartsAt((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
							/>
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Catégorie</label>
							<select
								value={categoryId}
								onChange={(e) => setCategoryId((e.target as HTMLSelectElement).value)}
								class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
							>
								<option value="">Aucune</option>
								{eventCategories.map((c) => (
									<option key={c.id} value={c.id}>
										{c.name}
									</option>
								))}
							</select>
						</div>
						<div>
							<label class="flex items-center gap-1 text-xs font-semibold text-slate-600 mb-1">
								Prix (FCFA)
								{event.price_locked && <Lock class="h-3 w-3 text-amber-600" />}
							</label>
							<input
								type="number"
								min={0}
								disabled={Boolean(event.price_locked)}
								value={priceXof}
								onInput={(e) => setPriceXof((e.target as HTMLInputElement).value)}
								class={`w-full rounded-xl border px-3 py-2 text-sm ${
									event.price_locked
										? 'border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed'
										: 'border-slate-200 bg-white focus:border-brand-600 focus:outline-none'
								}`}
							/>
						</div>
					</div>

					{event.price_locked && (
						<div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-xs text-amber-900">
							<span class="flex items-center gap-1.5">
								<Lock class="h-3.5 w-3.5 shrink-0 text-amber-700" />
								Prix verrouillé ({event.active_orders_count} commande(s) active(s) ou confirmée(s)).
							</span>
							<button
								type="button"
								onClick={onOpenClone}
								class="inline-flex items-center gap-1 rounded-lg bg-navy-950 px-2.5 py-1 text-[11px] font-bold text-brand-200 hover:bg-navy-800 cursor-pointer"
							>
								<Copy class="h-3 w-3" />
								Changer via Dupliquer &amp; Archiver
							</button>
						</div>
					)}

					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Description</label>
						<textarea
							rows={2}
							value={description}
							onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
						/>
					</div>

					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Lien Wave (optionnel)</label>
							<input
								type="text"
								value={waveUrl}
								onInput={(e) => setWaveUrl((e.target as HTMLInputElement).value)}
								placeholder="ID marchand ou URL Wave"
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
							/>
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Motif de la révision (optionnel)</label>
							<input
								type="text"
								value={changeSummary}
								onInput={(e) => setChangeSummary((e.target as HTMLInputElement).value)}
								placeholder="Ex: Changement de salle suite à forte affluence"
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
							/>
						</div>
					</div>

					{diffs.length > 0 && (
						<div class="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-2.5">
							<div class="flex items-center justify-between gap-2">
								<p class="text-xs font-extrabold uppercase tracking-wide text-slate-700">
									Aperçu des modifications ({diffs.length})
								</p>
								<span class={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${SEVERITY_BADGE[severity].cls}`}>
									Sévérité : {SEVERITY_BADGE[severity].label}
								</span>
							</div>
							<ul class="space-y-1 text-xs text-slate-700">
								{diffs.map((d) => (
									<li key={d.label}>
										<strong>{d.label} :</strong> <span class="line-through text-slate-400">{d.before}</span> →{' '}
										<span class="font-bold text-slate-950">{d.after}</span>
									</li>
								))}
							</ul>
							{needsConfirm && (
								<label class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-950 cursor-pointer">
									<input
										type="checkbox"
										checked={confirmedNotify}
										onChange={(e) => setConfirmedNotify((e.target as HTMLInputElement).checked)}
										class="mt-0.5"
									/>
									<span>
										Je confirme cette modification <strong>{SEVERITY_BADGE[severity].label.toLowerCase()}</strong> :{' '}
										<strong>{holders} détenteur(s)</strong> seront notifiés (Push + in-app). Leurs QR codes resteront valides.
									</span>
								</label>
							)}
						</div>
					)}

					<div class="flex items-center justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
						>
							Annuler
						</button>
						<button
							type="submit"
							disabled={diffs.length === 0 || saving || (needsConfirm && !confirmedNotify)}
							class="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 cursor-pointer"
						>
							<BellRing class="h-4 w-4" />
							{saving
								? 'Enregistrement...'
								: needsConfirm
									? `Enregistrer v${(event.revision_number ?? 1) + 1} & notifier (${holders})`
									: `Enregistrer v${(event.revision_number ?? 1) + 1}`}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

export function EditConvoyModal({
	convoy,
	eventTitle,
	communeOptions,
	onClose,
	onSaved,
}: {
	convoy: AdminConvoyItem;
	eventTitle: string;
	communeOptions: string[];
	onClose: () => void;
	onSaved: () => void;
}) {
	const [commune, setCommune] = useState(convoy.commune || communeOptions[0] || '');
	const [meetingPoint, setMeetingPoint] = useState(convoy.meeting_point || '');
	const [departureAt, setDepartureAt] = useState(toLocalDatetimeInput(convoy.departure_at));
	const [capacity, setCapacity] = useState(String(convoy.capacity));
	const [changeSummary, setChangeSummary] = useState('');
	const [confirmedNotify, setConfirmedNotify] = useState(false);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	const nextDepIso = departureAt ? new Date(departureAt).toISOString() : convoy.departure_at || '';
	const diffs: Array<{ label: string; before: string; after: string; severity: Severity }> = [];
	if (commune !== (convoy.commune || '')) {
		diffs.push({ label: 'Commune', before: convoy.commune || '—', after: commune, severity: 'important' });
	}
	if (meetingPoint.trim() !== (convoy.meeting_point || '')) {
		diffs.push({
			label: 'Point de rassemblement',
			before: convoy.meeting_point || '—',
			after: meetingPoint.trim(),
			severity: 'important',
		});
	}
	if (nextDepIso !== (convoy.departure_at || '')) {
		diffs.push({
			label: 'Départ',
			before: convoy.departure_at ? formatDate(convoy.departure_at) : '—',
			after: formatDate(nextDepIso),
			severity: 'important',
		});
	}
	if (Number(capacity) !== convoy.capacity) {
		diffs.push({
			label: 'Capacité',
			before: `${convoy.capacity} places`,
			after: `${capacity} places`,
			severity: 'minor',
		});
	}

	const severity: Severity = diffs.some((d) => d.severity === 'important') ? 'important' : 'minor';
	const holders = convoy.affected_holders_count ?? 0;
	const needsConfirm = severity === 'important' && holders > 0;

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (diffs.length === 0 || saving) return;
		if (Number(capacity) < convoy.reserved_count) {
			setErr(`La capacité ne peut pas être inférieure aux ${convoy.reserved_count} place(s) déjà réservée(s).`);
			return;
		}
		if (needsConfirm && !confirmedNotify) {
			setErr('Veuillez confirmer la notification des passagers impactés.');
			return;
		}
		setSaving(true);
		setErr(null);
		try {
			await apiFetch(`/api/admin/convoys/${convoy.id}`, {
				method: 'PATCH',
				body: JSON.stringify({
					commune,
					meeting_point: meetingPoint.trim(),
					departure_at: nextDepIso,
					capacity: Number(capacity),
					change_summary: changeSummary.trim() || undefined,
				}),
			});
			onSaved();
		} catch (error: any) {
			setErr(error.message || 'Erreur lors de la mise à jour du départ');
		} finally {
			setSaving(false);
		}
	}

	return (
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
			<div class="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
				<button
					type="button"
					onClick={onClose}
					aria-label="Fermer"
					class="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
				>
					<X class="h-4 w-4" />
				</button>

				<div class="flex flex-wrap items-center gap-2 pr-8">
					<h3 class="text-lg font-extrabold text-slate-950">Modifier le départ</h3>
					<span class="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-xs font-mono font-bold text-slate-700">
						v{convoy.revision_number ?? 1} → v{(convoy.revision_number ?? 1) + 1}
					</span>
				</div>
				<p class="text-xs text-slate-500 mt-0.5">{eventTitle}</p>

				<form onSubmit={handleSubmit} class="mt-4 space-y-3.5">
					{err && <div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{err}</div>}

					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Commune</label>
							<select
								value={commune}
								onChange={(e) => setCommune((e.target as HTMLSelectElement).value)}
								class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
							>
								{communeOptions.map((c) => (
									<option key={c} value={c}>
										{c}
									</option>
								))}
							</select>
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">
								Capacité (min {Math.max(1, convoy.reserved_count)})
							</label>
							<input
								type="number"
								min={Math.max(1, convoy.reserved_count)}
								required
								value={capacity}
								onInput={(e) => setCapacity((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
							/>
						</div>
					</div>

					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Point de rassemblement</label>
						<input
							type="text"
							required
							value={meetingPoint}
							onInput={(e) => setMeetingPoint((e.target as HTMLInputElement).value)}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
						/>
					</div>

					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Heure de départ</label>
						<input
							type="datetime-local"
							required
							value={departureAt}
							onInput={(e) => setDepartureAt((e.target as HTMLInputElement).value)}
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
						/>
					</div>

					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Motif (optionnel)</label>
						<input
							type="text"
							value={changeSummary}
							onInput={(e) => setChangeSummary((e.target as HTMLInputElement).value)}
							placeholder="Ex: Départ décalé de 30 min"
							class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
						/>
					</div>

					{diffs.length > 0 && (
						<div class="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2">
							<div class="flex items-center justify-between">
								<p class="text-xs font-bold text-slate-700">Modifications ({diffs.length})</p>
								<span class={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${SEVERITY_BADGE[severity].cls}`}>
									{SEVERITY_BADGE[severity].label}
								</span>
							</div>
							<ul class="space-y-1 text-xs text-slate-700">
								{diffs.map((d) => (
									<li key={d.label}>
										<strong>{d.label} :</strong> <span class="line-through text-slate-400">{d.before}</span> →{' '}
										<span class="font-bold text-slate-950">{d.after}</span>
									</li>
								))}
							</ul>
							{needsConfirm && (
								<label class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-950 cursor-pointer">
									<input
										type="checkbox"
										checked={confirmedNotify}
										onChange={(e) => setConfirmedNotify((e.target as HTMLInputElement).checked)}
										class="mt-0.5"
									/>
									<span>
										Notifier les <strong>{holders} passager(s)</strong> concernés (Push + in-app). Leurs QR codes restent valides.
									</span>
								</label>
							)}
						</div>
					)}

					<div class="flex justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
						>
							Annuler
						</button>
						<button
							type="submit"
							disabled={diffs.length === 0 || saving || (needsConfirm && !confirmedNotify)}
							class="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 cursor-pointer"
						>
							{saving ? 'Enregistrement...' : `Enregistrer v${(convoy.revision_number ?? 1) + 1}`}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

export function CloneArchiveModal({
	event,
	onClose,
	onCloned,
}: {
	event: AdminEventItem;
	onClose: () => void;
	onCloned: () => void;
}) {
	const [title, setTitle] = useState(event.title);
	const [priceXof, setPriceXof] = useState(String(event.price_xof));
	const [status, setStatus] = useState<'published' | 'draft'>('published');
	const [convoyCaps, setConvoyCaps] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			event.convoys.map((cv) => [cv.id, String(Math.max(0, cv.capacity - cv.reserved_count))]),
		),
	);
	const [saving, setSaving] = useState(false);
	const [err, setErr] = useState<string | null>(null);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (saving) return;
		setSaving(true);
		setErr(null);
		try {
			await apiFetch(`/api/admin/events/${event.id}/clone-archive`, {
				method: 'POST',
				body: JSON.stringify({
					title: title.trim(),
					price_xof: Number(priceXof),
					status,
					convoys: event.convoys.map((cv) => ({
						source_convoy_id: cv.id,
						capacity: Math.max(0, Number(convoyCaps[cv.id] ?? 0)),
					})),
				}),
			});
			onCloned();
		} catch (error: any) {
			setErr(error.message || 'Impossible de dupliquer cet événement');
		} finally {
			setSaving(false);
		}
	}

	return (
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs overflow-y-auto">
			<div class="relative w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl my-8">
				<button
					type="button"
					onClick={onClose}
					aria-label="Fermer"
					class="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
				>
					<X class="h-4 w-4" />
				</button>

				<div class="flex items-center gap-2 pr-8">
					<Copy class="h-5 w-5 text-brand-600" />
					<h3 class="text-lg font-extrabold text-slate-950">Dupliquer &amp; Archiver</h3>
				</div>
				<p class="text-xs text-slate-600 mt-1">
					L’événement actuel sera <strong>archivé</strong> (toutes les commandes et billets déjà vendus restent valides et intacts). Un nouvel événement indépendant sera créé avec le nouveau tarif.
				</p>

				<form onSubmit={handleSubmit} class="mt-4 space-y-4">
					{err && <div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{err}</div>}

					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">Titre de la nouvelle édition</label>
							<input
								type="text"
								required
								value={title}
								onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
							/>
						</div>
						<div>
							<label class="block text-xs font-semibold text-slate-600 mb-1">
								Nouveau prix (FCFA) — ancien : {formatXof(event.price_xof)}
							</label>
							<input
								type="number"
								min={0}
								required
								value={priceXof}
								onInput={(e) => setPriceXof((e.target as HTMLInputElement).value)}
								class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold focus:border-brand-600 focus:outline-none"
							/>
						</div>
					</div>

					<div>
						<label class="block text-xs font-semibold text-slate-600 mb-1">Statut du nouvel événement</label>
						<select
							value={status}
							onChange={(e) => setStatus((e.target as HTMLSelectElement).value as 'published' | 'draft')}
							class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none"
						>
							<option value="published">Publier immédiatement</option>
							<option value="draft">Créer en brouillon</option>
						</select>
					</div>

					{event.convoys.length > 0 && (
						<div class="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
							<div class="flex items-start gap-2">
								<AlertTriangle class="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
								<p class="text-xs text-slate-700">
									<strong>Capacité des convois clonés :</strong> pré-remplie avec les <strong>places restantes</strong> (<code>capacité − réservées</code>) pour éviter le surbooking si vous utilisez les mêmes véhicules. Mettez <code>0</code> pour ne pas cloner un départ.
								</p>
							</div>
							<div class="space-y-2">
								{event.convoys.map((cv) => (
									<div key={cv.id} class="flex items-center justify-between gap-3 rounded-lg bg-white border border-slate-200 px-3 py-2 text-xs">
										<div class="min-w-0">
											<p class="font-bold text-slate-900 truncate">{cv.commune || cv.name}</p>
											<p class="text-slate-500">
												Actuel : {cv.reserved_count}/{cv.capacity} réservées ({Math.max(0, cv.capacity - cv.reserved_count)} restantes)
											</p>
										</div>
										<input
											type="number"
											min={0}
											value={convoyCaps[cv.id] ?? '0'}
											onInput={(e) =>
												setConvoyCaps((prev) => ({
													...prev,
													[cv.id]: (e.target as HTMLInputElement).value,
												}))
											}
											class="w-24 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-bold text-right"
										/>
									</div>
								))}
							</div>
						</div>
					)}

					<div class="flex justify-end gap-2 pt-2">
						<button
							type="button"
							onClick={onClose}
							class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
						>
							Annuler
						</button>
						<button
							type="submit"
							disabled={saving}
							class="inline-flex items-center gap-1.5 rounded-xl bg-navy-950 px-4 py-2 text-sm font-bold text-brand-200 hover:bg-navy-800 hover:text-white disabled:opacity-50 cursor-pointer"
						>
							<Copy class="h-4 w-4" />
							{saving ? 'Duplication...' : 'Dupliquer & Archiver'}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}

export function RevisionHistoryModal({
	event,
	onClose,
}: {
	event: AdminEventItem;
	onClose: () => void;
}) {
	const [loading, setLoading] = useState(true);
	const [eventRevs, setEventRevs] = useState<RevisionRecord[]>([]);
	const [convoyRevs, setConvoyRevs] = useState<RevisionRecord[]>([]);
	const [err, setErr] = useState<string | null>(null);

	useEffect(() => {
		apiFetch<{ event_revisions: RevisionRecord[]; convoy_revisions: RevisionRecord[] }>(
			`/api/admin/events/${event.id}/revisions`,
		)
			.then((res) => {
				setEventRevs(res.event_revisions || []);
				setConvoyRevs(res.convoy_revisions || []);
			})
			.catch((e) => setErr(e.message))
			.finally(() => setLoading(false));
	}, [event.id]);

	function parseChanges(raw: string | null): Array<{ label: string; before: unknown; after: unknown }> {
		if (!raw) return [];
		try {
			return JSON.parse(raw);
		} catch {
			return [];
		}
	}

	return (
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs overflow-y-auto">
			<div class="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl my-8 max-h-[85vh] overflow-y-auto">
				<button
					type="button"
					onClick={onClose}
					aria-label="Fermer"
					class="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
				>
					<X class="h-4 w-4" />
				</button>

				<div class="flex items-center gap-2 pr-8">
					<History class="h-5 w-5 text-brand-600" />
					<h3 class="text-lg font-extrabold text-slate-950">Historique des révisions</h3>
				</div>
				<p class="text-xs text-slate-500 mt-0.5">{event.title}</p>

				{loading ? (
					<div class="mt-4 h-32 rounded-xl bg-slate-50 animate-pulse" />
				) : err ? (
					<div class="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{err}</div>
				) : (
					<div class="mt-5 space-y-6">
						<div class="space-y-2.5">
							<h4 class="text-xs font-extrabold uppercase tracking-wide text-slate-500">
								Révisions de l’événement ({eventRevs.length})
							</h4>
							{eventRevs.map((r) => {
								const changes = parseChanges(r.changes_json);
								const sev = SEVERITY_BADGE[r.severity] || SEVERITY_BADGE.minor;
								return (
									<div key={r.id} class="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-xs space-y-1.5">
										<div class="flex flex-wrap items-center justify-between gap-2">
											<div class="flex items-center gap-2">
												<span class="font-mono font-extrabold text-navy-950">v{r.version_number}</span>
												<span class={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${sev.cls}`}>
													{sev.label}
												</span>
												{r.changed_by_name && (
													<span class="text-slate-500">par {r.changed_by_name}</span>
												)}
											</div>
											<span class="text-slate-400">{formatDate(r.created_at)}</span>
										</div>
										{r.change_summary && <p class="font-semibold text-slate-800">{r.change_summary}</p>}
										{changes.length > 0 && (
											<ul class="space-y-0.5 text-slate-600 pt-1 border-t border-slate-200/70">
												{changes.map((c, idx) => (
													<li key={idx}>
														<strong>{c.label} :</strong>{' '}
														<span class="line-through text-slate-400">{String(c.before ?? '—')}</span> →{' '}
														<span class="font-semibold text-slate-900">{String(c.after ?? '—')}</span>
													</li>
												))}
											</ul>
										)}
									</div>
								);
							})}
						</div>

						{convoyRevs.length > 0 && (
							<div class="space-y-2.5">
								<h4 class="text-xs font-extrabold uppercase tracking-wide text-slate-500">
									Révisions des convois ({convoyRevs.length})
								</h4>
								{convoyRevs.map((r) => {
									const changes = parseChanges(r.changes_json);
									const sev = SEVERITY_BADGE[r.severity] || SEVERITY_BADGE.minor;
									return (
										<div key={r.id} class="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-xs space-y-1.5">
											<div class="flex flex-wrap items-center justify-between gap-2">
												<div class="flex items-center gap-2">
													<span class="font-bold text-brand-700">{r.convoy_label}</span>
													<span class="font-mono font-extrabold text-navy-950">v{r.version_number}</span>
													<span class={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${sev.cls}`}>
														{sev.label}
													</span>
													{r.changed_by_name && (
														<span class="text-slate-500">par {r.changed_by_name}</span>
													)}
												</div>
												<span class="text-slate-400">{formatDate(r.created_at)}</span>
											</div>
											{r.change_summary && <p class="font-semibold text-slate-800">{r.change_summary}</p>}
											{changes.length > 0 && (
												<ul class="space-y-0.5 text-slate-600 pt-1 border-t border-slate-200/70">
													{changes.map((c, idx) => (
														<li key={idx}>
															<strong>{c.label} :</strong>{' '}
															<span class="line-through text-slate-400">{String(c.before ?? '—')}</span> →{' '}
															<span class="font-semibold text-slate-900">{String(c.after ?? '—')}</span>
														</li>
													))}
												</ul>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
