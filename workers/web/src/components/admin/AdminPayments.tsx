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

export default function AdminPayments() {
	const [payments, setPayments] = useState<AdminPayment[]>([]);
	const [filter, setFilter] = useState<'pending' | 'confirmed' | 'rejected' | ''>('pending');
	const [waveRefs, setWaveRefs] = useState<Record<string, string>>({});
	const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
	const [previewId, setPreviewId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	function load(status = filter) {
		setLoading(true);
		const qs = status ? `?status=${status}` : '';
		apiFetch<{ payments: AdminPayment[] }>(`/api/admin/payments${qs}`)
			.then((res) => {
				setPayments(res.payments);
				setWaveRefs((prev) => {
					const next = { ...prev };
					for (const p of res.payments) {
						if (p.wave_transaction_ref && !next[p.id]) {
							next[p.id] = p.wave_transaction_ref;
						}
					}
					return next;
				});
			})
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}

	useEffect(() => {
		load(filter);
	}, [filter]);

	async function handleConfirm(id: string) {
		setError(null);
		const ref = waveRefs[id]?.trim();
		if (!ref) {
			setError('Veuillez saisir la référence de transaction Wave.');
			return;
		}
		try {
			await apiFetch(`/api/admin/payments/${id}/confirm`, {
				method: 'POST',
				body: JSON.stringify({ wave_transaction_ref: ref }),
			});
			load(filter);
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
			load(filter);
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
						class={`rounded-xl px-3.5 py-1.5 text-sm font-semibold border cursor-pointer ${
							filter === opt.value
								? 'bg-green-600 text-white border-green-600'
								: 'bg-white text-slate-700 border-green-200 hover:bg-green-50'
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
				<div class="h-48 rounded-2xl bg-green-50/40 animate-pulse" />
			) : payments.length === 0 ? (
				<div class="rounded-2xl border border-green-100 bg-green-50/30 p-8 text-center text-sm text-slate-600">
					Aucun paiement dans cette catégorie.
				</div>
			) : (
				<div class="space-y-4">
					{payments.map((p) => (
						<div key={p.id} class="rounded-2xl border border-green-100 bg-white p-5 space-y-4">
							<div class="flex flex-wrap items-start justify-between gap-4">
								<div>
									<div class="flex items-center gap-2.5">
										<span class="font-bold text-slate-900">{p.order_reference}</span>
										<span class="rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-semibold text-green-700">
											{p.order_status}
										</span>
									</div>
									<p class="mt-1 text-sm text-slate-700">
										{p.client_name} · {p.payer_phone || p.client_phone || p.client_email}
									</p>
									<p class="text-xs text-slate-500">
										Créée le {formatDate(p.created_at)}
										{p.submitted_at ? ` · Justificatif envoyé le ${formatDate(p.submitted_at)}` : ''}
									</p>
									{p.wave_transaction_ref && p.status === 'pending' && (
										<p class="mt-1 text-xs font-semibold text-green-700">
											ID Wave déclaré par le client : <span class="font-mono">{p.wave_transaction_ref}</span>
										</p>
									)}
								</div>

								<div class="text-right">
									<p class="text-lg font-bold text-green-700">{formatXof(p.expected_amount_xof)}</p>
									{p.proof_image_key && (
										<button
											type="button"
											onClick={() => setPreviewId(previewId === p.id ? null : p.id)}
											class="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline cursor-pointer"
										>
											<Eye class="h-3.5 w-3.5" />
											{previewId === p.id ? 'Masquer justificatif' : 'Voir justificatif'}
										</button>
									)}
								</div>
							</div>

							{previewId === p.id && p.proof_image_key && (
								<div class="rounded-xl border border-green-100 bg-green-50/40 p-3">
									<img
										src={`${API_BASE}/api/admin/payments/${p.id}/proof`}
										alt="Justificatif Wave"
										class="max-h-96 rounded-lg mx-auto"
									/>
								</div>
							)}

							{p.status === 'pending' && (
								<div class="grid gap-3 sm:grid-cols-2 pt-3 border-t border-green-50">
									<div class="flex gap-2">
										<input
											type="text"
											placeholder="Réf. transaction Wave"
											value={waveRefs[p.id] || ''}
											onInput={(e) =>
												setWaveRefs({ ...waveRefs, [p.id]: (e.target as HTMLInputElement).value })
											}
											class="flex-1 rounded-xl border border-green-200 px-3 py-2 text-sm focus:border-green-600 focus:outline-none"
										/>
										<button
											type="button"
											onClick={() => handleConfirm(p.id)}
											class="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 cursor-pointer"
										>
											<Check class="h-4 w-4" />
											Confirmer
										</button>
									</div>

									<div class="flex gap-2">
										<input
											type="text"
											placeholder="Motif du rejet"
											value={rejectReasons[p.id] || ''}
											onInput={(e) =>
												setRejectReasons({
													...rejectReasons,
													[p.id]: (e.target as HTMLInputElement).value,
												})
											}
											class="flex-1 rounded-xl border border-red-200 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
										/>
										<button
											type="button"
											onClick={() => handleReject(p.id)}
											class="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
										>
											<X class="h-4 w-4" />
											Rejeter
										</button>
									</div>
								</div>
							)}

							{p.status === 'confirmed' && p.wave_transaction_ref && (
								<p class="text-xs font-medium text-green-700">
									Réf. Wave validée : <span class="font-mono">{p.wave_transaction_ref}</span>
								</p>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
