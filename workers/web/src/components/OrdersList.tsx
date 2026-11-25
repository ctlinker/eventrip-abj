import { useEffect, useState } from 'preact/hooks';
import { ShoppingBag, ArrowRight } from 'lucide-preact';
import { apiFetch, formatDate, formatXof } from '../lib/api';

interface OrderSummary {
	id: string;
	reference: string;
	total_amount_xof: number;
	status: string;
	expires_at: string;
	created_at: string;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
	pending_payment: { label: 'En attente de paiement', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
	under_review: { label: 'Vérification en cours', cls: 'bg-green-50 text-green-700 border-green-200' },
	confirmed: { label: 'Confirmée', cls: 'bg-green-600 text-white border-green-600' },
	rejected: { label: 'Rejetée', cls: 'bg-red-50 text-red-700 border-red-200' },
	expired: { label: 'Expirée', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
	cancelled: { label: 'Annulée', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export default function OrdersList() {
	const [orders, setOrders] = useState<OrderSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		apiFetch<{ orders: OrderSummary[] }>('/api/orders')
			.then((res) => setOrders(res.orders))
			.catch((err) => setError(err.message))
			.finally(() => setLoading(false));
	}, []);

	if (loading) return <div class="h-48 rounded-2xl bg-green-50/40 animate-pulse" />;

	if (error) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				{error}
			</div>
		);
	}

	if (orders.length === 0) {
		return (
			<div class="rounded-2xl border border-green-100 bg-green-50/40 p-10 text-center">
				<ShoppingBag class="mx-auto h-10 w-10 text-green-600 mb-3" />
				<p class="font-semibold text-slate-900">Aucune commande pour le moment</p>
				<a
					href="/"
					class="mt-4 inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
				>
					Découvrir les événements
				</a>
			</div>
		);
	}

	return (
		<div class="space-y-4">
			{orders.map((order) => {
				const badge = STATUS_BADGE[order.status] || {
					label: order.status,
					cls: 'bg-slate-100 text-slate-700 border-slate-200',
				};
				return (
					<a
						key={order.id}
						href={`/orders/${order.id}`}
						class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-green-100 bg-white p-5 hover:border-green-300 transition-colors"
					>
						<div>
							<div class="flex items-center gap-3">
								<span class="font-bold text-slate-900">{order.reference}</span>
								<span class={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>
									{badge.label}
								</span>
							</div>
							<p class="mt-1 text-xs text-slate-500">Créée le {formatDate(order.created_at)}</p>
						</div>
						<div class="flex items-center gap-4">
							<span class="text-base font-bold text-green-700">
								{formatXof(order.total_amount_xof)}
							</span>
							<ArrowRight class="h-4 w-4 text-slate-400" />
						</div>
					</a>
				);
			})}
		</div>
	);
}
