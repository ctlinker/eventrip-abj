import { useEffect, useState } from 'preact/hooks';
import QRCode from 'qrcode';
import { Ticket, Calendar, MapPin, Bus, Lock } from 'lucide-preact';
import { apiFetch, formatDate } from '../lib/api';

interface WalletTicket {
	id: string;
	code: string;
	qr_token: string | null;
	order_id: string;
	item_type: 'event_ticket' | 'convoy_ticket';
	status: 'pending' | 'valid' | 'used' | 'cancelled';
	used_at: string | null;
	event_title: string;
	event_starts_at: string;
	event_venue: string;
	category_name: string | null;
	convoy_name: string | null;
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
							</div>
						</div>

						<div class="mt-6 flex flex-col items-center justify-center rounded-xl bg-green-50/50 border border-green-100 p-4">
							{t.status === 'valid' && t.qr_token ? (
								<QrPreview token={t.qr_token} />
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
