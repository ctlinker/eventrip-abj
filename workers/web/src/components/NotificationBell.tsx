import { useEffect, useRef, useState } from 'preact/hooks';
import { Bell, BellRing, CheckCheck, X } from 'lucide-preact';
import { apiFetch, formatDate } from '../lib/api';
import {
	disableWebPush,
	enableWebPush,
	getActivePushSubscription,
	isIosStandaloneRequired,
	isWebPushSupported,
	onPushSubscriptionChange,
	subscribeRealtime,
} from '../lib/realtime';

interface NotificationItem {
	id: string;
	type: string;
	title: string;
	body: string;
	link: string | null;
	is_read: number;
	created_at: string;
}

export default function NotificationBell() {
	const [open, setOpen] = useState(false);
	const [items, setItems] = useState<NotificationItem[]>([]);
	const [canOfferPush, setCanOfferPush] = useState(false);
	const [pushEnabled, setPushEnabled] = useState(false);
	const [pushBusy, setPushBusy] = useState(false);
	const [pushHint, setPushHint] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	function loadNotifications() {
		apiFetch<{ notifications: NotificationItem[] }>('/api/notifications')
			.then((res) => setItems(res.notifications || []))
			.catch(() => {});
	}

	useEffect(() => {
		setCanOfferPush(isWebPushSupported() || isIosStandaloneRequired());
		loadNotifications();
		getActivePushSubscription().then((sub) => setPushEnabled(Boolean(sub)));

		const unsubPush = onPushSubscriptionChange((enabled) => {
			setPushEnabled(enabled);
		});

		const unsub = subscribeRealtime((ev) => {
			if (ev.notificationId) {
				setItems((prev) => {
					if (prev.some((n) => n.id === ev.notificationId)) return prev;
					return [
						{
							id: ev.notificationId!,
							type: ev.type,
							title: ev.title,
							body: ev.body,
							link: ev.url || null,
							is_read: 0,
							created_at: ev.createdAt || new Date().toISOString(),
						},
						...prev,
					].slice(0, 50);
				});
			}
		});

		const onDocClick = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener('mousedown', onDocClick);

		return () => {
			unsubPush();
			unsub();
			document.removeEventListener('mousedown', onDocClick);
		};
	}, []);

	const unreadCount = items.filter((i) => !i.is_read).length;

	async function handleTogglePush() {
		if (pushBusy) return;
		setPushBusy(true);
		setPushHint(null);

		if (pushEnabled) {
			await disableWebPush(true);
			setPushEnabled(false);
			setPushBusy(false);
			return;
		}

		const res = await enableWebPush();
		if (res.ok) {
			setPushEnabled(true);
		} else if (res.error) {
			setPushHint(res.error);
		}
		setPushBusy(false);
	}

	async function handleMarkAllRead() {
		await apiFetch('/api/notifications/read-all', { method: 'POST', body: '{}' }).catch(() => {});
		setItems((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
	}

	async function handleSelectItem(item: NotificationItem) {
		if (!item.is_read) {
			apiFetch(`/api/notifications/${item.id}/read`, { method: 'PATCH', body: '{}' }).catch(() => {});
			setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: 1 } : n)));
		}
		setOpen(false);
		if (item.link) {
			window.location.href = item.link;
		}
	}

	return (
		<div ref={containerRef} class="relative">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				title="Notifications"
				aria-label="Notifications"
				aria-expanded={open}
				class={`relative inline-flex min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 items-center justify-center rounded-lg p-2.5 sm:px-2.5 sm:py-1.5 text-sm font-semibold transition-colors cursor-pointer ${
					open
						? 'bg-brand-50 text-brand-700'
						: 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-950'
				}`}
			>
				<Bell class="h-4 w-4" />
				{unreadCount > 0 && (
					<span class="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-extrabold text-white">
						{unreadCount > 9 ? '9+' : unreadCount}
					</span>
				)}
			</button>

			{open && (
				<div class="fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 z-50 w-auto sm:w-96 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
					<div class="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
						<p class="text-sm font-extrabold text-slate-950">Notifications</p>
						<div class="flex items-center gap-2">
							{unreadCount > 0 && (
								<button
									type="button"
									onClick={handleMarkAllRead}
									class="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-800 cursor-pointer"
								>
									<CheckCheck class="h-3.5 w-3.5" />
									Tout lu
								</button>
							)}
							<button
								type="button"
								onClick={() => setOpen(false)}
								aria-label="Fermer les notifications"
								class="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
							>
								<X class="h-4 w-4" />
							</button>
						</div>
					</div>

					{canOfferPush && (
						<div class="border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 space-y-1.5">
							<div class="flex items-center justify-between gap-3">
								<div class="flex items-center gap-2 min-w-0">
									<BellRing class={`h-4 w-4 shrink-0 ${pushEnabled ? 'text-brand-600' : 'text-slate-400'}`} />
									<span class="text-xs font-semibold text-slate-700 truncate">
										Alertes Push sur cet appareil
									</span>
								</div>
								<button
									type="button"
									disabled={pushBusy}
									onClick={handleTogglePush}
									class={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold border transition-colors cursor-pointer ${
										pushEnabled
											? 'border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100'
											: 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700'
									}`}
								>
									{pushBusy ? '...' : pushEnabled ? 'Activées ✓' : 'Activer'}
								</button>
							</div>
							{pushHint && <p class="text-[11px] text-amber-800">{pushHint}</p>}
						</div>
					)}

					<div class="max-h-80 overflow-y-auto divide-y divide-slate-100">
						{items.length === 0 ? (
							<div class="p-6 text-center text-xs text-slate-500">
								Aucune notification pour le moment.
							</div>
						) : (
							items.map((n) => (
								<button
									key={n.id}
									type="button"
									onClick={() => handleSelectItem(n)}
									class={`w-full text-left px-4 py-3 transition-colors hover:bg-slate-50 cursor-pointer ${
										!n.is_read ? 'bg-brand-50/40' : 'bg-white'
									}`}
								>
									<div class="flex items-start justify-between gap-2">
										<p class="text-xs font-bold text-slate-950">{n.title}</p>
										{!n.is_read && (
											<span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
										)}
									</div>
									<p class="mt-0.5 text-xs text-slate-600 line-clamp-2">{n.body}</p>
									<p class="mt-1 text-[11px] text-slate-400">{formatDate(n.created_at)}</p>
								</button>
							))
						)}
					</div>
				</div>
			)}
		</div>
	);
}
