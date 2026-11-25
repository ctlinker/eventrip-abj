interface Props {
	active: 'dashboard' | 'payments' | 'events' | 'scanner' | 'users';
}

const LINKS = [
	{ id: 'dashboard', href: '/admin', label: 'Tableau de bord' },
	{ id: 'payments', href: '/admin/payments', label: 'Paiements Wave' },
	{ id: 'events', href: '/admin/events', label: 'Événements & Départs' },
	{ id: 'scanner', href: '/admin/scanner', label: 'Scanner QR' },
	{ id: 'users', href: '/admin/users', label: 'Utilisateurs & Audit' },
] as const;

export default function AdminNav({ active }: Props) {
	return (
		<div class="mb-8 flex flex-wrap gap-2 border-b border-slate-200 pb-4">
			{LINKS.map((link) => (
				<a
					key={link.id}
					href={link.href}
					class={`rounded-xl px-4 py-2 text-sm font-bold transition-colors ${
						active === link.id
							? 'bg-emerald-600 text-white shadow-xs'
							: 'bg-slate-100/80 text-slate-700 hover:bg-slate-200/70 hover:text-slate-950'
					}`}
				>
					{link.label}
				</a>
			))}
		</div>
	);
}
