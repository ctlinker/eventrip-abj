interface Props {
	active: 'dashboard' | 'payments' | 'events' | 'scanner' | 'users';
}

const LINKS = [
	{ id: 'dashboard', href: '/admin', label: 'Tableau de bord' },
	{ id: 'payments', href: '/admin/payments', label: 'Paiements Wave' },
	{ id: 'events', href: '/admin/events', label: 'Événements & Convois' },
	{ id: 'scanner', href: '/admin/scanner', label: 'Scanner QR' },
	{ id: 'users', href: '/admin/users', label: 'Utilisateurs & Audit' },
] as const;

export default function AdminNav({ active }: Props) {
	return (
		<div class="mb-8 flex flex-wrap gap-2 border-b border-green-100 pb-4">
			{LINKS.map((link) => (
				<a
					key={link.id}
					href={link.href}
					class={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
						active === link.id
							? 'bg-green-600 text-white shadow-xs'
							: 'bg-green-50/70 text-slate-700 hover:bg-green-100 hover:text-green-800'
					}`}
				>
					{link.label}
				</a>
			))}
		</div>
	);
}
