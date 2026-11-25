import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { Ticket, Calendar, MapPin, Bus, Lock, Download, FileText } from 'lucide-preact';
import { apiFetch, formatDate, formatXof } from '../lib/api';

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
	category_name: string | null;
	convoy_name: string | null;
	convoy_commune?: string | null;
	convoy_trip_type?: string | null;
	convoy_departure_at: string | null;
	convoy_meeting_point: string | null;
}

function QrPreview({ token }: { token: string }) {
	const [src, setSrc] = useState<string>('');

	useEffect(() => {
		QRCode.toDataURL(token, { width: 220, margin: 1, color: { dark: '#14532d', light: '#ffffff' } })
			.then(setSrc)
			.catch(() => {});
	}, [token]);

	if (!src) return <div class="h-44 w-44 rounded-xl bg-green-50 animate-pulse" />;
	return <img src={src} alt="QR Code ticket" class="h-44 w-44 rounded-xl border border-green-100 p-2 bg-white" />;
}

async function renderReceiptCanvas(t: WalletTicket): Promise<HTMLCanvasElement | null> {
	if (!t.qr_token) return null;

	const qrDataUrl = await QRCode.toDataURL(t.qr_token, {
		width: 360,
		margin: 2,
		color: { dark: '#14532d', light: '#ffffff' },
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

	// Fond blanc
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, width, height);

	// Bandeau en-tête vert pur
	ctx.fillStyle = '#16a34a';
	ctx.fillRect(0, 0, width, 150);

	ctx.fillStyle = '#ffffff';
	ctx.font = 'bold 34px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
	ctx.fillText('EVENTRIP-ABJ', 48, 68);

	ctx.font = '500 18px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
	ctx.fillStyle = '#dcfce7';
	ctx.fillText('REÇU OFFICIEL & BILLET D’ACCÈS', 48, 106);

	// Message de remerciement
	ctx.fillStyle = '#f0fdf4';
	ctx.fillRect(48, 178, width - 96, 64);
	ctx.strokeStyle = '#bbf7d0';
	ctx.lineWidth = 2;
	ctx.strokeRect(48, 178, width - 96, 64);

	ctx.fillStyle = '#166534';
	ctx.font = '600 18px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText('EVENTRIP-ABJ vous remercie de nous faire confiance !', width / 2, 217);
	ctx.textAlign = 'left';

	// Détails de l'événement et du billet
	const rows: Array<[string, string]> = [
		['Événement', t.event_title || '—'],
		[
			t.item_type === 'convoy_ticket' ? 'Convoi' : 'Catégorie',
			(t.item_type === 'convoy_ticket' ? t.convoy_name : t.category_name) || 'Standard',
		],
		['Date', formatDate(t.convoy_departure_at || t.event_starts_at)],
		['Lieu', t.convoy_meeting_point || t.event_venue || '—'],
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

		ctx.fillStyle = label === 'Montant payé' ? '#15803d' : '#0f172a';
		ctx.font =
			label === 'Montant payé' || label === 'Événement'
				? 'bold 20px "Satoshi-Variable", "Satoshi-Regular", sans-serif'
				: '600 18px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
		ctx.textAlign = 'right';
		ctx.fillText(String(value ?? '—').slice(0, 42), width - 48, y);
		ctx.textAlign = 'left';

		ctx.strokeStyle = '#f0fdf4';
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(48, y + 16);
		ctx.lineTo(width - 48, y + 16);
		ctx.stroke();

		y += 46;
	}

	// Cadre QR Code
	const qrBoxY = 665;
	ctx.fillStyle = '#f0fdf4';
	ctx.fillRect(190, qrBoxY, width - 380, 275);
	ctx.strokeStyle = '#bbf7d0';
	ctx.lineWidth = 2;
	ctx.strokeRect(190, qrBoxY, width - 380, 275);

	ctx.drawImage(qrImg, (width - 210) / 2, qrBoxY + 18, 210, 210);

	ctx.fillStyle = '#166534';
	ctx.font = '600 15px "Satoshi-Variable", "Satoshi-Regular", sans-serif';
	ctx.textAlign = 'center';
	ctx.fillText('Présentez ce QR code à l’entrée', width / 2, qrBoxY + 255);

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
	pending: { label: 'En attente de validation', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
	valid: { label: 'Valide', cls: 'bg-green-600 text-white border-green-600' },
	used: { label: 'Utilisé', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
	cancelled: { label: 'Annulé', cls: 'bg-red-50 text-red-700 border-red-200' },
};

export default function TicketsWallet() {
	const [tickets, setTickets] = useState<WalletTicket[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		apiFetch<{ tickets: WalletTicket[] }>('/api/tickets')
			.then((res) => setTickets(res.tickets))
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, []);

	if (loading) return <div class="h-64 rounded-2xl bg-green-50/40 animate-pulse" />;
	if (error) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				{error}
			</div>
		);
	}

	if (tickets.length === 0) {
		return (
			<div class="rounded-2xl border border-green-100 bg-green-50/40 p-10 text-center">
				<Ticket class="mx-auto h-10 w-10 text-green-600 mb-3" />
				<p class="font-semibold text-slate-900">Vous n’avez encore aucun billet</p>
			</div>
		);
	}

	return (
		<div class="grid gap-6 md:grid-cols-2">
			{tickets.map((t) => {
				const badge = STATUS_INFO[t.status] || STATUS_INFO.pending;
				return (
					<div
						key={t.id}
						class="flex flex-col justify-between rounded-2xl border border-green-100 bg-white p-6 shadow-xs"
					>
						<div>
							<div class="flex items-center justify-between gap-2">
								<span class="font-mono text-xs font-semibold text-slate-500">{t.code}</span>
								<span class={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>
									{badge.label}
								</span>
							</div>

							<h3 class="mt-3 text-lg font-bold text-slate-900">{t.event_title}</h3>
							<p class="mt-1 text-sm font-semibold text-green-700">
								{t.item_type === 'convoy_ticket' ? (
									<span class="inline-flex items-center gap-1.5">
										<Bus class="h-4 w-4" /> Convoi : {t.convoy_name}
									</span>
								) : (
									<span>Catégorie : {t.category_name}</span>
								)}
								{' · '}
								<span>{formatXof(t.price_xof)}</span>
							</p>

							<div class="mt-3 space-y-1 text-xs text-slate-600">
								<p class="flex items-center gap-1.5">
									<Calendar class="h-3.5 w-3.5 text-green-600" />
									{formatDate(t.convoy_departure_at || t.event_starts_at)}
								</p>
								<p class="flex items-center gap-1.5">
									<MapPin class="h-3.5 w-3.5 text-green-600" />
									{t.convoy_meeting_point || t.event_venue}
								</p>
								{t.item_type === 'convoy_ticket' && t.status !== 'pending' && t.status !== 'cancelled' && (
									<div class="pt-1 flex flex-wrap gap-1.5">
										<span
											class={`rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
												t.outbound_used_at
													? 'bg-slate-100 text-slate-600 border-slate-200'
													: 'bg-green-50 text-green-700 border-green-200'
											}`}
										>
											Aller : {t.outbound_used_at ? 'Scanné ✓' : 'Disponible'}
										</span>
										<span
											class={`rounded-full px-2 py-0.5 text-[11px] font-semibold border ${
												t.return_used_at
													? 'bg-slate-100 text-slate-600 border-slate-200'
													: 'bg-green-50 text-green-700 border-green-200'
											}`}
										>
											Retour : {t.return_used_at ? 'Scanné ✓' : 'Disponible'}
										</span>
									</div>
								)}
							</div>
						</div>

						<div class="mt-6 flex flex-col items-center justify-center rounded-xl bg-green-50/50 border border-green-100 p-4 gap-3">
							{t.status === 'valid' && t.qr_token ? (
								<>
									<QrPreview token={t.qr_token} />
									<div class="flex flex-wrap items-center justify-center gap-2">
										<button
											type="button"
											onClick={() => downloadTicketImage(t)}
											class="inline-flex items-center gap-1.5 rounded-xl border border-green-300 bg-white px-3.5 py-2 text-xs font-semibold text-green-700 hover:bg-green-50 transition-colors cursor-pointer"
										>
											<Download class="h-4 w-4" />
											Télécharger image
										</button>
										<button
											type="button"
											onClick={() => downloadTicketPdf(t)}
											class="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-green-700 transition-colors cursor-pointer"
										>
											<FileText class="h-4 w-4" />
											Télécharger PDF
										</button>
									</div>
								</>
							) : (
								<div class="flex flex-col items-center py-6 text-center text-slate-500">
									<Lock class="h-8 w-8 text-slate-400 mb-2" />
									<p class="text-xs font-medium">
										{t.status === 'pending'
											? 'QR code activé après validation du paiement Wave'
											: t.status === 'used'
												? `Ticket scanné le ${t.used_at ? formatDate(t.used_at) : ''}`
												: 'Ticket non utilisable'}
									</p>
								</div>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}
