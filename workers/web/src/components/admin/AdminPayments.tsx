import { useEffect, useState } from 'preact/hooks';
import { Check, X, Eye } from 'lucide-preact';
import { API_BASE, apiFetch, formatDate, formatXof } from '../../lib/api';

interface AdminPayment {
	id: string;
	order_id: string;
	order_reference: string;
	order_status: string;
	client_name: string;
	client_email: string;
	client_phone: string | null;
	payer_phone: string | null;
	expected_amount_xof: number;
	proof_image_key: string | null;
	wave_transaction_ref: string | null;
	status: 'pending' | 'confirmed' | 'rejected';
	rejection_reason: string | null;
	submitted_at: string | null;
	created_at: string;
}

const ORDER_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
	pending_payment: { label: 'Attente preuve', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
	under_review: { label: 'Preuve reçue', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
	confirmed: { label: 'Confirmée', cls: 'bg-emerald-600 text-white border-emerald-600' },
	rejected: { label: 'Rejetée', cls: 'bg-red-50 text-red-700 border-red-200' },
	expired: { label: 'Expirée', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
	cancelled: { label: 'Annulée', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export default function AdminPayments() {
	const [payments, setPayments] = useState<AdminPayment[]>([]);
	const [filter, setFilter] = useState<'pending' | 'confirmed' | 'rejected' | ''>('pending');
	const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
	const [previewId, setPreviewId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	function load(status = filter) {
		setLoading(true);
		const qs = status ? `?status=${status}` : '';
		apiFetch<{ payments: AdminPayment[] }>(`/api/admin/payments${qs}`)
			.then((res) => setPayments(res.payments))
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}

	useEffect(() => {
		load(filter);
	}, [filter]);

	async function handleConfirm(id: string) {
		setError(null);
		try {
			await apiFetch(`/api/admin/payments/${id}/confirm`, {
				method: 'POST',
				body: JSON.stringify({}),
			});
			setPayments((prev) =>
				filter === 'pending'
					? prev.filter((p) => p.id !== id)
					: prev.map((p) =>
							p.id === id ? { ...p, status: 'confirmed', order_status: 'confirmed' } : p,
						),
			);
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function handleReject(id: string) {
		setError(null);
		const reason = rejectReasons[id]?.trim();
		if (!reason) {
			setError('Veuillez saisir le motif de rejet.');
			return;
		}
		try {
			await apiFetch(`/api/admin/payments/${id}/reject`, {
				method: 'POST',
				body: JSON.stringify({ rejection_reason: reason }),
			});
			setPayments((prev) =>
				filter === 'pending'
					? prev.filter((p) => p.id !== id)
					: prev.map((p) =>
							p.id === id
								? { ...p, status: 'rejected', order_status: 'rejected', rejection_reason: reason }
								: p,
						),
			);
		} catch (err: any) {
			setError(err.message);
		}
	}

	return (
		<div class="space-y-6">
			<div class="flex flex-wrap gap-2">
				{[
					{ value: 'pending', label: 'En attente' },
					{ value: 'confirmed', label: 'Confirmés' },
					{ value: 'rejected', label: 'Rejetés' },
					{ value: '', label: 'Tous' },
				].map((opt) => (
					<button
						key={opt.label}
						type="button"
						onClick={() => setFilter(opt.value as any)}
						class={`rounded-xl px-3.5 py-1.5 text-sm font-bold border transition-colors cursor-pointer ${
							filter === opt.value
								? 'bg-slate-900 text-white border-slate-900'
								: 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-950'
						}`}
					>
						{opt.label}
					</button>
				))}
			</div>

			{error && (
				<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
			)}

			{loading ? (
				<div class="h-48 rounded-2xl border border-slate-200 bg-slate-50 animate-pulse" />
			) : payments.length === 0 ? (
				<div class="rounded-2xl border border-slate-200 bg-slate-50/60 p-8 text-center text-sm text-slate-600">
					Aucun paiement dans cette catégorie.
				</div>
			) : (
				<div class="space-y-4">
					{payments.map((p) => {
						const badge = ORDER_STATUS_BADGE[p.order_status] || {
							label: p.order_status,
							cls: 'bg-slate-100 text-slate-700 border-slate-200',
						};
						return (
							<div
								key={p.id}
								class="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4"
							>
								<div class="flex flex-wrap items-start justify-between gap-4">
									<div>
										<div class="flex flex-wrap items-center gap-2.5">
											<span class="font-mono text-sm font-bold text-slate-950">
												{p.order_reference}
											</span>
											<span
												class={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${badge.cls}`}
											>
												{badge.label}
											</span>
										</div>
										<p class="mt-1 text-sm font-medium text-slate-700">
											{p.client_name} • {p.payer_phone || p.client_phone || p.client_email}
										</p>
										<p class="text-xs text-slate-500">
											Créée le {formatDate(p.created_at)}
											{p.submitted_at
												? ` • Preuve envoyée le ${formatDate(p.submitted_at)}`
												: ''}
										</p>
										{p.wave_transaction_ref && p.status === 'pending' && (
											<p class="mt-1.5 inline-block rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-800">
												ID Wave client :{' '}
												<span class="font-mono">{p.wave_transaction_ref}</span>
											</p>
										)}
									</div>

									<div class="text-right">
										<p class="text-lg font-black text-slate-950">
											{formatXof(p.expected_amount_xof)}
										</p>
										{p.proof_image_key && (
											<button
												type="button"
												onClick={() => setPreviewId(previewId === p.id ? null : p.id)}
												class="mt-1 inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
											>
												<Eye class="h-3.5 w-3.5" />
												{previewId === p.id ? 'Masquer capture' : 'Voir capture'}
											</button>
										)}
									</div>
								</div>

								{previewId === p.id && p.proof_image_key && (
									<div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
										<img
											src={`${API_BASE}/api/admin/payments/${p.id}/proof`}
											alt="Justificatif Wave"
											class="max-h-96 rounded-lg mx-auto"
										/>
									</div>
								)}

								{p.status === 'pending' && (
									<div class="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
										<button
											type="button"
											onClick={() => handleConfirm(p.id)}
											class="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 cursor-pointer shadow-xs"
										>
											<Check class="h-4 w-4" />
											Valider le paiement
										</button>

										<div class="flex flex-1 min-w-[240px] max-w-md gap-2">
											<input
												type="text"
												name={`reject_${p.id}`}
												aria-label="Motif du rejet"
												placeholder="Motif du rejet..."
												value={rejectReasons[p.id] || ''}
												onInput={(e) =>
													setRejectReasons({
														...rejectReasons,
														[p.id]: (e.target as HTMLInputElement).value,
													})
												}
												class="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
											/>
											<button
												type="button"
												onClick={() => handleReject(p.id)}
												class="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-100 cursor-pointer"
											>
												<X class="h-4 w-4" />
												Rejeter
											</button>
										</div>
									</div>
								)}

								{p.status === 'confirmed' && p.wave_transaction_ref && (
									<p class="text-xs font-semibold text-emerald-700">
										Réf. Wave validée : <span class="font-mono">{p.wave_transaction_ref}</span>
									</p>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
