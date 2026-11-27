import { useEffect, useRef, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { Ticket, Calendar, MapPin, Bus, Lock, Download, FileText, QrCode, X, RefreshCw } from 'lucide-preact';
import { apiFetch, formatDate, formatXof } from '../lib/api';
import { subscribeRealtime } from '../lib/realtime';

interface TicketPurchaseSnapshot {
	event_id: string;
	event_title: string;
	event_starts_at: string;
	event_venue: string;
	event_version: number;
	convoy_id: string | null;
	convoy_name: string | null;
	convoy_commune: string | null;
	convoy_departure_at: string | null;
	convoy_meeting_point: string | null;
	convoy_version: number | null;
	unit_price_xof: number;
	purchased_at: string;
}

interface WalletTicket {
	id: string;
	code: string;
	qr_token: string | null;
	order_id: string;
	order_reference: string;
	price_xof: number;
	holder_name: string;
	item_type: 'event_ticket' | 'convoy_ticket';
	status: 'pending' | 'valid' | 'used' | 'cancelled';
	used_at: string | null;
	outbound_used_at?: string | null;
	return_used_at?: string | null;
	event_title: string;
	event_starts_at: string;
	event_venue: string;
	event_current_version?: number;
	category_name: string | null;
	convoy_name: string | null;
	convoy_commune?: string | null;
	convoy_trip_type?: string | null;
	convoy_departure_at: string | null;
	convoy_meeting_point: string | null;
	convoy_current_version?: number | null;
	purchase_snapshot?: TicketPurchaseSnapshot | null;
	has_updates?: boolean;
}

function QrModal({ ticket, onClose }: { ticket: WalletTicket; onClose: () => void }) {
	const [src, setSrc] = useState<string>('');
	const closeBtnRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		const previousFocus = document.activeElement as HTMLElement | null;
		closeBtnRef.current?.focus();

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			previousFocus?.focus?.();
		};
	}, [onClose]);

	useEffect(() => {
		if (!ticket.qr_token) return;
		QRCode.toDataURL(ticket.qr_token, {
			width: 280,
			margin: 2,
			color: { dark: '#064e3b', light: '#ffffff' },
		})
			.then(setSrc)
			.catch(() => {});
	}, [ticket.qr_token]);

	return (
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby={`qr-modal-title-${ticket.id}`}
				class="relative w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<button
					ref={closeBtnRef}
					type="button"
					onClick={onClose}
					aria-label="Fermer"
					class="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer"
				>
					<X class="h-4 w-4" />
				</button>

				<p class="font-mono text-xs font-bold text-brand-600">{ticket.code}</p>
				<h3 id={`qr-modal-title-${ticket.id}`} class="mt-1 text-lg font-extrabold text-slate-950">
					{ticket.event_title}
				</h3>
				<p class="text-xs text-slate-500">
					{ticket.convoy_commune ? `Départ ${ticket.convoy_commune}` : ticket.event_venue}
				</p>

				<div class="my-5 flex justify-center">
					{src ? (
						<img
							src={src}
							alt={`QR Code ${ticket.code}`}
							class="h-60 w-60 rounded-2xl border border-slate-200 p-2 bg-white"
						/>
					) : (
						<div class="h-60 w-60 rounded-2xl bg-slate-100 animate-pulse" />
					)}
				</div>

				<p class="text-xs font-semibold text-slate-600">
					Présentez ce QR code au contrôleur (Aller &amp; Retour)
				</p>
			</div>
		</div>
	);
}

async function renderReceiptCanvas(t: WalletTicket): Promise<HTMLCanvasElement | null> {
	if (!t.qr_token) return null;

	const qrDataUrl = await QRCode.toDataURL(t.qr_token, {
		width: 360,
		margin: 2,
		color: { dark: '#064e3b', light: '#ffffff' },
	});

	const qrImg = new Image();
	await new Promise<void>((resolve, reject) => {
		qrImg.onload = () => resolve();
		qrImg.onerror = () => reject(new Error('Erreur génération QR'));
		qrImg.src = qrDataUrl;
	});

	const width = 720;
	const height = 1000;
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;

	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, width, height);

	ctx.fillStyle = '#0e1827';
	ctx.fillRect(0, 0, width, 150);

	ctx.fillStyle = '#ffffff';
	ctx.font = 'bold 34px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
	ctx.fillText('EVENTRIP-ABJ', 48, 68);

	ctx.font = '500 18px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
	ctx.fillStyle = '#e3c183';
	ctx.fillText('REÇU OFFICIEL & BILLET ALLER-RETOUR', 48, 106);

	ctx.fillStyle = '#fdf9ef';
	ctx.fillRect(48, 178, width - 96, 64);
	ctx.strokeStyle = '#a7f3d0';
	ctx.lineWidth = 2;
	ctx.strokeRect(48, 178, width - 96, 64);

	ctx.fillStyle = '#065f46';
	ctx.font = '600 18px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText('EVENTRIP-ABJ vous remercie de nous faire confiance !', width / 2, 217);
	ctx.textAlign = 'left';

	const rows: Array<[string, string]> = [
		['Événement', t.event_title || '—'],
		[
			'Départ',
			t.item_type === 'convoy_ticket'
				? t.convoy_commune || t.convoy_name || 'Convoi'
				: t.category_name || 'Standard',
		],
		['Date', formatDate(t.convoy_departure_at || t.event_starts_at)],
		['Rassemblement / Lieu', t.convoy_meeting_point || t.event_venue || '—'],
		['Titulaire', t.holder_name || 'Client'],
		['Référence commande', t.order_reference || t.order_id.slice(0, 8)],
		['Code billet', t.code || '—'],
		['Montant payé', typeof t.price_xof === 'number' ? formatXof(t.price_xof) : '—'],
	];

	let y = 290;
	for (const [label, value] of rows) {
		ctx.fillStyle = '#64748b';
		ctx.font = '500 16px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
		ctx.fillText(label, 48, y);

		ctx.fillStyle = label === 'Montant payé' ? '#9a6f28' : '#0e1827';
		ctx.font =
			label === 'Montant payé' || label === 'Événement'
				? 'bold 20px "Satoshi-Variable", "Satoshi-Regular", sans-serif'
				: '600 18px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
		ctx.textAlign = 'right';
		ctx.fillText(String(value ?? '—').slice(0, 42), width - 48, y);
		ctx.textAlign = 'left';

		ctx.strokeStyle = '#f1f5f9';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(48, y + 16);
		ctx.lineTo(width - 48, y + 16);
		ctx.stroke();

		y += 46;
	}

	const qrBoxY = 665;
	ctx.fillStyle = '#f8fafc';
	ctx.fillRect(190, qrBoxY, width - 380, 275);
	ctx.strokeStyle = '#e2e8f0';
	ctx.lineWidth = 2;
	ctx.strokeRect(190, qrBoxY, width - 380, 275);

	ctx.drawImage(qrImg, (width - 210) / 2, qrBoxY + 18, 210, 210);

	ctx.fillStyle = '#0f172a';
	ctx.font = '600 15px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText('Présentez ce QR code à l’aller et au retour', width / 2, qrBoxY + 255);

	return canvas;
}

async function downloadTicketImage(t: WalletTicket) {
	const canvas = await renderReceiptCanvas(t);
	if (!canvas) return;
	const link = document.createElement('a');
	link.download = `recu-${t.code}.png`;
	link.href = canvas.toDataURL('image/png');
	link.click();
}

async function downloadTicketPdf(t: WalletTicket) {
	const canvas = await renderReceiptCanvas(t);
	if (!canvas) return;
	const { jsPDF } = await import('jspdf');
	const doc = new jsPDF({
		orientation: 'portrait',
		unit: 'px',
		format: [canvas.width, canvas.height],
	});
	doc.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
	doc.save(`recu-${t.code}.pdf`);
}

const STATUS_INFO: Record<string, { label: string; cls: string }> = {
	pending: { label: 'En attente Wave', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
	valid: { label: 'Valide', cls: 'bg-emerald-600 text-white border-emerald-600' },
	used: { label: 'Utilisé', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
	cancelled: { label: 'Annulé', cls: 'bg-red-50 text-red-700 border-red-200' },
};

export default function TicketsWallet() {
	const [tickets, setTickets] = useState<WalletTicket[]>([]);
	const [activeQrTicket, setActiveQrTicket] = useState<WalletTicket | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const fetchTickets = () =>
			apiFetch<{ tickets: WalletTicket[] }>('/api/tickets')
				.then((res) => setTickets(res.tickets))
				.catch((err) => setError(err.message))
				.finally(() => setLoading(false));

		fetchTickets();

		return subscribeRealtime((ev) => {
			if (
				ev.type === 'payment_confirmed' ||
				ev.type === 'payment_rejected' ||
				ev.type === 'ticket_scanned' ||
				ev.type === 'order_expired' ||
				ev.type === 'event_updated' ||
				ev.type === 'convoy_updated'
			) {
				fetchTickets();
			}
		});
	}, []);

	if (loading) return <div class="h-64 rounded-2xl bg-slate-50 border border-slate-200 animate-pulse" />;
	if (error) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				{error}
			</div>
		);
	}

	if (tickets.length === 0) {
		return (
			<div class="rounded-2xl border border-slate-200 bg-slate-50/60 p-10 text-center">
				<Ticket class="mx-auto h-10 w-10 text-brand-600 mb-3" />
				<p class="font-bold text-slate-950">Vous n’avez encore aucun billet</p>
				<a
					href="/"
					class="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
				>
					Explorer les événements
				</a>
			</div>
		);
	}

	return (
		<>
			<div class="grid gap-6 md:grid-cols-2">
				{tickets.map((t) => {
					const badge = STATUS_INFO[t.status] || STATUS_INFO.pending;
					const snap = t.purchase_snapshot;
					const currentDate = t.convoy_departure_at || t.event_starts_at;
					const origDate = snap ? snap.convoy_departure_at || snap.event_starts_at : null;
					const dateChanged = Boolean(origDate && origDate !== currentDate);
					const currentLocation = t.convoy_meeting_point || t.event_venue;
					const origLocation = snap ? snap.convoy_meeting_point || snap.event_venue : null;
					const locationChanged = Boolean(origLocation && origLocation !== currentLocation);
					const titleChanged = Boolean(snap && snap.event_title !== t.event_title);
					const showUpdateBadge = Boolean(t.has_updates || dateChanged || locationChanged || titleChanged);

					return (
						<div
							key={t.id}
							class="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs"
						>
							<div class="p-6">
								<div class="flex flex-wrap items-center justify-between gap-2">
									<span class="font-mono text-xs font-bold text-slate-500">{t.code}</span>
									<div class="flex items-center gap-1.5">
										{showUpdateBadge && (
											<span class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
												<RefreshCw class="h-3 w-3" />
												Mis à jour
											</span>
										)}
										<span class={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${badge.cls}`}>
											{badge.label}
										</span>
									</div>
								</div>

								<h3 class="mt-3 text-lg font-extrabold text-slate-950">{t.event_title}</h3>
								<p class="mt-1 text-sm font-bold text-brand-700">
									{t.item_type === 'convoy_ticket' ? (
										<span class="inline-flex items-center gap-1.5">
											<Bus class="h-4 w-4" /> Départ {t.convoy_commune || t.convoy_name}
										</span>
									) : (
										<span>{t.category_name || 'Billet événement'}</span>
									)}
									{typeof t.price_xof === 'number' && (
										<>
											{' • '}
											<span class="text-slate-900">{formatXof(t.price_xof)}</span>
										</>
									)}
								</p>

								<div class="mt-3 space-y-1 text-xs text-slate-500">
									<p class="flex flex-wrap items-center gap-1.5">
										<Calendar class="h-3.5 w-3.5 text-brand-600 shrink-0" />
										{dateChanged && origDate && (
											<span class="line-through text-slate-400">{formatDate(origDate)}</span>
										)}
										<span class={dateChanged ? 'font-bold text-amber-900' : ''}>
											{formatDate(currentDate)}
										</span>
									</p>
									<p class="flex flex-wrap items-center gap-1.5">
										<MapPin class="h-3.5 w-3.5 text-brand-600 shrink-0" />
										{locationChanged && origLocation && (
											<span class="line-through text-slate-400">{origLocation}</span>
										)}
										<span class={locationChanged ? 'font-bold text-amber-900' : ''}>
											{currentLocation}
										</span>
									</p>

									{showUpdateBadge && snap && (
										<details class="mt-2 rounded-xl border border-amber-200/80 bg-amber-50/50 px-3 py-2 text-[11px] text-amber-950">
											<summary class="cursor-pointer font-bold select-none">
												Informations mises à jour · Voir l’achat d’origine
											</summary>
											<div class="mt-2 space-y-1 border-t border-amber-200/70 pt-2 text-slate-700">
												<p>
													<strong>Événement initial :</strong> {snap.event_title} (v{snap.event_version})
												</p>
												<p>
													<strong>Date initiale :</strong> {formatDate(snap.convoy_departure_at || snap.event_starts_at)}
												</p>
												<p>
													<strong>Lieu initial :</strong> {snap.convoy_meeting_point || snap.event_venue}
												</p>
												<p>
													<strong>Prix payé (immuable) :</strong> {formatXof(snap.unit_price_xof)} · Acheté le{' '}
													{formatDate(snap.purchased_at)}
												</p>
											</div>
										</details>
									)}
									{t.item_type === 'convoy_ticket' &&
										t.status !== 'pending' &&
										t.status !== 'cancelled' && (
											<div class="pt-2 flex flex-wrap gap-1.5">
												<span
													class={`rounded-md px-2 py-0.5 text-[11px] font-bold border ${
														t.outbound_used_at
															? 'bg-slate-100 text-slate-500 border-slate-200'
															: 'bg-emerald-50 text-emerald-700 border-emerald-200'
													}`}
												>
													Aller : {t.outbound_used_at ? 'Scanné ✓' : 'Dispo'}
												</span>
												<span
													class={`rounded-md px-2 py-0.5 text-[11px] font-bold border ${
														t.return_used_at
															? 'bg-slate-100 text-slate-500 border-slate-200'
															: 'bg-emerald-50 text-emerald-700 border-emerald-200'
													}`}
												>
													Retour : {t.return_used_at ? 'Scanné ✓' : 'Dispo'}
												</span>
											</div>
										)}
								</div>
							</div>

							{/* Ligne perforée style billet d'accès */}
							<div class="relative border-t border-dashed border-slate-200 bg-slate-50/70 px-6 py-4">
								<span
									class="pointer-events-none absolute -top-2.5 -left-2.5 h-5 w-5 rounded-full border border-slate-200 bg-white"
									aria-hidden="true"
								/>
								<span
									class="pointer-events-none absolute -top-2.5 -right-2.5 h-5 w-5 rounded-full border border-slate-200 bg-white"
									aria-hidden="true"
								/>

								{t.status === 'valid' && t.qr_token ? (
									<div class="flex flex-wrap items-center justify-between gap-2">
										<button
											type="button"
											onClick={() => setActiveQrTicket(t)}
											class="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white hover:bg-brand-700 transition-colors cursor-pointer shadow-xs"
										>
											<QrCode class="h-4 w-4" />
											Afficher QR
										</button>

										<div class="flex items-center gap-1.5">
											<button
												type="button"
												onClick={() => downloadTicketImage(t)}
												title="Télécharger en image PNG"
												class="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
											>
												<Download class="h-3.5 w-3.5 text-brand-600" />
												Image
											</button>
											<button
												type="button"
												onClick={() => downloadTicketPdf(t)}
												title="Télécharger en PDF"
												class="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
											>
												<FileText class="h-3.5 w-3.5 text-brand-600" />
												PDF
											</button>
										</div>
									</div>
								) : (
									<div class="flex items-center gap-2 text-slate-500">
										<Lock class="h-4 w-4 text-slate-400 shrink-0" />
										<p class="text-xs font-medium">
											{t.status === 'pending'
												? 'QR activé dès confirmation du paiement Wave'
												: t.status === 'used'
													? `Billet entièrement utilisé (${t.used_at ? formatDate(t.used_at) : ''})`
													: 'Billet annulé'}
										</p>
									</div>
								)}
							</div>
						</div>
					);
				})}
			</div>

			{activeQrTicket && (
				<QrModal ticket={activeQrTicket} onClose={() => setActiveQrTicket(null)} />
			)}
		</>
	);
}
