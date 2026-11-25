import { useEffect, useState } from 'preact/hooks';
import { apiFetch, formatXof } from '../../lib/api';

interface Kpis {
	total_orders: number;
	pending_payments: number;
	confirmed_payments: number;
	confirmed_revenue_xof: number;
	total_tickets: number;
	valid_tickets: number;
	used_tickets: number;
	convoy_seats_sold: number;
}

export default function AdminDashboard() {
	const [kpis, setKpis] = useState<Kpis | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		apiFetch<{ kpis: Kpis }>('/api/admin/dashboard')
			.then((res) => setKpis(res.kpis))
			.catch((err) => setError(err.message));
	}, []);

	if (error) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				Accès refusé ou erreur : {error}
			</div>
		);
	}

	if (!kpis) {
		return (
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{[1, 2, 3, 4].map((n) => (
					<div key={n} class="h-28 rounded-2xl bg-green-50/50 animate-pulse" />
				))}
			</div>
		);
	}

	const cards = [
		{ label: 'Chiffre d’affaires confirmé', value: formatXof(kpis.confirmed_revenue_xof), highlight: true },
		{ label: 'Paiements en attente', value: String(kpis.pending_payments), highlight: kpis.pending_payments > 0 },
		{ label: 'Paiements confirmés', value: String(kpis.confirmed_payments) },
		{ label: 'Total commandes', value: String(kpis.total_orders) },
		{ label: 'Tickets générés', value: String(kpis.total_tickets) },
		{ label: 'Tickets valides', value: String(kpis.valid_tickets) },
		{ label: 'Tickets scannés (utilisés)', value: String(kpis.used_tickets) },
		{ label: 'Places convois vendues', value: String(kpis.convoy_seats_sold) },
	];

	return (
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{cards.map((card) => (
				<div
					key={card.label}
					class={`rounded-2xl border p-5 ${
						card.highlight
							? 'border-green-300 bg-green-50/70'
							: 'border-green-100 bg-white'
					}`}
				>
					<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
					<p class="mt-2 text-2xl font-bold text-slate-900">{card.value}</p>
				</div>
			))}
		</div>
	);
}
