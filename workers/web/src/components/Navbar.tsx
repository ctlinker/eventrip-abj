import { useEffect, useState } from 'preact/hooks';
import { Ticket, Calendar, ShoppingBag, LogIn, LogOut, ShieldCheck } from 'lucide-preact';
import { apiFetch, type ApiUser } from '../lib/api';

interface Props {
	initialUser?: ApiUser | null;
	ssrResolved?: boolean;
}

export default function Navbar({ initialUser = null, ssrResolved = false }: Props) {
	const [user, setUser] = useState<ApiUser | null>(initialUser);
	const [loaded, setLoaded] = useState(ssrResolved);

	useEffect(() => {
		if (ssrResolved) return;
		apiFetch<{ user?: ApiUser } | null>('/api/auth/get-session')
			.then((res) => setUser(res?.user ?? null))
			.catch(() => setUser(null))
			.finally(() => setLoaded(true));
	}, [ssrResolved]);

	async function handleLogout() {
		await apiFetch('/api/auth/sign-out', { method: 'POST', body: '{}' }).catch(() => {});
		window.location.href = '/';
	}

	const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin');

	return (
		<header class="sticky top-0 z-40 border-b border-green-100 bg-white/95 backdrop-blur">
			<div class="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3.5 sm:px-6">
				<a href="/" class="flex items-center gap-2 shrink-0">
					<span class="flex h-9 w-9 items-center justify-center rounded-xl bg-green-600 text-white shadow-sm">
						<Ticket class="h-5 w-5" />
					</span>
					<span class="whitespace-nowrap text-base sm:text-lg font-bold tracking-tight text-slate-900">
						EVENTRIP<span class="text-green-600">-ABJ</span>
					</span>
				</a>

				<nav class="flex items-center gap-1.5 sm:gap-4 text-sm font-medium text-slate-600">
					<a href="/" title="Événements" aria-label="Événements" class="inline-flex items-center gap-1.5 rounded-lg p-2 sm:px-2.5 sm:py-1.5 hover:bg-green-50 hover:text-green-700 transition-colors">
						<Calendar class="h-4 w-4" />
						<span class="hidden sm:inline">Événements</span>
					</a>

					{user && (
						<>
							<a href="/orders" title="Commandes" aria-label="Commandes" class="inline-flex items-center gap-1.5 rounded-lg p-2 sm:px-2.5 sm:py-1.5 hover:bg-green-50 hover:text-green-700 transition-colors">
								<ShoppingBag class="h-4 w-4" />
								<span class="hidden sm:inline">Commandes</span>
							</a>
							<a href="/tickets" title="Mes billets" aria-label="Mes billets" class="inline-flex items-center gap-1.5 rounded-lg p-2 sm:px-2.5 sm:py-1.5 hover:bg-green-50 hover:text-green-700 transition-colors">
								<Ticket class="h-4 w-4" />
								<span class="hidden sm:inline">Mes billets</span>
							</a>
						</>
					)}

					{isAdmin && (
						<a
							href="/admin"
							title="Administration"
							aria-label="Administration"
							class="inline-flex items-center gap-1.5 rounded-lg bg-green-50 p-2 sm:px-3 sm:py-1.5 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
						>
							<ShieldCheck class="h-4 w-4" />
							<span class="hidden sm:inline">Admin</span>
						</a>
					)}

					{loaded && !user && (
						<a
							href="/auth"
							class="inline-flex items-center gap-1.5 rounded-xl bg-green-600 px-4 py-2 text-white font-semibold hover:bg-green-700 transition-colors shadow-sm"
						>
							<LogIn class="h-4 w-4" />
							<span>Connexion</span>
						</a>
					)}

					{user && (
						<button
							type="button"
							onClick={handleLogout}
							title="Se déconnecter"
							class="inline-flex items-center gap-1.5 rounded-xl border border-green-200 bg-white px-3 py-1.5 text-slate-700 hover:bg-green-50 hover:text-green-800 transition-colors cursor-pointer"
						>
							<LogOut class="h-4 w-4" />
							<span class="hidden md:inline">{user.name.split(' ')[0]}</span>
						</button>
					)}
				</nav>
			</div>
		</header>
	);
}
