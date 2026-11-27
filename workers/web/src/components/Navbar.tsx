import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import {
	Ticket,
	ShoppingBag,
	LogIn,
	LogOut,
	ShieldCheck,
	Compass,
	Heart,
	Menu,
	X,
	MessageCircle,
	KeyRound,
} from 'lucide-preact';
import { apiFetch, type ApiUser } from '../lib/api';
import { disableWebPush, disconnectRealtime, subscribeRealtime } from '../lib/realtime';
import NotificationBell from './NotificationBell';

interface Props {
	initialUser?: ApiUser | null;
	ssrResolved?: boolean;
	currentPath?: string;
	contactNum?: string;
}

interface OrderBadgeRow {
	status: string;
	expires_at: string;
}

export default function Navbar({
	initialUser = null,
	ssrResolved = false,
	currentPath = '/',
	contactNum = '+2250545990099',
}: Props) {
	const [user, setUser] = useState<ApiUser | null>(initialUser);
	const [loaded, setLoaded] = useState(ssrResolved);
	const [pendingProofCount, setPendingProofCount] = useState(0);
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const headerRef = useRef<HTMLElement>(null);

	const whatsappDigits = contactNum.replace(/\D/g, '');
	const whatsappHref = `https://wa.me/${whatsappDigits}`;

	useEffect(() => {
		if (ssrResolved) return;
		apiFetch<{ user?: ApiUser } | null>('/api/auth/get-session')
			.then((res) => setUser(res?.user ?? null))
			.catch(() => setUser(null))
			.finally(() => setLoaded(true));
	}, [ssrResolved]);

	const loadPendingProofCount = useCallback(() => {
		if (!user) {
			setPendingProofCount(0);
			return;
		}
		apiFetch<{ orders: OrderBadgeRow[] }>('/api/orders')
			.then((res) => {
				const now = Date.now();
				const count = (res.orders || []).filter(
					(o) => o.status === 'pending_payment' && new Date(o.expires_at).getTime() > now,
				).length;
				setPendingProofCount(count);
			})
			.catch(() => {});
	}, [user]);

	useEffect(() => {
		if (!user) {
			setPendingProofCount(0);
			return;
		}

		loadPendingProofCount();

		const unsub = subscribeRealtime((ev) => {
			if (
				ev.type === 'order_created' ||
				ev.type === 'proof_submitted' ||
				ev.type === 'order_expired' ||
				ev.type === 'payment_confirmed' ||
				ev.type === 'payment_rejected'
			) {
				loadPendingProofCount();
			}
		});

		const onVisibility = () => {
			if (document.visibilityState === 'visible') {
				loadPendingProofCount();
			}
		};
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			unsub();
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}, [user, loadPendingProofCount]);

	useEffect(() => {
		if (!mobileMenuOpen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setMobileMenuOpen(false);
		};
		const onOutsideClick = (e: MouseEvent) => {
			if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
				setMobileMenuOpen(false);
			}
		};
		document.addEventListener('keydown', onKey);
		document.addEventListener('mousedown', onOutsideClick);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('mousedown', onOutsideClick);
		};
	}, [mobileMenuOpen]);

	async function handleLogout() {
		setMobileMenuOpen(false);
		await disableWebPush(false);
		disconnectRealtime();
		await apiFetch('/api/auth/sign-out', { method: 'POST', body: '{}' }).catch(() => {});
		window.location.href = '/';
	}

	const isAdmin = user && (user.role === 'admin' || user.role === 'super_admin');

	function navLinkCls(matchPrefix: string, exact = false) {
		const active = exact ? currentPath === matchPrefix : currentPath.startsWith(matchPrefix);
		return `inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
			active
				? 'text-brand-700 bg-brand-50'
				: 'text-slate-600 hover:text-navy-950 hover:bg-slate-100/70'
		}`;
	}

	function mobileLinkCls(matchPrefix: string, exact = false) {
		const active = exact ? currentPath === matchPrefix : currentPath.startsWith(matchPrefix);
		return `flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
			active
				? 'text-brand-700 bg-brand-50'
				: 'text-slate-700 hover:text-navy-950 hover:bg-slate-100/80'
		}`;
	}

	return (
		<header ref={headerRef} class="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
			<div class="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
				<a href="/" class="flex items-center gap-2.5 shrink-0 group">
					<img
						src="/logo.png"
						alt="ABJ-TRIPEVENT"
						width="40"
						height="40"
						class="h-10 w-10 rounded-full object-contain drop-shadow-xs transition-transform group-hover:scale-105"
					/>
					<span class="whitespace-nowrap text-lg sm:text-xl font-black tracking-tight text-navy-950">
						EVENTRIP<span class="text-brand-500">.</span>
					</span>
				</a>

				{/* Navigation Desktop */}
				<nav class="hidden md:flex items-center gap-1.5">
					<a href="/" class={navLinkCls('/', true)}>
						<span>Explorer</span>
					</a>

					{user && (
						<>
							<a href="/wishlist" class={navLinkCls('/wishlist')}>
								<span>Favoris</span>
							</a>
							<a
								href="/orders"
								title={
									pendingProofCount > 0
										? `Mes commandes (${pendingProofCount} preuve(s) à fournir)`
										: 'Mes commandes'
								}
								aria-label={
									pendingProofCount > 0
										? `Mes commandes, ${pendingProofCount} preuve à fournir`
										: 'Mes commandes'
								}
								class={navLinkCls('/orders')}
							>
								<span>Commandes</span>
								{pendingProofCount > 0 && (
									<span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-extrabold leading-none text-white shadow-xs">
										{pendingProofCount > 99 ? '99+' : pendingProofCount}
									</span>
								)}
							</a>
							<a href="/tickets" class={navLinkCls('/tickets')}>
								<span>Mes billets</span>
							</a>
						</>
					)}

					<a
						href={whatsappHref}
						target="_blank"
						rel="noopener noreferrer"
						title={`Nous contacter sur WhatsApp (${contactNum})`}
						class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:text-emerald-700 hover:bg-emerald-50/70 transition-colors"
					>
						<MessageCircle class="h-4 w-4 text-emerald-600" />
						<span>Nous contacter</span>
					</a>

					{user && <NotificationBell />}

					{isAdmin && (
						<a
							href="/admin"
							title="Administration"
							aria-label="Administration"
							class={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold border transition-colors ${
								currentPath.startsWith('/admin')
									? 'bg-navy-950 text-brand-300 border-navy-950'
									: 'bg-slate-50 text-navy-900 border-slate-200 hover:border-brand-300 hover:text-brand-700'
							}`}
						>
							<ShieldCheck class="h-4 w-4" />
							<span>Admin</span>
						</a>
					)}

					{loaded && !user && (
						<a
							href="/auth"
							class="ml-1 inline-flex items-center gap-1.5 rounded-xl bg-navy-950 px-4 py-2 text-sm font-bold text-brand-200 hover:bg-navy-800 hover:text-white transition-colors shadow-xs"
						>
							<span>Connexion</span>
						</a>
					)}

					{user && (
						<div class="ml-1 flex items-center gap-2">
							<span class="hidden lg:inline text-xs font-semibold text-slate-500">
								{user.name.split(' ')[0]}
							</span>
							<a
								href="/change-password"
								title="Changer mon mot de passe"
								aria-label="Changer mon mot de passe"
								class={`inline-flex items-center justify-center rounded-xl border p-2 text-sm font-semibold transition-colors ${
									currentPath === '/change-password'
										? 'border-brand-200 bg-brand-50 text-brand-700'
										: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-navy-950'
								}`}
							>
								<KeyRound class="h-4 w-4" />
							</a>
							<button
								type="button"
								onClick={handleLogout}
								title="Se déconnecter"
								aria-label="Se déconnecter"
								class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors cursor-pointer"
							>
								<LogOut class="h-4 w-4" />
								<span class="hidden lg:inline">Déconnexion</span>
							</button>
						</div>
					)}
				</nav>

				{/* Actions Mobile hors menu burger : Commandes (promu si preuve en attente) + Notifications + Burger */}
				<div class="flex md:hidden items-center gap-1">
					{user && pendingProofCount > 0 && (
						<a
							href="/orders"
							title={`Mes commandes (${pendingProofCount} preuve(s) à fournir)`}
							aria-label={`Mes commandes, ${pendingProofCount} preuve à fournir`}
							class={`relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2.5 transition-colors ${
								currentPath.startsWith('/orders')
									? 'text-brand-700 bg-brand-50'
									: 'text-slate-700 hover:text-navy-950 hover:bg-slate-100/70'
							}`}
						>
							<ShoppingBag class="h-4 w-4" />
							<span class="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-extrabold leading-none text-white shadow-xs">
								{pendingProofCount > 99 ? '99+' : pendingProofCount}
							</span>
						</a>
					)}

					{user && <NotificationBell />}

					<button
						type="button"
						onClick={() => setMobileMenuOpen((v) => !v)}
						aria-expanded={mobileMenuOpen}
						aria-controls="mobile-nav-drawer"
						aria-label={mobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
						class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 bg-white p-2.5 text-navy-950 hover:bg-slate-50 transition-colors cursor-pointer"
					>
						{mobileMenuOpen ? <X class="h-5 w-5" /> : <Menu class="h-5 w-5" />}
					</button>
				</div>
			</div>

			{/* Tiroir Menu Burger Mobile */}
			{mobileMenuOpen && (
				<nav
					id="mobile-nav-drawer"
					aria-label="Navigation mobile"
					class="md:hidden border-t border-slate-200/80 bg-white px-4 py-3 shadow-lg"
				>
					<div class="space-y-1">
						{user && (
							<div class="mb-2 flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-600">
								<span>Connecté en tant que <strong class="text-navy-950">{user.name}</strong></span>
							</div>
						)}

						<a href="/" onClick={() => setMobileMenuOpen(false)} class={mobileLinkCls('/', true)}>
							<span class="flex items-center gap-2.5">
								<Compass class="h-4 w-4 text-brand-600" />
								<span>Explorer</span>
							</span>
						</a>

						{user && (
							<>
								<a href="/wishlist" onClick={() => setMobileMenuOpen(false)} class={mobileLinkCls('/wishlist')}>
									<span class="flex items-center gap-2.5">
										<Heart class="h-4 w-4 text-brand-600" />
										<span>Favoris</span>
									</span>
								</a>
								<a href="/orders" onClick={() => setMobileMenuOpen(false)} class={mobileLinkCls('/orders')}>
									<span class="flex items-center gap-2.5">
										<ShoppingBag class="h-4 w-4 text-brand-600" />
										<span>Mes commandes</span>
									</span>
									{pendingProofCount > 0 && (
										<span class="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-extrabold text-white">
											{pendingProofCount > 99 ? '99+' : pendingProofCount}
										</span>
									)}
								</a>
								<a href="/tickets" onClick={() => setMobileMenuOpen(false)} class={mobileLinkCls('/tickets')}>
									<span class="flex items-center gap-2.5">
										<Ticket class="h-4 w-4 text-brand-600" />
										<span>Mes billets</span>
									</span>
								</a>
								<a href="/change-password" onClick={() => setMobileMenuOpen(false)} class={mobileLinkCls('/change-password', true)}>
									<span class="flex items-center gap-2.5">
										<KeyRound class="h-4 w-4 text-brand-600" />
										<span>Mot de passe</span>
									</span>
								</a>
							</>
						)}

						<a
							href={whatsappHref}
							target="_blank"
							rel="noopener noreferrer"
							onClick={() => setMobileMenuOpen(false)}
							class="flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50/80 transition-colors"
						>
							<span class="flex items-center gap-2.5">
								<MessageCircle class="h-4 w-4 text-emerald-600" />
								<span>Nous contacter (WhatsApp)</span>
							</span>
							<span class="text-xs font-mono text-slate-400">{contactNum}</span>
						</a>

						{isAdmin && (
							<a
								href="/admin"
								onClick={() => setMobileMenuOpen(false)}
								class={`flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-semibold border transition-colors ${
									currentPath.startsWith('/admin')
										? 'bg-navy-950 text-brand-300 border-navy-950'
										: 'bg-slate-50 text-navy-900 border-slate-200 hover:border-brand-300 hover:text-brand-700'
								}`}
							>
								<ShieldCheck class="h-4 w-4" />
								<span>Administration</span>
							</a>
						)}

						<div class="pt-2 mt-2 border-t border-slate-100">
							{loaded && !user && (
								<a
									href="/auth"
									onClick={() => setMobileMenuOpen(false)}
									class="flex w-full items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-brand-200 hover:bg-navy-800 hover:text-white transition-colors"
								>
									<LogIn class="h-4 w-4" />
									<span>Connexion</span>
								</a>
							)}
							{user && (
								<button
									type="button"
									onClick={handleLogout}
									class="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors cursor-pointer"
								>
									<LogOut class="h-4 w-4" />
									<span>Déconnexion</span>
								</button>
							)}
						</div>
					</div>
				</nav>
			)}
		</header>
	);
}
