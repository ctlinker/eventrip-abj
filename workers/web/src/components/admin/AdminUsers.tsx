import { useCallback, useEffect, useState } from 'preact/hooks';
import {
	ChevronDown,
	ChevronRight,
	Mail,
	RefreshCw,
	Search,
	ShieldAlert,
	CheckCircle2,
	AlertTriangle,
} from 'lucide-preact';
import { apiFetch, formatDate } from '../../lib/api';

interface UserRow {
	id: string;
	name: string;
	email: string;
	phone: string | null;
	role: 'client' | 'admin' | 'super_admin';
	permissions: string;
	is_active: number;
}

interface AuditRow {
	id: string;
	actor_id: string | null;
	actor_name?: string | null;
	actor_email?: string | null;
	actor_role?: string | null;
	action: string;
	entity_type: string;
	entity_id: string;
	old_state?: string | null;
	new_state?: string | null;
	metadata?: string | null;
	created_at: string;
}

interface MailSettings {
	id: string;
	is_enabled: number;
	daily_limit: number;
	monthly_limit: number;
	cooldown_minutes: number;
	updated_by: string | null;
	updated_at: string;
}

interface MailUsage {
	daily_sent: number;
	monthly_sent: number;
	daily_blocked: number;
	daily_failed: number;
}

interface MailWorkerStatus {
	configured: boolean;
	from: string;
}

interface MailLogRow {
	id: string;
	recipient: string;
	subject: string;
	template: string;
	status: 'sent' | 'failed' | 'quota_blocked' | 'cooldown_blocked' | 'disabled_blocked' | string;
	provider_id: string | null;
	error_message: string | null;
	created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
	'admin.permissions_update': 'Mise à jour rôle / permissions',
	'admin.mail_quota_update': 'Configuration quotas mail',
	'auth.password_reset': 'Réinitialisation mot de passe (email)',
	'auth.password_change': 'Changement mot de passe (session)',
	'payment.confirm': 'Validation paiement Wave',
	'payment.reject': 'Rejet paiement Wave',
	'ticket.scan': 'Scan billet QR',
	'order.expire': 'Expiration automatique commande',
};

function parseJsonSafe(raw?: string | null): Record<string, unknown> | unknown[] | string | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed === 'string') {
			try {
				return JSON.parse(parsed);
			} catch {
				return parsed;
			}
		}
		return parsed;
	} catch {
		return raw;
	}
}

function renderJsonBlock(label: string, raw?: string | null, tone: 'old' | 'new' | 'meta' = 'meta') {
	const parsed = parseJsonSafe(raw);
	if (parsed === null || parsed === undefined) return null;

	const toneStyles = {
		old: 'border-amber-200/80 bg-amber-50/40 text-amber-950',
		new: 'border-emerald-200/80 bg-emerald-50/40 text-emerald-950',
		meta: 'border-slate-200 bg-slate-50 text-slate-800',
	}[tone];

	const formatted =
		typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);

	return (
		<div class={`rounded-xl border p-3 ${toneStyles}`}>
			<p class="text-[11px] font-extrabold uppercase tracking-wider opacity-75 mb-1.5">{label}</p>
			<pre class="text-xs font-mono whitespace-pre-wrap break-all leading-relaxed">{formatted}</pre>
		</div>
	);
}

function quotaBarColor(sent: number, limit: number): string {
	if (limit <= 0) return 'bg-red-500';
	const ratio = sent / limit;
	if (ratio >= 1) return 'bg-red-600';
	if (ratio >= 0.8) return 'bg-amber-500';
	return 'bg-emerald-600';
}

function mailStatusBadge(status: string) {
	switch (status) {
		case 'sent':
			return (
				<span class="rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
					Envoyé
				</span>
			);
		case 'quota_blocked':
			return (
				<span class="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-bold text-red-700">
					Quota atteint
				</span>
			);
		case 'cooldown_blocked':
			return (
				<span class="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-700">
					Cooldown
				</span>
			);
		case 'disabled_blocked':
			return (
				<span class="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">
					Désactivé
				</span>
			);
		default:
			return (
				<span class="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[11px] font-bold text-red-700">
					Échec
				</span>
			);
	}
}

export default function AdminUsers() {
	const [users, setUsers] = useState<UserRow[]>([]);
	const [logs, setLogs] = useState<AuditRow[]>([]);
	const [currentUserId, setCurrentUserId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Détails & filtres d'audit
	const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
	const [auditSearch, setAuditSearch] = useState('');
	const [auditEntityFilter, setAuditEntityFilter] = useState('');
	const [auditLoading, setAuditLoading] = useState(false);

	// Quotas & journaux Mail
	const [mailSettings, setMailSettings] = useState<MailSettings | null>(null);
	const [mailUsage, setMailUsage] = useState<MailUsage>({
		daily_sent: 0,
		monthly_sent: 0,
		daily_blocked: 0,
		daily_failed: 0,
	});
	const [mailWorker, setMailWorker] = useState<MailWorkerStatus>({
		configured: false,
		from: 'Eventrip <noreply@eventrip-abj.com>',
	});
	const [mailLogs, setMailLogs] = useState<MailLogRow[]>([]);
	const [mailStatusFilter, setMailStatusFilter] = useState('');
	const [showMailLogs, setShowMailLogs] = useState(false);

	// Formulaire d'édition des quotas
	const [formEnabled, setFormEnabled] = useState(true);
	const [formDaily, setFormDaily] = useState('100');
	const [formMonthly, setFormMonthly] = useState('3000');
	const [formCooldown, setFormCooldown] = useState('5');
	const [savingQuota, setSavingQuota] = useState(false);
	const [quotaSavedMsg, setQuotaSavedMsg] = useState<string | null>(null);
	const [quotaError, setQuotaError] = useState<string | null>(null);

	const loadAuditLogs = useCallback(async (q = auditSearch, entityType = auditEntityFilter) => {
		setAuditLoading(true);
		try {
			const params = new URLSearchParams();
			if (q.trim()) params.set('q', q.trim());
			if (entityType) params.set('entity_type', entityType);
			params.set('limit', '100');
			const qs = params.toString();
			const res = await apiFetch<{ logs: AuditRow[] }>(
				`/api/super-admin/audit-logs${qs ? `?${qs}` : ''}`,
			);
			setLogs(res.logs);
		} catch (err: any) {
			setError(err.message);
		} finally {
			setAuditLoading(false);
		}
	}, [auditSearch, auditEntityFilter]);

	const loadMailSection = useCallback(async (statusFilter = mailStatusFilter) => {
		try {
			const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
			const [quotaRes, logsRes] = await Promise.all([
				apiFetch<{ settings: MailSettings; usage: MailUsage; worker: MailWorkerStatus }>(
					'/api/super-admin/mail-quota',
				),
				apiFetch<{ logs: MailLogRow[] }>(`/api/super-admin/mail-logs${qs}`),
			]);
			setMailSettings(quotaRes.settings);
			setMailUsage(quotaRes.usage);
			setMailWorker(quotaRes.worker);
			setFormEnabled(Boolean(quotaRes.settings.is_enabled));
			setFormDaily(String(quotaRes.settings.daily_limit));
			setFormMonthly(String(quotaRes.settings.monthly_limit));
			setFormCooldown(String(quotaRes.settings.cooldown_minutes));
			setMailLogs(logsRes.logs);
		} catch {
			// Ne pas bloquer toute la page si l'endpoint mail n'est pas encore migré
		}
	}, [mailStatusFilter]);

	useEffect(() => {
		Promise.all([
			apiFetch<{ users: UserRow[] }>('/api/super-admin/users'),
			apiFetch<{ logs: AuditRow[] }>('/api/super-admin/audit-logs?limit=100'),
			apiFetch<{ user?: { id: string } } | null>('/api/auth/get-session').catch(() => null),
		])
			.then(([u, l, me]) => {
				setUsers(u.users);
				setLogs(l.logs);
				setCurrentUserId(me?.user?.id ?? null);
			})
			.catch((err) => setError(err.message));

		loadMailSection('');
	}, []);

	async function updateUser(
		id: string,
		patch: { role?: string; permissions?: string[]; is_active?: number },
	) {
		setError(null);
		try {
			const res = await apiFetch<{ user: UserRow }>(`/api/super-admin/users/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(patch),
			});
			if (res.user) {
				setUsers((prev) => prev.map((u) => (u.id === id ? res.user : u)));
			}
			await loadAuditLogs();
		} catch (err: any) {
			setError(err.message);
		}
	}

	async function handleSaveQuota(e: Event) {
		e.preventDefault();
		setSavingQuota(true);
		setQuotaError(null);
		setQuotaSavedMsg(null);

		try {
			const daily = Number.parseInt(formDaily, 10);
			const monthly = Number.parseInt(formMonthly, 10);
			const cooldown = Number.parseInt(formCooldown, 10);

			const res = await apiFetch<{ settings: MailSettings }>('/api/super-admin/mail-quota', {
				method: 'PATCH',
				body: JSON.stringify({
					is_enabled: formEnabled ? 1 : 0,
					daily_limit: daily,
					monthly_limit: monthly,
					cooldown_minutes: cooldown,
				}),
			});
			setMailSettings(res.settings);
			setQuotaSavedMsg('Quotas mail enregistrés et journalisés.');
			await loadAuditLogs();
		} catch (err: any) {
			setQuotaError(err?.message || 'Erreur lors de la sauvegarde des quotas.');
		} finally {
			setSavingQuota(false);
		}
	}

	function handleAuditFilterSubmit(e: Event) {
		e.preventDefault();
		loadAuditLogs(auditSearch, auditEntityFilter);
	}

	if (error) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				{error}
			</div>
		);
	}

	const dailyLimit = mailSettings?.daily_limit ?? 100;
	const monthlyLimit = mailSettings?.monthly_limit ?? 3000;
	const dailyPct = dailyLimit > 0 ? Math.min(100, Math.round((mailUsage.daily_sent / dailyLimit) * 100)) : 100;
	const monthlyPct =
		monthlyLimit > 0 ? Math.min(100, Math.round((mailUsage.monthly_sent / monthlyLimit) * 100)) : 100;

	return (
		<div class="space-y-8">
			{/* Section 1 : Comptes & Permissions */}
			<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
				<h2 class="text-lg font-extrabold text-slate-950">Comptes &amp; Permissions</h2>
				<div class="divide-y divide-slate-100">
					{users.map((u) => {
						const perms: string[] = (() => {
							try {
								return JSON.parse(u.permissions || '[]');
							} catch {
								return [];
							}
						})();
						const canVerify = perms.includes('payments:verify');
						const isSelf = currentUserId === u.id;
						return (
							<div key={u.id} class="py-3.5 flex flex-wrap items-center justify-between gap-4 text-sm">
								<div>
									<p class="font-bold text-slate-950 flex items-center gap-2">
										<span>{u.name}</span>
										{isSelf && (
											<span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
												Vous
											</span>
										)}
									</p>
									<p class="text-xs text-slate-500">
										{u.email} {u.phone ? `• ${u.phone}` : ''}
									</p>
								</div>
								<div class="flex flex-wrap items-center gap-2">
									<select
										aria-label={`Rôle de ${u.name}`}
										disabled={isSelf}
										title={
											isSelf
												? 'Votre propre rôle est protégé'
												: `Modifier le rôle de ${u.name}`
										}
										value={u.role}
										onChange={(e) =>
											updateUser(u.id, { role: (e.target as HTMLSelectElement).value })
										}
										class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:border-brand-600 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
									>
										<option value="client">Client</option>
										<option value="admin">Admin</option>
										<option value="super_admin">Super Admin</option>
									</select>

									{u.role === 'admin' && (
										<button
											type="button"
											onClick={() =>
												updateUser(u.id, {
													permissions: canVerify ? [] : ['payments:verify'],
												})
											}
											class={`rounded-lg px-2.5 py-1.5 text-xs font-bold border cursor-pointer ${
												canVerify
													? 'bg-brand-600 text-white border-brand-600'
													: 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
											}`}
										>
											{canVerify ? 'payments:verify ✓' : 'Autoriser paiements'}
										</button>
									)}

									<button
										type="button"
										disabled={isSelf}
										title={isSelf ? 'Vous ne pouvez pas désactiver votre propre compte' : undefined}
										onClick={() => updateUser(u.id, { is_active: u.is_active ? 0 : 1 })}
										class={`rounded-lg px-2.5 py-1.5 text-xs font-bold border ${
											isSelf ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
										} ${
											u.is_active
												? 'bg-brand-50 text-brand-700 border-brand-200'
												: 'bg-red-50 text-red-700 border-red-200'
										}`}
									>
										{u.is_active ? 'Actif' : 'Désactivé'}
									</button>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Section 2 : Quotas & Journal Mail (Resend) */}
			<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="text-lg font-extrabold text-slate-950 flex items-center gap-2">
							<Mail class="h-5 w-5 text-brand-600" />
							<span>Quotas &amp; Service Mail (Resend)</span>
						</h2>
						<p class="text-xs text-slate-500 mt-0.5">
							Expéditeur : <code class="font-mono text-slate-700">{mailWorker.from}</code>
						</p>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						{mailWorker.configured ? (
							<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-700">
								<CheckCircle2 class="h-3.5 w-3.5" />
								Resend connecté
							</span>
						) : (
							<span class="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-bold text-amber-700">
								<AlertTriangle class="h-3.5 w-3.5" />
								Clé API manquante
							</span>
						)}
						{mailSettings && !mailSettings.is_enabled && (
							<span class="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-1 text-xs font-bold text-red-700">
								<ShieldAlert class="h-3.5 w-3.5" />
								Envoi suspendu
							</span>
						)}
					</div>
				</div>

				{/* Jauges de consommation */}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div class="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
						<div class="flex items-center justify-between text-xs">
							<span class="font-bold text-slate-700">Quota journalier (UTC)</span>
							<span class="font-extrabold text-slate-950">
								{mailUsage.daily_sent} / {dailyLimit} ({dailyPct}%)
							</span>
						</div>
						<div class="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
							<div
								class={`h-full transition-all ${quotaBarColor(mailUsage.daily_sent, dailyLimit)}`}
								style={{ width: `${dailyPct}%` }}
							/>
						</div>
						<div class="flex items-center justify-between text-[11px] text-slate-500">
							<span>Plan gratuit Resend : 100 / jour</span>
							{(mailUsage.daily_blocked > 0 || mailUsage.daily_failed > 0) && (
								<span class="font-semibold text-amber-700">
									{mailUsage.daily_blocked} bloqué(s) • {mailUsage.daily_failed} échec(s)
								</span>
							)}
						</div>
					</div>

					<div class="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
						<div class="flex items-center justify-between text-xs">
							<span class="font-bold text-slate-700">Quota mensuel (mois en cours)</span>
							<span class="font-extrabold text-slate-950">
								{mailUsage.monthly_sent} / {monthlyLimit} ({monthlyPct}%)
							</span>
						</div>
						<div class="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
							<div
								class={`h-full transition-all ${quotaBarColor(mailUsage.monthly_sent, monthlyLimit)}`}
								style={{ width: `${monthlyPct}%` }}
							/>
						</div>
						<p class="text-[11px] text-slate-500">Plan gratuit Resend : 3 000 / mois</p>
					</div>
				</div>

				{/* Configuration des plafonds */}
				<form onSubmit={handleSaveQuota} class="rounded-xl border border-slate-200 p-4 space-y-4">
					<div class="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
						<div>
							<label for="mail-daily-limit" class="block text-xs font-bold text-slate-700 mb-1">
								Plafond / jour
							</label>
							<input
								id="mail-daily-limit"
								type="number"
								min={0}
								max={1000000}
								required
								value={formDaily}
								onInput={(e) => setFormDaily((e.target as HTMLInputElement).value)}
								class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-900 focus:border-brand-600 focus:outline-none"
							/>
						</div>

						<div>
							<label for="mail-monthly-limit" class="block text-xs font-bold text-slate-700 mb-1">
								Plafond / mois
							</label>
							<input
								id="mail-monthly-limit"
								type="number"
								min={0}
								max={10000000}
								required
								value={formMonthly}
								onInput={(e) => setFormMonthly((e.target as HTMLInputElement).value)}
								class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-900 focus:border-brand-600 focus:outline-none"
							/>
						</div>

						<div>
							<label for="mail-cooldown" class="block text-xs font-bold text-slate-700 mb-1">
								Cooldown / email (min)
							</label>
							<input
								id="mail-cooldown"
								type="number"
								min={0}
								max={1440}
								required
								value={formCooldown}
								onInput={(e) => setFormCooldown((e.target as HTMLInputElement).value)}
								class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-900 focus:border-brand-600 focus:outline-none"
							/>
						</div>

						<div class="flex items-center justify-between sm:justify-end gap-3">
							<label class="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
								<input
									type="checkbox"
									checked={formEnabled}
									onChange={(e) => setFormEnabled((e.target as HTMLInputElement).checked)}
									class="rounded border-slate-300 text-brand-600 focus:ring-brand-600"
								/>
								<span>Activer l’envoi</span>
							</label>
							<button
								type="submit"
								disabled={savingQuota}
								class="rounded-lg bg-navy-950 px-3.5 py-2 text-xs font-bold text-white hover:bg-navy-800 disabled:opacity-50 cursor-pointer"
							>
								{savingQuota ? 'Sauvegarde...' : 'Enregistrer'}
							</button>
						</div>
					</div>

					{quotaError && (
						<p class="text-xs font-semibold text-red-600">{quotaError}</p>
					)}
					{quotaSavedMsg && (
						<p class="text-xs font-semibold text-emerald-700">{quotaSavedMsg}</p>
					)}
				</form>

				{/* Historique des envois mail */}
				<div class="space-y-3">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<button
							type="button"
							onClick={() => setShowMailLogs((v) => !v)}
							class="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-slate-950 cursor-pointer"
						>
							{showMailLogs ? (
								<ChevronDown class="h-4 w-4 text-brand-600" />
							) : (
								<ChevronRight class="h-4 w-4 text-brand-600" />
							)}
							<span>Journal d’envoi d’emails ({mailLogs.length})</span>
						</button>

						{showMailLogs && (
							<div class="flex items-center gap-2">
								<select
									aria-label="Filtrer les emails par statut"
									value={mailStatusFilter}
									onChange={(e) => {
										const val = (e.target as HTMLSelectElement).value;
										setMailStatusFilter(val);
										loadMailSection(val);
									}}
									class="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
								>
									<option value="">Tous les statuts</option>
									<option value="sent">Envoyés</option>
									<option value="quota_blocked">Quota atteint</option>
									<option value="cooldown_blocked">Cooldown</option>
									<option value="failed">Échecs</option>
								</select>
								<button
									type="button"
									onClick={() => loadMailSection(mailStatusFilter)}
									title="Actualiser les journaux mail"
									class="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50 cursor-pointer"
								>
									<RefreshCw class="h-3.5 w-3.5" />
								</button>
							</div>
						)}
					</div>

					{showMailLogs && (
						<div class="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">
							{mailLogs.length === 0 ? (
								<p class="py-4 text-xs text-slate-400 text-center">
									Aucun email enregistré pour ce filtre.
								</p>
							) : (
								mailLogs.map((m) => (
									<div key={m.id} class="py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
										<div class="space-y-0.5">
											<div class="flex flex-wrap items-center gap-2">
												{mailStatusBadge(m.status)}
												<span class="font-bold text-slate-900">{m.recipient}</span>
												<span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
													{m.template}
												</span>
											</div>
											<p class="text-slate-500">{m.subject}</p>
											{m.error_message && (
												<p class="text-red-600 font-medium">{m.error_message}</p>
											)}
										</div>
										<div class="text-right text-[11px] text-slate-400">
											<div>{formatDate(m.created_at)}</div>
											{m.provider_id && (
												<div class="font-mono text-[10px]">ID: {m.provider_id.slice(0, 12)}</div>
											)}
										</div>
									</div>
								))
							)}
						</div>
					)}
				</div>
			</div>

			{/* Section 3 : Journaux d'audit système enrichis */}
			<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<h2 class="text-lg font-extrabold text-slate-950">Journaux d’audit système</h2>
						<p class="text-xs text-slate-500">
							Cliquez sur une entrée pour inspecter l’acteur, l’état avant/après et les métadonnées.
						</p>
					</div>
					<button
						type="button"
						onClick={() => loadAuditLogs(auditSearch, auditEntityFilter)}
						disabled={auditLoading}
						class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
					>
						<RefreshCw class={`h-3.5 w-3.5 ${auditLoading ? 'animate-spin' : ''}`} />
						<span>Actualiser</span>
					</button>
				</div>

				{/* Barre de recherche & filtre */}
				<form onSubmit={handleAuditFilterSubmit} class="flex flex-wrap items-center gap-2">
					<div class="relative flex-1 min-w-[200px]">
						<Search class="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
						<input
							type="search"
							value={auditSearch}
							onInput={(e) => setAuditSearch((e.target as HTMLInputElement).value)}
							placeholder="Rechercher action, acteur, ID d'entité..."
							class="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs focus:border-brand-600 focus:outline-none"
						/>
					</div>
					<select
						aria-label="Filtrer par type d'entité"
						value={auditEntityFilter}
						onChange={(e) => {
							const next = (e.target as HTMLSelectElement).value;
							setAuditEntityFilter(next);
							loadAuditLogs(auditSearch, next);
						}}
						class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
					>
						<option value="">Toutes les entités</option>
						<option value="user">Utilisateurs (user)</option>
						<option value="mail_settings">Quotas mail (mail_settings)</option>
						<option value="payment">Paiements (payment)</option>
						<option value="order">Commandes (order)</option>
						<option value="ticket">Billets (ticket)</option>
						<option value="event">Événements (event)</option>
						<option value="convoy">Convois (convoy)</option>
					</select>
					<button
						type="submit"
						class="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
					>
						Filtrer
					</button>
				</form>

				<div class="divide-y divide-slate-100 text-xs">
					{logs.length === 0 ? (
						<p class="py-6 text-center text-slate-400">Aucune entrée d’audit trouvée.</p>
					) : (
						logs.map((log) => {
							const isOpen = expandedLogId === log.id;
							const humanLabel = ACTION_LABELS[log.action] || log.action;
							const hasDetails = Boolean(
								log.old_state || log.new_state || log.metadata || log.actor_id,
							);
							return (
								<div key={log.id} class="py-2.5">
									<button
										type="button"
										onClick={() => setExpandedLogId(isOpen ? null : log.id)}
										aria-expanded={isOpen}
										class="w-full flex flex-wrap items-center justify-between gap-2 text-left hover:bg-slate-50/80 rounded-lg px-2 py-1.5 -mx-2 transition-colors cursor-pointer"
									>
										<div class="flex flex-wrap items-center gap-2">
											{isOpen ? (
												<ChevronDown class="h-3.5 w-3.5 text-brand-600 shrink-0" />
											) : (
												<ChevronRight class="h-3.5 w-3.5 text-slate-400 shrink-0" />
											)}
											<strong class="text-slate-900 font-bold">{humanLabel}</strong>
											<span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
												{log.action}
											</span>
											<span class="text-slate-500">
												• {log.entity_type} (
												<code class="font-mono">{log.entity_id.slice(0, 10)}</code>)
											</span>
											{log.actor_name && (
												<span class="text-slate-400">• par {log.actor_name}</span>
											)}
										</div>
										<span class="text-slate-400 shrink-0">{formatDate(log.created_at)}</span>
									</button>

									{isOpen && (
										<div class="mt-2 ml-5 rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
											<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
												<div>
													<span class="font-bold text-slate-500 block">Entité ciblée</span>
													<span class="font-mono text-slate-900 break-all">
														{log.entity_type} : {log.entity_id}
													</span>
												</div>
												<div>
													<span class="font-bold text-slate-500 block">Acteur</span>
													<span class="text-slate-900">
														{log.actor_name
															? `${log.actor_name} (${log.actor_email || log.actor_id})`
															: log.actor_id || 'Système / Automatique'}
													</span>
												</div>
												<div>
													<span class="font-bold text-slate-500 block">Horodatage exact</span>
													<span class="font-mono text-slate-900">{log.created_at}</span>
												</div>
											</div>

											{(log.old_state || log.new_state) && (
												<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
													{renderJsonBlock('État précédent (old_state)', log.old_state, 'old')}
													{renderJsonBlock('Nouvel état (new_state)', log.new_state, 'new')}
												</div>
											)}

											{renderJsonBlock('Métadonnées (metadata)', log.metadata, 'meta')}

											{!hasDetails && (
												<p class="text-slate-400 italic">Aucun détail supplémentaire enregistré.</p>
											)}
										</div>
									)}
								</div>
							);
						})
					)}
				</div>
			</div>
		</div>
	);
}
