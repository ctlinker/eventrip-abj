import { useEffect, useState } from 'preact/hooks';
import { Bus, Ticket, ShoppingBag, LogIn, LogOut, ShieldCheck, Compass, Heart } from 'lucide-preact';
import { apiFetch, type ApiUser } from '../lib/api';
import { disableWebPush, disconnectRealtime } from '../lib/realtime';
import NotificationBell from './NotificationBell';

interface Props {
	initialUser?: ApiUser | null;
	ssrResolved?: boolean;
	currentPath?: string;
}

export default function Navbar({ initialUser = null, ssrResolved = false, currentPath = '/' }: Props) {
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
		await disableWebPush(false);
		disconnectRealtime();
		await apiFetch('/api/auth/sign-out', { method: 'POST', body: '{}' }).catch(() => {});
		window.location.href = '/';
	}

	const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin');

	function navLinkCls(matchPrefix: string, exact = false) {
		const active = exact ? currentPath === matchPrefix : currentPath.startsWith(matchPrefix);
		return `inline-flex min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 items-center justify-center gap-1.5 rounded-lg p-2.5 sm:px-3 sm:py-1.5 text-sm font-semibold transition-colors ${
			active
				? 'text-emerald-600 bg-emerald-50/70'
				: 'text-slate-600 hover:text-slate-950 hover:bg-slate-100/70'
		}`;
	}

	return (
		<header class="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
			<div class="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3.5 sm:px-6">
				<a href="/" class="flex items-center gap-2.5 shrink-0 group">
					<span class="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs group-hover:bg-emerald-700 transition-colors">
						<Bus class="h-5 w-5" />
					</span>
					<span class="whitespace-nowrap text-lg sm:text-xl font-black tracking-tight text-slate-950">
						EVENTRIP<span class="text-emerald-500">.</span>
					</span>
				</a>

				<nav class="flex items-center gap-1 sm:gap-2">
					<a href="/" title="Explorer" aria-label="Explorer" class={navLinkCls('/', true)}>
						<Compass class="h-4 w-4 sm:hidden" />
						<span class="hidden sm:inline">Explorer</span>
					</a>

					{user && (
						<>
							<a href="/wishlist" title="Mes favoris" aria-label="Mes favoris" class={navLinkCls('/wishlist')}>
								<Heart class="h-4 w-4 sm:hidden" />
								<span class="hidden sm:inline">Favoris</span>
							</a>
							<a href="/orders" title="Mes commandes" aria-label="Mes commandes" class={navLinkCls('/orders')}>
								<ShoppingBag class="h-4 w-4 sm:hidden" />
								<span class="hidden sm:inline">Commandes</span>
							</a>
							<a href="/tickets" title="Mes billets" aria-label="Mes billets" class={navLinkCls('/tickets')}>
								<Ticket class="h-4 w-4 sm:hidden" />
								<span class="hidden sm:inline">Mes billets</span>
							</a>
							<NotificationBell />
						</>
					)}

					{isAdmin && (
						<a
							href="/admin"
							title="Administration"
							aria-label="Administration"
							class={`inline-flex min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 items-center justify-center gap-1.5 rounded-lg p-2.5 sm:px-3 sm:py-1.5 text-sm font-semibold border transition-colors ${
								currentPath.startsWith('/admin')
									? 'bg-emerald-600 text-white border-emerald-600'
									: 'bg-slate-50 text-slate-800 border-slate-200 hover:border-emerald-300 hover:text-emerald-700'
							}`}
						>
							<ShieldCheck class="h-4 w-4" />
							<span class="hidden sm:inline">Admin</span>
						</a>
					)}

					{loaded && !user && (
						<a
							href="/auth"
							class="ml-1 inline-flex min-h-11 sm:min-h-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 sm:px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 transition-colors shadow-xs"
						>
							<LogIn class="h-4 w-4 sm:hidden" />
							<span>Connexion</span>
						</a>
					)}

					{user && (
						<div class="ml-1 flex items-center gap-2">
							<span class="hidden lg:inline text-xs font-semibold text-slate-500">
								{user.name.split(' ')[0]}
							</span>
							<button
								type="button"
								onClick={handleLogout}
								title="Se déconnecter"
								aria-label="Se déconnecter"
								class="inline-flex min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white p-2.5 sm:px-3 sm:py-1.5 text-sm font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors cursor-pointer"
							>
								<LogOut class="h-4 w-4" />
								<span class="hidden md:inline">Déconnexion</span>
							</button>
						</div>
					)}
				</nav>
			</div>
		</header>
	);
}
