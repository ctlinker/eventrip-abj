import { useEffect, useState } from 'preact/hooks';
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
	action: string;
	entity_type: string;
	entity_id: string;
	created_at: string;
}

export default function AdminUsers() {
	const [users, setUsers] = useState<UserRow[]>([]);
	const [logs, setLogs] = useState<AuditRow[]>([]);
	const [error, setError] = useState<string | null>(null);

	function load() {
		Promise.all([
			apiFetch<{ users: UserRow[] }>('/api/super-admin/users'),
			apiFetch<{ logs: AuditRow[] }>('/api/super-admin/audit-logs'),
		])
			.then(([u, l]) => {
				setUsers(u.users);
				setLogs(l.logs);
			})
			.catch((err) => setError(err.message));
	}

	useEffect(() => {
		load();
	}, []);

	async function updateUser(id: string, patch: { role?: string; permissions?: string[]; is_active?: number }) {
		setError(null);
		try {
			const res = await apiFetch<{ user: UserRow }>(`/api/super-admin/users/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(patch),
			});
			if (res.user) {
				setUsers((prev) => prev.map((u) => (u.id === id ? res.user : u)));
			}
			setLogs((prev) => [
				{
					id: crypto.randomUUID(),
					action: 'admin.permissions_update',
					entity_type: 'user',
					entity_id: id,
					created_at: new Date().toISOString(),
				},
				...prev,
			]);
		} catch (err: any) {
			setError(err.message);
		}
	}

	if (error) {
		return (
			<div class="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
				{error}
			</div>
		);
	}

	return (
		<div class="space-y-8">
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
						return (
							<div key={u.id} class="py-3.5 flex flex-wrap items-center justify-between gap-4 text-sm">
								<div>
									<p class="font-bold text-slate-950">{u.name}</p>
									<p class="text-xs text-slate-500">
										{u.email} {u.phone ? `• ${u.phone}` : ''}
									</p>
								</div>
								<div class="flex flex-wrap items-center gap-2">
									<select
										aria-label={`Rôle de ${u.name}`}
										value={u.role}
										onChange={(e) =>
											updateUser(u.id, { role: (e.target as HTMLSelectElement).value })
										}
										class="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-800 focus:border-emerald-600 focus:outline-none"
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
													? 'bg-emerald-600 text-white border-emerald-600'
													: 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
											}`}
										>
											{canVerify ? 'payments:verify ✓' : 'Autoriser paiements'}
										</button>
									)}

									<button
										type="button"
										onClick={() => updateUser(u.id, { is_active: u.is_active ? 0 : 1 })}
										class={`rounded-lg px-2.5 py-1.5 text-xs font-bold border cursor-pointer ${
											u.is_active
												? 'bg-emerald-50 text-emerald-700 border-emerald-200'
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

			<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-3">
				<h2 class="text-lg font-extrabold text-slate-950">Journaux d’audit récents</h2>
				<div class="divide-y divide-slate-100 text-xs">
					{logs.map((log) => (
						<div key={log.id} class="py-2 flex justify-between text-slate-500">
							<span>
								<strong class="text-slate-900">{log.action}</strong> • {log.entity_type} (
								{log.entity_id.slice(0, 8)})
							</span>
							<span>{formatDate(log.created_at)}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
