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
	event_title?: string | null;
	event_slug?: string | null;
	convoy_commune?: string | null;
	ticket_count?: number;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
	pending_payment: { label: 'En attente de paiement', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
	under_review: { label: 'Vérification en cours', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
	confirmed: { label: 'Confirmée', cls: 'bg-emerald-600 text-white border-emerald-600' },
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

	if (loading) return <div class="h-48 rounded-2xl bg-slate-50 border border-slate-200 animate-pulse" />;

	if (error) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				{error}
			</div>
		);
	}

	if (orders.length === 0) {
		return (
			<div class="rounded-2xl border border-slate-200 bg-slate-50/60 p-10 text-center">
				<ShoppingBag class="mx-auto h-10 w-10 text-emerald-600 mb-3" />
				<p class="font-bold text-slate-950">Aucune commande pour le moment</p>
				<a
					href="/"
					class="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
				>
					Explorer les événements
				</a>
			</div>
		);
	}

	return (
		<div class="space-y-3">
			{orders.map((order) => {
				const badge = STATUS_BADGE[order.status] || {
					label: order.status,
					cls: 'bg-slate-100 text-slate-700 border-slate-200',
				};
				return (
					<a
						key={order.id}
						href={`/orders/${order.id}`}
						class="group flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:shadow-xs transition-all"
					>
						<div class="min-w-0">
							{order.event_title && (
								<p class="font-bold text-slate-950 truncate">{order.event_title}</p>
							)}
							<div class="mt-0.5 flex flex-wrap items-center gap-2.5">
								<span class="font-mono text-xs sm:text-sm font-bold text-slate-800">{order.reference}</span>
								<span class={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${badge.cls}`}>
									{badge.label}
								</span>
							</div>
							<p class="mt-1 text-xs text-slate-500">
								{order.convoy_commune ? `Départ ${order.convoy_commune} • ` : ''}
								{order.ticket_count ? `${order.ticket_count} billet(s) • ` : ''}
								Créée le {formatDate(order.created_at)}
							</p>
						</div>
						<div class="flex items-center gap-4">
							<span class="text-base font-black text-slate-950">
								{formatXof(order.total_amount_xof)}
							</span>
							<ArrowRight class="h-4 w-4 text-slate-400 group-hover:text-emerald-600 transition-colors" />
						</div>
					</a>
				);
			})}
		</div>
	);
}
