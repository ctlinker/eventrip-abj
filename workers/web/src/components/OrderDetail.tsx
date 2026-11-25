import { useEffect, useState } from 'preact/hooks';
import { Clock, Upload, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-preact';
import { apiFetch, formatDate, formatXof } from '../lib/api';

interface Props {
	orderId: string;
}

interface OrderDetailResponse {
	order: {
		id: string;
		reference: string;
		total_amount_xof: number;
		status: string;
		expires_at: string;
		created_at: string;
	};
	items: Array<{
		id: string;
		item_type: string;
		quantity: number;
		unit_price_xof: number;
		subtotal_xof: number;
	}>;
	payment: {
		id: string;
		expected_amount_xof: number;
		payer_phone: string | null;
		proof_image_key: string | null;
		status: string;
		rejection_reason: string | null;
		submitted_at: string | null;
	} | null;
	tickets: Array<{
		id: string;
		code: string;
		item_type: string;
		status: string;
	}>;
}

export default function OrderDetail({ orderId }: Props) {
	const [data, setData] = useState<OrderDetailResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [payerPhone, setPayerPhone] = useState('');
	const [file, setFile] = useState<File | null>(null);
	const [uploading, setUploading] = useState(false);
	const [remainingText, setRemainingText] = useState('');

	function load() {
		apiFetch<OrderDetailResponse>(`/api/orders/${orderId}`)
			.then((res) => {
				setData(res);
				if (res.payment?.payer_phone) setPayerPhone(res.payment.payer_phone);
			})
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}

	useEffect(() => {
		load();
	}, [orderId]);

	useEffect(() => {
		if (!data || data.order.status !== 'pending_payment') return;
		const tick = () => {
			const diff = new Date(data.order.expires_at).getTime() - Date.now();
			if (diff <= 0) {
				setRemainingText('Expirée');
				return;
			}
			const mins = Math.floor(diff / 60000);
			const secs = Math.floor((diff % 60000) / 1000);
			setRemainingText(`${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`);
		};
		tick();
		const id = setInterval(tick, 1000);
		return () => clearInterval(id);
	}, [data]);

	async function handleUpload(e: Event) {
		e.preventDefault();
		if (!file) return;
		setUploading(true);
		setError(null);

		const form = new FormData();
		form.append('file', file);
		if (payerPhone.trim()) form.append('payer_phone', payerPhone.trim());

		try {
			await apiFetch(`/api/orders/${orderId}/proof`, {
				method: 'POST',
				body: form,
			});
			load();
		} catch (err: any) {
			setError(err.message);
		} finally {
			setUploading(false);
		}
	}

	if (loading) return <div class="h-64 rounded-2xl bg-green-50/40 animate-pulse" />;
	if (!data) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				{error || 'Commande introuvable'}
			</div>
		);
	}

	const { order, items, payment, tickets } = data;

	return (
		<div class="space-y-6">
			<div class="rounded-2xl border border-green-100 bg-white p-6 sm:p-8">
				<div class="flex flex-wrap items-center justify-between gap-4">
					<div>
						<p class="text-xs font-semibold uppercase tracking-wide text-green-600">
							Commande {order.reference}
						</p>
						<h1 class="mt-1 text-2xl font-bold text-slate-900">
							{formatXof(order.total_amount_xof)}
						</h1>
						<p class="mt-1 text-xs text-slate-500">Créée le {formatDate(order.created_at)}</p>
					</div>

					{order.status === 'pending_payment' && (
						<div class="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800">
							<Clock class="h-4 w-4" />
							<span>Expire dans : {remainingText}</span>
						</div>
					)}

					{order.status === 'under_review' && (
						<div class="inline-flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2 text-sm font-semibold text-green-700">
							<Clock class="h-4 w-4" />
							<span>Justificatif en cours de vérification</span>
						</div>
					)}

					{order.status === 'confirmed' && (
						<div class="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white">
							<CheckCircle2 class="h-4 w-4" />
							<span>Paiement confirmé</span>
						</div>
					)}
				</div>

				{order.status === 'rejected' && payment?.rejection_reason && (
					<div class="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
						<AlertCircle class="h-5 w-5 shrink-0 mt-0.5" />
						<div>
							<p class="font-semibold">Paiement rejeté</p>
							<p>{payment.rejection_reason}</p>
						</div>
					</div>
				)}
			</div>

			{order.status === 'pending_payment' && (
				<div class="rounded-2xl border border-green-200 bg-green-50/50 p-6 sm:p-8 space-y-6">
					<div>
						<h2 class="text-lg font-bold text-slate-900">Régler avec Wave &amp; envoyer le justificatif</h2>
						<p class="mt-1 text-sm text-slate-600">
							1. Effectuez votre paiement Wave de <strong>{formatXof(order.total_amount_xof)}</strong>.<br />
							2. Prenez une capture d’écran de la confirmation Wave et importez-la ci-dessous.
						</p>
					</div>

					<form onSubmit={handleUpload} class="space-y-4">
						<div>
							<label class="block text-sm font-medium text-slate-700 mb-1">
								Numéro Wave utilisé
							</label>
							<input
								type="tel"
								value={payerPhone}
								onInput={(e) => setPayerPhone((e.target as HTMLInputElement).value)}
								placeholder="+225 07 00 00 00 00"
								class="w-full max-w-sm rounded-xl border border-green-200 bg-white px-3.5 py-2.5 text-sm focus:border-green-600 focus:outline-none"
							/>
						</div>

						<div>
							<label class="block text-sm font-medium text-slate-700 mb-1">
								Capture d’écran Wave (JPEG, PNG, WebP — max 5 Mo)
							</label>
							<input
								type="file"
								required
								accept="image/jpeg,image/png,image/webp"
								onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] || null)}
								class="block w-full max-w-sm text-sm text-slate-600 file:mr-4 file:rounded-xl file:border-0 file:bg-green-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-green-700 cursor-pointer"
							/>
						</div>

						{error && (
							<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
								{error}
							</div>
						)}

						<button
							type="submit"
							disabled={!file || uploading}
							class="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 cursor-pointer"
						>
							<Upload class="h-4 w-4" />
							{uploading ? 'Envoi en cours...' : 'Envoyer le justificatif'}
						</button>
					</form>
				</div>
			)}

			{order.status === 'confirmed' && (
				<div class="rounded-2xl border border-green-200 bg-green-50 p-6 flex items-center justify-between gap-4">
					<div>
						<h3 class="font-bold text-green-900">Vos billets sont prêts !</h3>
						<p class="text-sm text-green-800">
							{tickets.length} ticket(s) valide(s) avec QR code disponible(s).
						</p>
					</div>
					<a
						href="/tickets"
						class="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700"
					>
						<span>Voir mes billets</span>
						<ExternalLink class="h-4 w-4" />
					</a>
				</div>
			)}

			<div class="rounded-2xl border border-green-100 bg-white p-6">
				<h3 class="font-bold text-slate-900 mb-3">Détail des articles ({items.length})</h3>
				<div class="divide-y divide-green-50 text-sm">
					{items.map((item) => (
						<div key={item.id} class="py-2.5 flex justify-between">
							<span class="text-slate-700">
								{item.item_type === 'convoy' ? 'Place(s) de convoi' : 'Ticket(s) événement'} ×{' '}
								{item.quantity}
							</span>
							<span class="font-semibold text-slate-900">{formatXof(item.subtotal_xof)}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
