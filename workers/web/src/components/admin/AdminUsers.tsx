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
			await apiFetch(`/api/super-admin/users/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(patch),
			});
			load();
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
			<div class="rounded-2xl border border-green-100 bg-white p-6 space-y-4">
				<h2 class="text-lg font-bold text-slate-900">Comptes &amp; Permissions</h2>
				<div class="divide-y divide-green-50">
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
							<div key={u.id} class="py-3 flex flex-wrap items-center justify-between gap-4 text-sm">
								<div>
									<p class="font-semibold text-slate-900">{u.name}</p>
									<p class="text-xs text-slate-500">
										{u.email} {u.phone ? `· ${u.phone}` : ''}
									</p>
								</div>
								<div class="flex flex-wrap items-center gap-2">
									<select
										value={u.role}
										onChange={(e) =>
											updateUser(u.id, { role: (e.target as HTMLSelectElement).value })
										}
										class="rounded-lg border border-green-200 px-2.5 py-1 text-xs font-semibold"
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
											class={`rounded-lg px-2.5 py-1 text-xs font-semibold border cursor-pointer ${
												canVerify
													? 'bg-green-600 text-white border-green-600'
													: 'bg-white text-slate-600 border-green-200'
											}`}
										>
											{canVerify ? 'payments:verify ✓' : 'Autoriser paiements'}
										</button>
									)}

									<button
										type="button"
										onClick={() => updateUser(u.id, { is_active: u.is_active ? 0 : 1 })}
										class={`rounded-lg px-2.5 py-1 text-xs font-semibold border cursor-pointer ${
											u.is_active
												? 'bg-green-50 text-green-700 border-green-200'
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

			<div class="rounded-2xl border border-green-100 bg-white p-6 space-y-3">
				<h2 class="text-lg font-bold text-slate-900">Journaux d’audit récents</h2>
				<div class="divide-y divide-green-50 text-xs">
					{logs.map((log) => (
						<div key={log.id} class="py-2 flex justify-between text-slate-600">
							<span>
								<strong class="text-slate-900">{log.action}</strong> · {log.entity_type} ({log.entity_id.slice(0, 8)})
							</span>
							<span>{formatDate(log.created_at)}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
